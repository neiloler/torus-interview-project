import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGaps, type Config, type Gap, type Reading } from '../src/index.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

const r = (deviceId: string, ts: number, seq: number, value: number | null = 1): Reading => ({
  deviceId, ts, seq, value,
});

test('no gaps exist without two accepted readings from the same device', () => {
  const cases: Reading[][] = [
    [],
    [r('a', 1_000, 1)],
    [r('a', 1_000, 1, null), r('a', 20_000, 2, 126)],
    [r('a', 1_000, 1), r('a', 20_000, 2, null)],
    [r('a', 1_000, 1), r('b', 20_000, 1)],
  ];
  for (const readings of cases) {
    assert.deepEqual(detectGaps(readings, config), [], JSON.stringify(readings));
  }
});

test('only silence strictly greater than gapMs is a gap', () => {
  const cases: [number, Gap[]][] = [
    [9_999, []],
    [10_000, []],
    [10_001, [{ deviceId: 'a', start: 123, end: 10_124 }]],
  ];
  for (const [distance, expected] of cases) {
    assert.deepEqual(detectGaps([r('a', 123, 1), r('a', 123 + distance, 2)], config), expected);
  }
});

test('accepted out-of-order timestamps split a gap into consecutive intervals', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 30_000, 2), r('a', 15_000, 3),
  ], { ...config, maxLatenessMs: 15_000 }), [
    { deviceId: 'a', start: 0, end: 15_000 },
    { deviceId: 'a', start: 15_000, end: 30_000 },
  ]);
});

test('too-late arrivals cannot split a gap: acceptance must precede sorting', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 30_000, 2), r('a', 15_000, 3),
  ], config), [
    { deviceId: 'a', start: 0, end: 30_000 },
  ]);
});

test('an invalid reading and its valid resend cannot split a gap', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 15_000, 2, null), r('a', 15_000, 2, 10), r('a', 30_000, 3),
  ], config), [
    { deviceId: 'a', start: 0, end: 30_000 },
  ]);
});

test('invalid future readings and their resends do not advance accepted time', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 100_000, 2, null), r('a', 100_000, 2, 10), r('a', 15_000, 3),
  ], config), [
    { deviceId: 'a', start: 0, end: 15_000 },
  ]);
});

test('duplicate and equal timestamps do not repeat gaps or create zero-length gaps', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 0, 2), r('a', 20_000, 3),
    r('a', 20_000, 3, 10), r('a', 20_000, 4), r('a', 40_000, 5),
  ], config), [
    { deviceId: 'a', start: 0, end: 20_000 },
    { deviceId: 'a', start: 20_000, end: 40_000 },
  ]);
});

test('devices have independent clocks and sequences; output uses string then numeric order', () => {
  assert.deepEqual(detectGaps([
    r('a', 101_000, 1), r('Z', 1_000, 1),
    r('a', 100_020, 2), r('Z', 20, 2),
    r('a', 100_100, 3), r('Z', 100, 3),
  ], { ...config, maxLatenessMs: 1_000, gapMs: 10 }), [
    { deviceId: 'Z', start: 20, end: 100 },
    { deviceId: 'Z', start: 100, end: 1_000 },
    { deviceId: 'a', start: 100_020, end: 100_100 },
    { deviceId: 'a', start: 100_100, end: 101_000 },
  ]);
});

test('gap endpoints are actual timestamps, including negatives and across window boundaries', () => {
  assert.deepEqual(detectGaps([
    r('a', -20, 1), r('a', -5, 2), r('a', 10, 3),
  ], { ...config, windowMs: 10, gapMs: 10 }), [
    { deviceId: 'a', start: -20, end: -5 },
    { deviceId: 'a', start: -5, end: 10 },
  ]);
});

test('zero gapMs reports any positive separation but not equal timestamps', () => {
  assert.deepEqual(detectGaps([
    r('a', 0, 1), r('a', 0, 2), r('a', 1, 3),
  ], { ...config, gapMs: 0 }), [
    { deviceId: 'a', start: 0, end: 1 },
  ]);
});

test('gap detection leaves the input array and its readings unchanged', () => {
  const readings = [r('a', 0, 1), r('a', 30_000, 2), r('a', 15_000, 3)];
  const before = structuredClone(readings);
  readings.forEach(Object.freeze);
  Object.freeze(readings);
  assert.deepEqual(detectGaps(readings, { ...config, maxLatenessMs: 15_000 }), [
    { deviceId: 'a', start: 0, end: 15_000 },
    { deviceId: 'a', start: 15_000, end: 30_000 },
  ]);
  assert.deepEqual(readings, before);
});

test('separate calls do not share acceptance history or gap results', () => {
  const readings = [r('a', 0, 1), r('a', 20_000, 2)];
  const expected = [{ deviceId: 'a', start: 0, end: 20_000 }];
  assert.deepEqual(detectGaps(readings, config), expected);
  assert.deepEqual(detectGaps([], config), []);
  assert.deepEqual(detectGaps(readings, config), expected);
});
