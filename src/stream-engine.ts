import type { Config, Reading, StreamLimits, WindowSummary } from './types.ts';
import type { Stream } from './stream.ts';
import { isValidValue } from './reading-acceptance.ts';
import { resolveHistogramConfig } from './histogram.ts';
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
  const histogramConfig = resolveHistogramConfig(config);
  const limits = resolveStreamLimits(config.streamLimits);
  if (!Number.isFinite(windowMs) || windowMs <= 0 ||
      !Number.isFinite(maxLatenessMs) || maxLatenessMs < 0) {
    throw new RangeError('Streaming requires positive finite windowMs and nonnegative finite maxLatenessMs');
  }

  const devices = new Map<string, DeviceState>();
  let retainedSequences = 0;
  let retainedHistogramBytes = 0;
  let ended = false;
  let failure: Error | undefined;

  function abort(error: Error): never {
    failure = error;
    devices.clear();
    retainedSequences = 0;
    retainedHistogramBytes = 0;
    throw failure;
  }

  function fail(limit: keyof StreamLimits): never {
    return abort(new StreamLimitError(limit, limits[limit]));
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
          retainedHistogramBytes -= aggregate.histogram?.counts.byteLength ?? 0;
          device.windows.delete(start);
        }
      }
    }

    // Prune before checking capacity, and never discard still-relevant history.
    if (retainedSequences >= limits.maxRetainedSequences) fail('maxRetainedSequences');
    device.seen.set(seq, ts);
    retainedSequences += 1;
    if (valid) {
      const start = Math.floor(ts / windowMs) * windowMs;
      const additionalBytes = device.windows.has(start) ? 0 : histogramConfig.byteLength;
      if (additionalBytes > limits.maxHistogramBytes - retainedHistogramBytes) fail('maxHistogramBytes');
      try {
        addToWindow(device.windows, ts, value, windowMs, histogramConfig);
      } catch (error) {
        // Allocation/precision failure cannot leave a partially usable stream.
        if (error instanceof Error) abort(error);
        throw error;
      }
      retainedHistogramBytes += additionalBytes;
    }
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
    retainedHistogramBytes = 0;
    ended = true;
    return completed;
  }

  const stream: Stream = { push, end };
  return {
    stream,
    retainedCounts() {
      let sequences = 0;
      let windows = 0;
      let histogramBytes = 0;
      for (const device of devices.values()) {
        sequences += device.seen.size;
        windows += device.windows.size;
        for (const aggregate of device.windows.values()) {
          histogramBytes += aggregate.histogram?.counts.byteLength ?? 0;
        }
      }
      return { devices: devices.size, sequences, windows, histogramBytes };
    },
  };
}
