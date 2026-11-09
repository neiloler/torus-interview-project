import type { Config, Gap, Reading } from './types.ts';

/**
 * Tier 2. Report every gap in each device's accepted readings.
 * See "Tier 2" in the README.
 */
export function detectGaps(readings: Reading[], config: Config): Gap[] {
  throw new Error('not implemented');
}
