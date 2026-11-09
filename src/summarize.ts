import type { Config, Reading, WindowSummary } from './types.ts';

/**
 * Tier 1. Clean `readings` (given in arrival order) and summarize each
 * device's accepted readings per window. See "Rules" in the README.
 */
export function summarize(readings: Reading[], config: Config): WindowSummary[] {
  throw new Error('not implemented');
}
