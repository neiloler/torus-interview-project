// Tier 1 tests. These fail until `summarize` is implemented.
// Tests for Tier 2 and Tier 3 are yours to write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, type Config, type Reading } from '../src/index.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

// Starts high so that it never collides with the small seqs some tests set by hand.
let nextSeq = 1_000;
/** A reading for device `deviceId` at `ts` ms, with a fresh `seq` unless given. */
const r = (deviceId: string, ts: number, value: number | null, seq = nextSeq++): Reading => ({
  deviceId,
  ts,
  seq,
  value,
});

test('no readings gives no windows', () => {
  assert.deepEqual(summarize([], config), []);
});

test('summarizes one window', () => {
  assert.deepEqual(summarize([r('a', 1_000, 1), r('a', 2_000, 2), r('a', 3_000, 6)], config), [
    { deviceId: 'a', windowStart: 0, count: 3, min: 1, max: 6, avg: 3 },
  ]);
});

test('a reading at a window boundary starts the next window', () => {
  assert.deepEqual(summarize([r('a', 59_999, 1), r('a', 60_000, 2)], config), [
    { deviceId: 'a', windowStart: 0, count: 1, min: 1, max: 1, avg: 1 },
    { deviceId: 'a', windowStart: 60_000, count: 1, min: 2, max: 2, avg: 2 },
  ]);
});

test('skips windows with no readings', () => {
  const out = summarize([r('a', 1_000, 1), r('a', 181_000, 2)], config);
  assert.deepEqual(
    out.map((w) => w.windowStart),
    [0, 180_000],
  );
});

test('output is sorted by deviceId, then windowStart', () => {
  const out = summarize([r('b', 61_000, 1), r('a', 62_000, 1), r('b', 63_000, 1), r('a', 64_000, 1)], config);
  assert.deepEqual(
    out.map((w) => [w.deviceId, w.windowStart]),
    [
      ['a', 60_000],
      ['b', 60_000],
    ],
  );
  const later = summarize([r('a', 125_000, 1), r('a', 121_000, 1), r('a', 1_000, 1)], {
    ...config,
    maxLatenessMs: 200_000,
  });
  assert.deepEqual(
    later.map((w) => w.windowStart),
    [0, 120_000],
  );
});

test('drops invalid values', () => {
  const out = summarize(
    [r('a', 1_000, null), r('a', 2_000, NaN), r('a', 3_000, Infinity), r('a', 4_000, 126), r('a', 5_000, -41), r('a', 6_000, 10)],
    config,
  );
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 1, min: 10, max: 10, avg: 10 }]);
});

test('the bounds of validRange are valid', () => {
  const out = summarize([r('a', 1_000, -40), r('a', 2_000, 125)], config);
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 2, min: -40, max: 125, avg: 42.5 }]);
});

test('drops a resent reading and keeps the first arrival', () => {
  const out = summarize([r('a', 1_000, 1, 7), r('a', 2_000, 3), r('a', 1_000, 50, 7)], config);
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 3, avg: 2 }]);
});

test('the same seq on different devices is not a duplicate', () => {
  const out = summarize([r('a', 1_000, 1, 7), r('b', 1_000, 1, 7)], config);
  assert.equal(out.length, 2);
});

test('accepts readings out of order, up to exactly maxLatenessMs behind', () => {
  // 5 000 is exactly maxLatenessMs behind 10 000, so it is still accepted.
  const out = summarize([r('a', 10_000, 1), r('a', 6_000, 3), r('a', 5_000, 5)], config);
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 3, min: 1, max: 5, avg: 3 }]);
});

test('drops a reading more than maxLatenessMs behind the newest for its device', () => {
  const out = summarize([r('a', 10_000, 1), r('a', 4_999, 100)], config);
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 1, min: 1, max: 1, avg: 1 }]);
});

test('lateness is measured per device', () => {
  const out = summarize([r('a', 100_000, 1), r('b', 1_000, 2)], config);
  assert.deepEqual(
    out.map((w) => w.deviceId),
    ['a', 'b'],
  );
});

test('only accepted readings move the newest timestamp forward', () => {
  // The invalid reading at 100 s must not make the reading at 10 s too late.
  const out = summarize([r('a', 9_000, 1), r('a', 100_000, null), r('a', 10_000, 3)], config);
  assert.deepEqual(out, [{ deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 3, avg: 2 }]);
});

test('runs on the sample data', () => {
  const readings: Reading[] = JSON.parse(readFileSync(new URL('../data/sample.json', import.meta.url), 'utf8'));
  const out = summarize(readings, config);
  assert.ok(out.length > 0);
  for (const w of out) {
    assert.equal(w.windowStart % config.windowMs, 0);
    assert.ok(w.min <= w.avg && w.avg <= w.max);
    assert.ok(w.min >= config.validRange.min && w.max <= config.validRange.max);
  }
});
