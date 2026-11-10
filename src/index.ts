export type { Config, Gap, Reading, StreamLimits, WindowSummary } from './types.ts';
export { DEFAULT_CONFIG } from './config.ts';
export { summarize } from './summarize.ts';
export { detectGaps } from './gaps.ts';
export { createStream, type Stream } from './stream.ts';
export { DEFAULT_STREAM_LIMITS, StreamLimitError } from './stream-limits.ts';
