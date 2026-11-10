import type { StreamLimits } from './types.ts';

export const DEFAULT_STREAM_LIMITS: Readonly<StreamLimits> = Object.freeze({
  maxDevices: 1_000,
  maxRetainedSequences: 100_000,
  maxHistogramBytes: 16 * 1024 * 1024,
});

export function resolveStreamLimits(options: Partial<StreamLimits> = {}): StreamLimits {
  const limits = {
    maxDevices: options.maxDevices ?? DEFAULT_STREAM_LIMITS.maxDevices,
    maxRetainedSequences: options.maxRetainedSequences ?? DEFAULT_STREAM_LIMITS.maxRetainedSequences,
    maxHistogramBytes: options.maxHistogramBytes ?? DEFAULT_STREAM_LIMITS.maxHistogramBytes,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

/** A terminal failure: the stream releases its retained state and cannot resume. */
export class StreamLimitError extends Error {
  readonly limit: keyof StreamLimits;
  readonly maximum: number;

  constructor(limit: keyof StreamLimits, maximum: number) {
    super(`Stream limit ${limit} (${maximum}) exceeded`);
    this.name = 'StreamLimitError';
    this.limit = limit;
    this.maximum = maximum;
  }
}
