import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, createStream, DEFAULT_CONFIG, type Reading } from '../src/index.ts';
import { readP95 } from './helpers/percentile.ts';

const config = { ...DEFAULT_CONFIG, windowMs: 100, maxLatenessMs: 5,
  validRange: { min: 0, max: 100 }, p95BucketCount: 10 };
const r = (ts: number, seq: number, value: number | null, deviceId = 'a'): Reading => ({ deviceId, ts, seq, value });
const readings = (values: number[]): Reading[] => values.map((value, seq) => r(0, seq, value));

test('p95 uses the midpoint of the bucket containing the nearest-rank value', () => {
  // Sorted values 1..19,100: rank 19 is value 19, in bucket [10,20).
  const values = [...Array.from({ length: 19 }, (_, i) => i + 1), 100];
  assert.equal(readP95(summarize(readings(values), config)[0]), 15);
  assert.equal(readP95(summarize(readings(values), { ...config, p95BucketCount: 100 })[0]), 19.5);
  assert.equal(readP95(summarize(readings([0, 100]), { ...config, p95BucketCount: 1 })[0]), 50);
});

test('bucket counts retain frequency and nearest rank does not interpolate', () => {
  const cases: [number[], number][] = [
    [[...Array(19).fill(0), 100], 5], // rank 19 is zero, not between zero and 100.
    [[...Array(18).fill(0), 100, 100], 95],
  ];
  for (const [values, expected] of cases) {
    assert.equal(readP95(summarize(readings(values), config)[0]), expected);
  }
});

test('internal bucket boundaries go right and the inclusive maximum stays in the last bucket', () => {
  for (const [value, expected] of [[49.999, 45], [50, 55], [50.001, 55], [100, 95]]) {
    const values = [...Array(18).fill(0), value, 100];
    assert.equal(readP95(summarize(readings(values), config)[0]), expected, `value ${value}`);
  }
});

test('estimates clamp to observed values for singleton, constant, and zero-width ranges', () => {
  for (const value of [-40, 1.23, 125]) {
    for (const count of [1, 40]) {
      assert.equal(readP95(summarize(readings(Array(count).fill(value)), DEFAULT_CONFIG)[0]), value);
    }
  }
  const settings = { ...config, validRange: { min: 7, max: 7 } };
  assert.equal(readP95(summarize(readings([7, 7, 8]), settings)[0]), 7);
});

test('default 825 buckets provide at most 0.1 absolute error over the default valid range', () => {
  const summary = summarize(readings([-40, 125]), DEFAULT_CONFIG)[0];
  assert.ok(Math.abs(readP95(summary) - 124.9) < 1e-10);
  assert.ok(Math.abs(readP95(summary) - 125) <= 0.1 + 1e-10);
});

test('histogram error stays within half a bucket across ranges, resolutions, and skewed data', () => {
  for (const [min, max] of [[-40, 125], [-5, 5], [0, 1]]) {
    const spread = Array.from({ length: 101 }, (_, i) => min + (max - min) * ((i * 37) % 101) / 100);
    const datasets = [spread, [...Array(95).fill(min), ...Array(5).fill(max)], [min, max]];
    for (const values of datasets) {
      const sorted = [...values].sort((a, b) => a - b);
      const exact = sorted[Math.ceil(0.95 * sorted.length) - 1];
      for (const buckets of [1, 10, 165, 825, 1_650]) {
        const settings = { ...config, validRange: { min, max }, p95BucketCount: buckets };
        const estimate = readP95(summarize(readings(values), settings)[0]);
        assert.ok(Math.abs(estimate - exact) <= (max - min) / (2 * buckets) + 1e-10,
          `range ${min}..${max}, ${buckets} buckets, exact ${exact}, estimate ${estimate}`);
        assert.ok(estimate >= sorted[0] && estimate <= sorted[sorted.length - 1]);
      }
    }
  }
});

test('only accepted readings contribute to p95; inputs remain unchanged', () => {
  const input = [r(10, 0, 0), r(50, 1, 20), r(45, 2, 40), r(44, 3, 100),
    r(1_000, 4, null), r(1_000, 4, 100), r(49, 5, 30), r(50, 1, 100), r(50, 6, 101)];
  const before = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const summary = summarize(input, config)[0];
  assert.equal(readP95(summary), 40);
  assert.equal(summary.count, 4);
  assert.deepEqual(input, before);
});

test('each device and tumbling window gets its own percentile', () => {
  const input = [r(0, 1, 10), r(1, 2, 80), r(100, 3, 40), r(0, 1, 20, 'b'), r(1, 2, 90, 'b')];
  const output = summarize(input, config);
  assert.deepEqual(output.map((w) => [w.deviceId, w.windowStart, readP95(w)]), [
    ['a', 0, 80], ['a', 100, 40], ['b', 0, 90],
  ]);
});

test('invalid bucket counts are rejected by batch and streaming entry points', () => {
  for (const p95BucketCount of [0, -1, 1.5, NaN, Infinity, 65_537]) {
    const settings = { ...config, p95BucketCount };
    assert.throws(() => summarize([], settings), RangeError);
    assert.throws(() => createStream(settings), RangeError);
  }
  assert.equal(readP95(summarize(readings([1]), { ...config, p95BucketCount: 65_536 })[0]), 1);
});

test('invalid ranges and unrepresentable bucket widths fail before processing', () => {
  for (const validRange of [
    { min: 2, max: 1 }, { min: NaN, max: 1 }, { min: 0, max: Infinity },
    { min: -Number.MAX_VALUE, max: Number.MAX_VALUE }, { min: 0, max: Number.MIN_VALUE },
  ]) {
    const settings = { ...config, validRange };
    assert.throws(() => summarize([], settings), RangeError);
    assert.throws(() => createStream(settings), RangeError);
  }
});

test('stream returns p95 only when final, including an accepted late reading before closure', () => {
  const stream = createStream(config);
  for (let seq = 0; seq < 18; seq++) assert.deepEqual(stream.push(r(90, seq, 0)), []);
  assert.deepEqual(stream.push(r(95, 18, 100)), []);
  assert.deepEqual(stream.push(r(102, 19, 20)), []);
  assert.deepEqual(stream.push(r(97, 20, 50)), []);
  assert.deepEqual(stream.push(r(96, 21, 100)), []); // Too late; must not alter percentile.
  const closed = stream.push(r(105, 22, 20));
  assert.equal(closed.length, 1);
  assert.equal(closed[0].count, 20);
  assert.equal(readP95(closed[0]), 55);
  const remaining = stream.end();
  assert.equal(remaining.length, 1);
  assert.equal(readP95(remaining[0]), 20);
  assert.deepEqual(stream.end(), []);
});

test('expiring duplicate history never removes values from an open window percentile', () => {
  const settings = { ...config, maxLatenessMs: 0, streamLimits: { maxRetainedSequences: 1 } };
  const stream = createStream(settings);
  const input = Array.from({ length: 20 }, (_, i) => r(i, i, i === 19 ? 100 : 10));
  for (const reading of input) assert.deepEqual(stream.push(reading), []);
  const closed = stream.push(r(100, 20, 0));
  assert.equal(readP95(closed[0]), 15);
  assert.deepEqual(closed, summarize(input, settings));
});

test('stream snapshots percentile settings and emits the same estimate as batch', () => {
  const settings = { ...config, validRange: { min: 0, max: 100 } };
  const stream = createStream(settings);
  settings.p95BucketCount = 1;
  settings.validRange.max = 200;
  const input = readings([...Array(18).fill(0), 50, 100]);
  for (const reading of input) stream.push(reading);
  const result = stream.end();
  assert.equal(readP95(result[0]), 55);
  assert.deepEqual(result, summarize(input, config));
});
