import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStream, summarize, DEFAULT_CONFIG, type Config, type Reading, type WindowSummary } from '../src/index.ts';
import { generate } from '../scripts/generate.ts';
import { withoutP95 } from './helpers/percentile.ts';

const config: Config = { ...DEFAULT_CONFIG, windowMs: 10, maxLatenessMs: 5 };
const r = (deviceId: string, ts: number, seq: number, value: number | null = 1): Reading => ({ deviceId, ts, seq, value });
const order = (a: WindowSummary, b: WindowSummary) =>
  (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0) || a.windowStart - b.windowStart;

test('a window closes exactly when the accepted cutoff reaches its exclusive end', () => {
  const stream = createStream(config);
  assert.deepEqual(stream.push(r('a', 1, 1)), []);
  assert.deepEqual(stream.push(r('a', 14, 2, 2)), []);
  assert.deepEqual(stream.push(r('a', 15, 3, 3)).map(withoutP95), [
    { deviceId: 'a', windowStart: 0, count: 1, min: 1, max: 1, avg: 1 },
  ]);
  assert.deepEqual(stream.push(r('a', 10, 4, 4)), []); // Exactly at the cutoff.
  assert.deepEqual(stream.end().map(withoutP95), [
    { deviceId: 'a', windowStart: 10, count: 3, min: 2, max: 4, avg: 3 },
  ]);
});

test('fractional windows stay open until the cutoff belongs to a later window', () => {
  for (const [first, boundary, next] of [[0.5, 0.6, 0.7], [4.2, 4.3, 4.4]]) {
    const settings = { ...config, windowMs: 0.1, maxLatenessMs: 0 };
    const readings = [r('a', first, 1, 1), r('a', boundary, 2, 2), r('a', next, 3, 3)];
    const stream = createStream(settings);
    assert.deepEqual(stream.push(readings[0]), []);
    // Division assigns this apparent boundary to the first reading's window.
    assert.deepEqual(stream.push(readings[1]), []);
    const closed = stream.push(readings[2]);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].windowStart, first);
    assert.equal(closed[0].count, 2);
    const results = [...closed, ...stream.end()];
    assert.deepEqual(results.sort(order), summarize(readings, settings));
    assert.equal(new Set(results.map((w) => w.windowStart)).size, results.length);
    assert.deepEqual(stream.end(), []);
  }
});

test('a fractional cutoff keeps its window open for a reading exactly at the lateness limit', () => {
  const settings = { ...config, windowMs: 0.1, maxLatenessMs: 0.25 };
  const readings = [r('a', 0.5, 1, 1), r('a', 0.85, 2, 2), r('a', 0.6, 3, 3), r('a', 1, 4, 4)];
  const stream = createStream(settings);
  for (const reading of readings.slice(0, 3)) assert.deepEqual(stream.push(reading), []);
  const closed = stream.push(readings[3]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].windowStart, 0.5);
  assert.equal(closed[0].count, 2);
  assert.deepEqual([...closed, ...stream.end()].sort(order), summarize(readings, settings));
});

test('another device and rejected future readings cannot close a quiet device window', () => {
  const stream = createStream(config);
  stream.push(r('a', 1, 1));
  stream.push(r('b', 1, 1));
  assert.deepEqual(stream.push(r('a', 15, 2)).map((w) => w.deviceId), ['a']);
  assert.deepEqual(stream.push(r('b', 100, 2, null)), []);
  assert.deepEqual(stream.push(r('b', 100, 2, 10)), []);
  assert.deepEqual(stream.end().sort(order).map(withoutP95), [
    { deviceId: 'a', windowStart: 10, count: 1, min: 1, max: 1, avg: 1 },
    { deviceId: 'b', windowStart: 0, count: 1, min: 1, max: 1, avg: 1 },
  ]);
});

test('one push emits all newly closed windows exactly once, skipping empty windows', () => {
  const stream = createStream({ ...config, maxLatenessMs: 30 });
  for (const [seq, ts] of [1, 11, 21].entries()) stream.push(r('a', ts, seq));
  assert.deepEqual(stream.push(r('a', 100, 3)).map((w) => w.windowStart).sort((a, b) => a - b), [0, 10, 20]);
  assert.deepEqual(stream.push(r('a', 1, 0)), []);
  assert.deepEqual(stream.end().map((w) => w.windowStart), [100]);
  assert.deepEqual(stream.end(), []);
});

test('zero lateness, negative timestamps, and equal timestamps match batch summaries', () => {
  const settings = { ...config, maxLatenessMs: 0 };
  const readings = [r('', -1, 0, -2), r('', 0, 1, 2), r('', 0, 2, 4), r('', -1, 3, 100)];
  const stream = createStream(settings);
  const results = readings.flatMap((reading) => stream.push(reading));
  results.push(...stream.end());
  assert.deepEqual(results.sort(order), summarize(readings, settings));
});

test('mixed acceptance cases preserve inputs and agree with batch summaries', () => {
  const readings = [
    r('__proto__', 1, 1, null), r('__proto__', 1, 1, 10),
    r('__proto__', 12, 2, -40), r('__proto__', 8, 3, 125),
    r('__proto__', 6, 4, 100), r('b', 0, 1, Infinity), r('b', 0, 2, -Infinity),
    r('b', 0, 3, NaN), r('b', 0, 4, 126), r('b', 0, 5, 0), r('__proto__', 30, 5, 1),
  ];
  const before = structuredClone(readings);
  readings.forEach(Object.freeze);
  Object.freeze(readings);
  const stream = createStream(config);
  const results = readings.flatMap((reading) => stream.push(reading));
  results.push(...stream.end());
  assert.deepEqual(results.sort(order), summarize(readings, config));
  assert.deepEqual(readings, before);
});

test('generated messy streams agree with batch summaries across multiple seeds', () => {
  for (const seed of [1, 7, 42]) {
    const readings = generate({ seed, devices: 3, minutes: 3 });
    const stream = createStream(DEFAULT_CONFIG);
    const results = readings.flatMap((reading) => stream.push(reading));
    results.push(...stream.end());
    assert.deepEqual(results.sort(order), summarize(readings, DEFAULT_CONFIG), `seed ${seed}`);
  }
});

test('end is idempotent, push after end fails, and instances are independent', () => {
  const first = createStream(config);
  const second = createStream(config);
  assert.deepEqual(first.end(), []);
  assert.deepEqual(first.end(), []);
  assert.throws(() => first.push(r('a', 0, 1)), /after end/);
  second.push(r('a', 0, 1));
  assert.equal(second.end().length, 1);
  assert.deepEqual(Object.keys(second).sort(), ['end', 'push']);
});

test('stream captures settings rather than observing later caller mutations', () => {
  const settings = { ...config, validRange: { min: 0, max: 10 }, streamLimits: { maxDevices: 1 } };
  const stream = createStream(settings);
  settings.windowMs = 100;
  settings.validRange.max = 0;
  settings.streamLimits.maxDevices = 0;
  stream.push(r('a', 10, 1, 5));
  assert.deepEqual(stream.end().map(withoutP95), [
    { deviceId: 'a', windowStart: 10, count: 1, min: 5, max: 5, avg: 5 },
  ]);
});

test('stream rejects window or lateness configuration that cannot support safe closure', () => {
  for (const windowMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => createStream({ ...config, windowMs }), RangeError);
  }
  for (const maxLatenessMs of [-1, NaN, Infinity]) {
    assert.throws(() => createStream({ ...config, maxLatenessMs }), RangeError);
  }
});
