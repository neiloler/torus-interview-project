import type { Config, Reading, WindowSummary } from './types.ts';

type Aggregate = {
  count: number;
  sum: number;
  min: number;
  max: number;
};

type DeviceState = {
  seen: Set<number>;
  newestTs: number;
  windows: Map<number, Aggregate>;
};

/**
 * Tier 1. Clean `readings` (given in arrival order) and summarize each
 * device's accepted readings per window. See "Rules" in the README.
 */
export function summarize(readings: Reading[], config: Config): WindowSummary[] {
  const devices = new Map<string, DeviceState>();

  for (const { deviceId, ts, seq, value } of readings) {
    let device = devices.get(deviceId);

    if (!device) {
      device = {
        seen: new Set(),
        newestTs: -Infinity,
        windows: new Map(),
      };
      devices.set(deviceId, device);
    }

    if (device.seen.has(seq)) continue;

    // Rejected readings also make subsequent resends duplicates.
    device.seen.add(seq);

    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < config.validRange.min ||
      value > config.validRange.max
    ) {
      continue;
    }

    if (ts < device.newestTs - config.maxLatenessMs) continue;

    device.newestTs = Math.max(device.newestTs, ts);

    const windowStart = Math.floor(ts / config.windowMs) * config.windowMs;
    const window = device.windows.get(windowStart);

    if (window) {
      window.count += 1;
      window.sum += value;
      window.min = Math.min(window.min, value);
      window.max = Math.max(window.max, value);
    } else {
      device.windows.set(windowStart, {
        count: 1,
        sum: value,
        min: value,
        max: value,
      });
    }
  }

  const summaries: WindowSummary[] = [];

  for (const [deviceId, device] of devices) {
    for (const [windowStart, window] of device.windows) {
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

  return summaries.sort((a, b) => {
    if (a.deviceId < b.deviceId) return -1;
    if (a.deviceId > b.deviceId) return 1;
    return a.windowStart - b.windowStart;
  });
}
