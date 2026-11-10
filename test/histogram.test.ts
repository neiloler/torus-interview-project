import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { resolveHistogramConfig, addHistogramValue, histogramP95 } from '../src/histogram.ts';

test('resolveHistogramConfig snapshots the range, resolution, and allocation size', () => {
  const config = { ...DEFAULT_CONFIG, validRange: { min: -10, max: 10 }, p95BucketCount: 4 };
  const resolved = resolveHistogramConfig(config);
  config.validRange.min = 0;
  config.p95BucketCount = 1;
  assert.deepEqual(resolved, { min: -10, width: 5, bucketCount: 4, byteLength: 32 });
});

test('addHistogramValue counts repeated values and assigns boundaries to the right bucket', () => {
  const config = resolveHistogramConfig({ ...DEFAULT_CONFIG, validRange: { min: -10, max: 10 }, p95BucketCount: 4 });
  const histogram = { config, counts: new Float64Array(4) };
  for (const value of [-10, -5.001, -5, -5, 0, 10]) addHistogramValue(histogram, value);
  assert.deepEqual([...histogram.counts], [2, 2, 1, 1]);
});

test('histogramP95 uses nearest rank with safe integer counts, and clamps the midpoint', () => {
  const config = resolveHistogramConfig({ ...DEFAULT_CONFIG, validRange: { min: 0, max: 100 }, p95BucketCount: 2 });
  const histogram = { config, counts: new Float64Array([19, 1]) };
  assert.equal(histogramP95(histogram, 20, 0, 100), 25);
  assert.equal(histogramP95(histogram, 20, 30, 100), 30);
  const count = Number.MAX_SAFE_INTEGER;
  const rank = count - Math.floor(count / 20);
  histogram.counts.set([rank - 1, count - rank + 1]);
  assert.equal(histogramP95(histogram, count, 0, 100), 75);
  histogram.counts.set([rank, count - rank]);
  assert.equal(histogramP95(histogram, count, 0, 100), 25);
});
