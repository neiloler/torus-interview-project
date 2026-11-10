import type { Config, Reading, WindowSummary } from './types.ts';
import { acceptReading, type AcceptanceState } from './reading-acceptance.ts';
import { compareDeviceIds } from './compare-device-ids.ts';

type Aggregate = {
  count: number;
  sum: number;
  min: number;
  max: number;
};

/**
 * Tier 1. Clean `readings` (given in arrival order) and summarize each
 * device's accepted readings per window. See "Rules" in the README.
 */
export function summarize(readings: Reading[], config: Config): WindowSummary[] {
  const acceptance = new Map<string, AcceptanceState>();
  const devices = new Map<string, Map<number, Aggregate>>();

  for (const reading of readings) {
    if (!acceptReading(reading, acceptance, config)) continue;

    const { deviceId, ts, value } = reading;
    let windows = devices.get(deviceId);
    if (!windows) {
      windows = new Map();
      devices.set(deviceId, windows);
    }

    const windowStart = Math.floor(ts / config.windowMs) * config.windowMs;
    const window = windows.get(windowStart);

    if (window) {
      window.count += 1;
      window.sum += value;
      window.min = Math.min(window.min, value);
      window.max = Math.max(window.max, value);
    } else {
      windows.set(windowStart, {
        count: 1,
        sum: value,
        min: value,
        max: value,
      });
    }
  }

  const summaries: WindowSummary[] = [];

  for (const [deviceId, windows] of devices) {
    for (const [windowStart, window] of windows) {
      summaries.push({
        deviceId,
        windowStart,
        count: window.count,
        min: window.min,
        max: window.max,
        avg: window.sum / window.count,
      });
    }
  }

  return summaries.sort((a, b) =>
    compareDeviceIds(a.deviceId, b.deviceId) || a.windowStart - b.windowStart,
  );
}
