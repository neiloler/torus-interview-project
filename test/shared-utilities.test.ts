import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptReading, isValidValue, type AcceptanceState } from '../src/reading-acceptance.ts';
import { compareDeviceIds } from '../src/compare-device-ids.ts';
import type { Config, Reading } from '../src/types.ts';

const config: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};

test('isValidValue accepts finite values within inclusive configured bounds', () => {
  const cases: [Reading['value'], boolean][] = [
    [null, false], [NaN, false], [Infinity, false], [-Infinity, false],
    [-41, false], [-40, true], [0, true], [125, true], [126, false],
  ];
  for (const [value, expected] of cases) {
    assert.equal(isValidValue(value, config.validRange), expected, String(value));
  }
  assert.equal(isValidValue(3, { min: 2, max: 2 }), false);
  assert.equal(isValidValue(2, { min: 2, max: 2 }), true);
});

test('acceptReading tracks all sequences and only advances accepted time per device', () => {
  const devices = new Map<string, AcceptanceState>();
  const cases: [Reading, boolean, number][] = [
    [{ deviceId: 'a', ts: 10_000, seq: 1, value: 1 }, true, 10_000],
    [{ deviceId: 'a', ts: 100_000, seq: 2, value: null }, false, 10_000],
    [{ deviceId: 'a', ts: 100_000, seq: 2, value: 10 }, false, 10_000],
    [{ deviceId: 'a', ts: 6_000, seq: 3, value: 2 }, true, 10_000],
    [{ deviceId: 'a', ts: 5_000, seq: 4, value: 3 }, true, 10_000],
    [{ deviceId: 'a', ts: 4_999, seq: 5, value: 4 }, false, 10_000],
    [{ deviceId: 'a', ts: 10_000, seq: 1, value: 5 }, false, 10_000],
    [{ deviceId: 'b', ts: 1_000, seq: 1, value: 6 }, true, 1_000],
    [{ deviceId: 'a', ts: 11_000, seq: 6, value: 7 }, true, 11_000],
    [{ deviceId: 'a', ts: 5_900, seq: 7, value: 8 }, false, 11_000],
  ];
  for (const [reading, accepted, newestTs] of cases) {
    const label = `${reading.deviceId}, seq ${reading.seq}, value ${reading.value}`;
    assert.equal(acceptReading(reading, devices, config), accepted, label);
    assert.equal(devices.get(reading.deviceId)?.newestTs, newestTs, label);
    assert.ok(devices.get(reading.deviceId)?.seen.has(reading.seq), label);
  }
});

test('compareDeviceIds uses plain string ordering and handles equality', () => {
  const cases: [string, string, number][] = [
    ['Z', 'a', -1], ['a', 'Z', 1], ['a', 'a', 0], ['', 'a', -1], ['10', '2', -1],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(compareDeviceIds(a, b), expected, `${a} versus ${b}`);
  }
});
