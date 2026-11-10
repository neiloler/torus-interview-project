import type { WindowSummary } from './types.ts';
import { addHistogramValue, histogramP95, type Histogram, type HistogramConfig } from './histogram.ts';

export type Aggregate = { count: number; sum: number; min: number; max: number; histogram?: Histogram };

/** Use the README's assignment rule for both aggregation and stream closure. */
export function getWindowStart(ts: number, windowMs: number): number {
  return Math.floor(ts / windowMs) * windowMs;
}

export function addToWindow(
  windows: Map<number, Aggregate>, ts: number, value: number, windowMs: number,
  histogramConfig?: HistogramConfig,
): void {
  const start = getWindowStart(ts, windowMs);
  const aggregate = windows.get(start);
  if (aggregate) {
    if (aggregate.count >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Window count exceeds safe integer precision');
    }
    if (aggregate.histogram) addHistogramValue(aggregate.histogram, value);
    aggregate.count += 1;
    aggregate.sum += value;
    aggregate.min = Math.min(aggregate.min, value);
    aggregate.max = Math.max(aggregate.max, value);
  } else {
    const histogram = histogramConfig
      ? { config: histogramConfig, counts: new Float64Array(histogramConfig.bucketCount) }
      : undefined;
    if (histogram) addHistogramValue(histogram, value);
    windows.set(start, { count: 1, sum: value, min: value, max: value, histogram });
  }
}

export function toWindowSummary(deviceId: string, windowStart: number, aggregate: Aggregate): WindowSummary {
  return {
    deviceId, windowStart,
    count: aggregate.count,
    min: aggregate.min,
    max: aggregate.max,
    avg: aggregate.sum / aggregate.count,
    ...(aggregate.histogram ? {
      p95: histogramP95(aggregate.histogram, aggregate.count, aggregate.min, aggregate.max),
    } : {}),
  };
}
