import type { Config, Reading, WindowSummary } from './types.ts';

export type Stream = {
  /** Accept one reading, in arrival order. Returns any windows that just became final. */
  push(reading: Reading): WindowSummary[];
  /** The input is over. Returns every window still open. */
  end(): WindowSummary[];
};

/**
 * Tier 2. A streaming version of `summarize` that holds bounded memory.
 * See "Tier 2" in the README.
 */
export function createStream(config: Config): Stream {
  throw new Error('not implemented');
}
