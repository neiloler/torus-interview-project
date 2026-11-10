import type { Config } from './types.ts';

export type HistogramConfig = Readonly<{
  min: number;
  width: number;
  bucketCount: number;
  byteLength: number;
}>;

export type Histogram = { config: HistogramConfig; counts: Float64Array };

/** Resolve once, before processing input, and snapshot caller-owned settings. */
export function resolveHistogramConfig(config: Config): HistogramConfig {
  const bucketCount = config.p95BucketCount ?? 825;
  const { min, max } = config.validRange;
  const span = max - min;
  const width = span / bucketCount;
  if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 65_536) {
    throw new RangeError('p95BucketCount must be an integer from 1 through 65536');
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(span) ||
      span < 0 || (span > 0 && width === 0)) {
    throw new RangeError('p95 requires a finite ordered range and representable bucket width');
  }
  return { min, width, bucketCount, byteLength: bucketCount * Float64Array.BYTES_PER_ELEMENT };
}

/** Values have already passed acceptance. Only the maximum needs an upper clamp. */
export function addHistogramValue(histogram: Histogram, value: number): void {
  const { min, width, bucketCount } = histogram.config;
  const index = width === 0 ? 0 : Math.max(0, Math.min(bucketCount - 1, Math.floor((value - min) / width)));
  histogram.counts[index] += 1;
}

/** Count is guarded by the aggregate before any histogram updates. */
export function histogramP95(histogram: Histogram, count: number, min: number, max: number): number {
  if (min === max) return min;
  // Equivalent to ceil(0.95 * count), without rounding a large product.
  const rank = count - Math.floor(count / 20);
  let cumulative = 0;
  for (let index = 0; index < histogram.counts.length; index += 1) {
    cumulative += histogram.counts[index];
    if (cumulative >= rank) {
      const midpoint = histogram.config.min + (index + 0.5) * histogram.config.width;
      return Math.max(min, Math.min(max, midpoint));
    }
  }
  throw new Error('Histogram counts do not match the window count');
}
