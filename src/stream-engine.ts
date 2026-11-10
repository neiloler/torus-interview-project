import type { Config, Reading, StreamLimits, WindowSummary } from './types.ts';
import type { Stream } from './stream.ts';
import { isValidValue } from './reading-acceptance.ts';
import { resolveStreamLimits, StreamLimitError } from './stream-limits.ts';
import { addToWindow, toWindowSummary, type Aggregate } from './window-aggregation.ts';

type DeviceState = {
  newestTs: number;
  seen: Map<number, number>;
  windows: Map<number, Aggregate>;
};

/** Internal engine. Diagnostics expose counts only and are absent from the public Stream. */
export function createStreamEngine(config: Config) {
  const { windowMs, maxLatenessMs } = config;
  const validRange = { ...config.validRange };
  const limits = resolveStreamLimits(config.streamLimits);
  if (!Number.isFinite(windowMs) || windowMs <= 0 ||
      !Number.isFinite(maxLatenessMs) || maxLatenessMs < 0) {
    throw new RangeError('Streaming requires positive finite windowMs and nonnegative finite maxLatenessMs');
  }

  const devices = new Map<string, DeviceState>();
  let retainedSequences = 0;
  let ended = false;
  let failure: StreamLimitError | undefined;

  function fail(limit: keyof StreamLimits): never {
    failure = new StreamLimitError(limit, limits[limit]);
    devices.clear();
    retainedSequences = 0;
    throw failure;
  }

  function push(reading: Reading): WindowSummary[] {
    if (failure) throw failure;
    if (ended) throw new Error('Cannot push after end');

    const { deviceId, ts, seq, value } = reading;
    let device = devices.get(deviceId);
    if (!device) {
      if (devices.size >= limits.maxDevices) fail('maxDevices');
      device = { newestTs: -Infinity, seen: new Map(), windows: new Map() };
      devices.set(deviceId, device);
    }

    // Forgotten resends retain their original timestamp, so they remain too late.
    if (ts < device.newestTs - maxLatenessMs || device.seen.has(seq)) return [];

    const valid = isValidValue(value, validRange);
    const completed: WindowSummary[] = [];
    if (valid && ts > device.newestTs) {
      device.newestTs = ts;
      const cutoff = ts - maxLatenessMs;
      // Scan the actual store: no separate expiry queue can accumulate stale entries.
      for (const [oldSeq, oldTs] of device.seen) {
        if (oldTs < cutoff) {
          device.seen.delete(oldSeq);
          retainedSequences -= 1;
        }
      }
      for (const [start, aggregate] of device.windows) {
        if (start + windowMs <= cutoff) {
          completed.push(toWindowSummary(deviceId, start, aggregate));
          device.windows.delete(start);
        }
      }
    }

    // Prune before checking capacity, and never discard still-relevant history.
    if (retainedSequences >= limits.maxRetainedSequences) fail('maxRetainedSequences');
    device.seen.set(seq, ts);
    retainedSequences += 1;
    if (valid) addToWindow(device.windows, ts, value, windowMs);
    return completed;
  }

  function end(): WindowSummary[] {
    if (failure) throw failure;
    if (ended) return [];
    const completed: WindowSummary[] = [];
    for (const [deviceId, device] of devices) {
      for (const [start, aggregate] of device.windows) {
        completed.push(toWindowSummary(deviceId, start, aggregate));
      }
    }
    devices.clear();
    retainedSequences = 0;
    ended = true;
    return completed;
  }

  const stream: Stream = { push, end };
  return {
    stream,
    retainedCounts() {
      let sequences = 0;
      let windows = 0;
      for (const device of devices.values()) {
        sequences += device.seen.size;
        windows += device.windows.size;
      }
      return { devices: devices.size, sequences, windows };
    },
  };
}
