import type { Config, Reading } from './types.ts';

/** Full-history tracking for batch callers; not a bounded-memory stream store. */
export type AcceptanceState = {
  seen: Set<number>;
  newestTs: number;
};

export function isValidValue(value: Reading['value'], range: Config['validRange']): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** Updates caller-owned state in arrival order, including sequences of rejected readings. */
export function acceptReading(
  reading: Reading,
  devices: Map<string, AcceptanceState>,
  config: Config,
): reading is Reading & { value: number } {
  let device = devices.get(reading.deviceId);
  if (!device) {
    device = { seen: new Set(), newestTs: -Infinity };
    devices.set(reading.deviceId, device);
  }

  if (device.seen.has(reading.seq)) return false;
  device.seen.add(reading.seq);

  if (!isValidValue(reading.value, config.validRange)) return false;
  if (reading.ts < device.newestTs - config.maxLatenessMs) return false;

  device.newestTs = Math.max(device.newestTs, reading.ts);
  return true;
}
