import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, type Config, type Reading } from '../src/index.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

const r = (ts: number, seq: number, value: number | null, deviceId = 'a'): Reading => ({
  deviceId, ts, seq, value,
});

for (const value of [null, NaN, Infinity, -Infinity, -41, 126]) {
  test(`an invalid first arrival (${String(value)}) prevents a valid resend`, () => {
    assert.deepEqual(summarize([r(1_000, 1, value), r(1_000, 1, 10)], config), []);
  });
}

test('rejected readings create neither device summaries nor empty windows', () => {
  assert.deepEqual(summarize([
    r(1_000, 1, null, 'invalid-only'),
    r(1_000, 1, -Infinity),
    r(61_000, 2, 10),
    r(121_000, 3, null),
    r(1_000, 4, 20), // Too late for a window with no accepted readings.
  ], config), [
    { deviceId: 'a', windowStart: 60_000, count: 1, min: 10, max: 10, avg: 10 },
  ]);
});

test('invalid-first duplicates do not advance accepted time', () => {
  assert.deepEqual(summarize([
    r(9_000, 1, 1),
    r(100_000, 2, null),
    r(100_000, 2, 100), // Valid value, but still a duplicate.
    r(10_000, 3, 3),
  ], config), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 3, avg: 2 },
  ]);
});

test('accepted out-of-order readings do not move newest time backward', () => {
  assert.deepEqual(summarize([
    r(10_000, 1, 1), r(6_000, 2, 3), r(4_999, 3, 100),
  ], config), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 3, avg: 2 },
  ]);
});

test('accepted readings can update an earlier window after a later window starts', () => {
  assert.deepEqual(summarize([
    r(59_000, 1, 2), r(61_000, 2, 10), r(56_000, 3, 6), r(55_999, 4, 100),
  ], config), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 2, max: 6, avg: 4 },
    { deviceId: 'a', windowStart: 60_000, count: 1, min: 10, max: 10, avg: 10 },
  ]);
});

test('zero lateness accepts equal timestamps with distinct sequences', () => {
  assert.deepEqual(summarize([
    r(10_000, 1, 0), r(10_000, 2, 3), r(9_999, 3, 100),
  ], { ...config, maxLatenessMs: 0 }), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 0, max: 3, avg: 1.5 },
  ]);
});

test('custom windows use epoch boundaries, including negative timestamps', () => {
  assert.deepEqual(summarize([
    r(-1, 1, -2), r(-10, 2, 2), r(0, 3, 1), r(9, 4, 2), r(10, 5, 0), r(11, 6, 3),
  ], {
    ...config,
    windowMs: 10,
    maxLatenessMs: 9,
    validRange: { min: -2, max: 2 },
  }), [
    { deviceId: 'a', windowStart: -10, count: 2, min: -2, max: 2, avg: 0 },
    { deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 2, avg: 1.5 },
    { deviceId: 'a', windowStart: 10, count: 1, min: 0, max: 0, avg: 0 },
  ]);
});

test('device ordering uses plain string comparison, then numeric window start', () => {
  const readings = ['a', 'Z', 'A'].flatMap((id) => [r(100, 1, 1, id), r(20, 2, 1, id)]);
  const out = summarize(readings, { ...config, windowMs: 10 });
  assert.deepEqual(out.map((w) => [w.deviceId, w.windowStart]), [
    ['A', 20], ['A', 100], ['Z', 20], ['Z', 100], ['a', 20], ['a', 100],
  ]);
});

test('statistics stay separate for each device and window', () => {
  assert.deepEqual(summarize([
    r(1_000, 1, -10, 'b'), r(1_000, 1, 1), r(2_000, 2, 2),
    r(2_000, 2, 10, 'b'), r(61_000, 3, 100), r(61_000, 3, 20, 'b'),
  ], config), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 1, max: 2, avg: 1.5 },
    { deviceId: 'a', windowStart: 60_000, count: 1, min: 100, max: 100, avg: 100 },
    { deviceId: 'b', windowStart: 0, count: 2, min: -10, max: 10, avg: 0 },
    { deviceId: 'b', windowStart: 60_000, count: 1, min: 20, max: 20, avg: 20 },
  ]);
});

test('arbitrary string device IDs and sequence zero are supported', () => {
  assert.deepEqual(summarize([
    r(1, 0, 1, '__proto__'), r(1, 0, 2, 'constructor'), r(1, 0, 3, ''),
  ], config), [
    { deviceId: '', windowStart: 0, count: 1, min: 3, max: 3, avg: 3 },
    { deviceId: '__proto__', windowStart: 0, count: 1, min: 1, max: 1, avg: 1 },
    { deviceId: 'constructor', windowStart: 0, count: 1, min: 2, max: 2, avg: 2 },
  ]);
});

test('does not mutate the input array or any reading', () => {
  const readings = [r(61_000, 1, 10, 'b'), r(59_000, 2, 2), r(58_000, 3, 4)];
  const before = structuredClone(readings);
  readings.forEach(Object.freeze);
  Object.freeze(readings);

  assert.deepEqual(summarize(readings, config), [
    { deviceId: 'a', windowStart: 0, count: 2, min: 2, max: 4, avg: 3 },
    { deviceId: 'b', windowStart: 60_000, count: 1, min: 10, max: 10, avg: 10 },
  ]);
  assert.deepEqual(readings, before);
});

test('separate calls do not share duplicate history or aggregates', () => {
  const readings = [r(1_000, 1, 2), r(2_000, 2, 4)];
  const expected = [{ deviceId: 'a', windowStart: 0, count: 2, min: 2, max: 4, avg: 3 }];
  assert.deepEqual(summarize(readings, config), expected);
  assert.deepEqual(summarize(readings, config), expected);
});
