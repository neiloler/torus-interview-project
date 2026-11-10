import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToWindow, toWindowSummary, type Aggregate } from '../src/window-aggregation.ts';
import { withoutP95 } from './helpers/percentile.ts';
import { resolveHistogramConfig } from '../src/histogram.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('addToWindow groups values by epoch-aligned windows and updates statistics', () => {
  const windows = new Map<number, Aggregate>();
  addToWindow(windows, -1, -2, 10);
  addToWindow(windows, 0, 4, 10);
  addToWindow(windows, 9, 2, 10);
  addToWindow(windows, 10, 0, 10);
  assert.deepEqual([...windows].map(([start, { count, sum, min, max }]) => [start, { count, sum, min, max }]), [
    [-10, { count: 1, sum: -2, min: -2, max: -2 }],
    [0, { count: 2, sum: 6, min: 2, max: 4 }],
    [10, { count: 1, sum: 0, min: 0, max: 0 }],
  ]);
  const histogram = { config: resolveHistogramConfig(DEFAULT_CONFIG), counts: new Float64Array(825) };
  histogram.counts[0] = Number.MAX_SAFE_INTEGER;
  const full = Object.freeze({ count: Number.MAX_SAFE_INTEGER, sum: 0, min: -40, max: -40, histogram });
  windows.set(20, full);
  assert.throws(() => addToWindow(windows, 20, -40, 10), RangeError);
  assert.equal(histogram.counts[0], Number.MAX_SAFE_INTEGER);
  assert.equal(windows.get(20), full);
});

test('toWindowSummary produces an average without exposing or changing the aggregate', () => {
  const aggregate = Object.freeze({ count: 2, sum: 3, min: 1, max: 2 });
  assert.deepEqual(withoutP95(toWindowSummary('a', 10, aggregate)), {
    deviceId: 'a', windowStart: 10, count: 2, min: 1, max: 2, avg: 1.5,
  });
});
