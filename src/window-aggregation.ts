import type { WindowSummary } from './types.ts';

export type Aggregate = { count: number; sum: number; min: number; max: number };

export function addToWindow(windows: Map<number, Aggregate>, ts: number, value: number, windowMs: number): void {
  const start = Math.floor(ts / windowMs) * windowMs;
  const aggregate = windows.get(start);
  if (aggregate) {
    aggregate.count += 1;
    aggregate.sum += value;
    aggregate.min = Math.min(aggregate.min, value);
    aggregate.max = Math.max(aggregate.max, value);
  } else {
    windows.set(start, { count: 1, sum: value, min: value, max: value });
  }
}

export function toWindowSummary(deviceId: string, windowStart: number, aggregate: Aggregate): WindowSummary {
  return {
    deviceId, windowStart,
    count: aggregate.count,
    min: aggregate.min,
    max: aggregate.max,
    avg: aggregate.sum / aggregate.count,
  };
}
