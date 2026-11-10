import type { Config, Reading, WindowSummary } from './types.ts';
import { createStreamEngine } from './stream-engine.ts';

export type Stream = {
  /** Return newly final windows. Throws on resource exhaustion or after end; limit failures are terminal. */
  push(reading: Reading): WindowSummary[];
  /** Flush open windows and release state. Repeated calls return []; throws after a limit failure. */
  end(): WindowSummary[];
};

/**
 * Tier 2. A streaming version of `summarize` with configurable retained-state limits.
 * See "Tier 2" in the README.
 */
export function createStream(config: Config): Stream {
  return createStreamEngine(config).stream;
}
