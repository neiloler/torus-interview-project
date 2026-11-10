/** One measurement from one device. */
export type Reading = {
  /** Which device sent it. */
  deviceId: string;
  /** When it was measured, in milliseconds since the Unix epoch. */
  ts: number;
  /**
   * Per-device sequence number, assigned when the device takes the measurement.
   * A resent reading carries the same `seq` and `ts` as the original; its `value` may differ.
   */
  seq: number;
  /**
   * The measured value. May be invalid: `null` (how JSON writes `NaN`), `NaN`,
   * `Infinity`, or outside `Config.validRange`.
   */
  value: number | null;
};

/** Per-stream retained-state limits, not a process-wide byte budget. */
export type StreamLimits = {
  maxDevices: number;
  maxRetainedSequences: number;
  maxHistogramBytes: number;
};

export type Config = {
  /** Width of each tumbling window, in ms. Windows start at multiples of this. */
  windowMs: number;
  /**
   * How far a reading may lag behind the newest reading already accepted for the
   * same device and still be accepted, in ms.
   */
  maxLatenessMs: number;
  /** Silence longer than this between two accepted readings of a device is a gap, in ms. */
  gapMs: number;
  /** Inclusive bounds for a valid `value`. */
  validRange: { min: number; max: number };
  /** Equal-width percentile buckets (1..65536); defaults to 825. */
  p95BucketCount?: number;
  /** Optional streaming-only limits; omitted fields use conservative defaults. */
  streamLimits?: Partial<StreamLimits>;
};

/** Summary of one device's accepted readings within one window. */
export type WindowSummary = {
  deviceId: string;
  /** Start of the window, inclusive, in ms. The window ends at `windowStart + windowMs`, exclusive. */
  windowStart: number;
  count: number;
  min: number;
  max: number;
  avg: number;
  /** Approximate nearest-rank p95; histogram midpoint clamped to observed bounds. */
  p95?: number;
};

/** A period in which a device sent no accepted readings. */
export type Gap = {
  deviceId: string;
  /** `ts` of the last accepted reading before the silence. */
  start: number;
  /** `ts` of the first accepted reading after the silence. */
  end: number;
};
