import type { Config, Reading, WindowSummary } from './types.ts';
import { acceptReading, type AcceptanceState } from './reading-acceptance.ts';
import { compareDeviceIds } from './compare-device-ids.ts';
import { addToWindow, toWindowSummary, type Aggregate } from './window-aggregation.ts';

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

    addToWindow(windows, ts, value, config.windowMs);
  }

  const summaries: WindowSummary[] = [];

  for (const [deviceId, windows] of devices) {
    for (const [windowStart, window] of windows) {
      summaries.push(toWindowSummary(deviceId, windowStart, window));
    }
  }

  return summaries.sort((a, b) =>
    compareDeviceIds(a.deviceId, b.deviceId) || a.windowStart - b.windowStart,
  );
}
