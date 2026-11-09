import type { Config } from './types.ts';

/** Defaults used by the CLI and the sample data. Tests pass their own config. */
export const DEFAULT_CONFIG: Config = {
  windowMs: 60_000,
  maxLatenessMs: 5_000,
  gapMs: 10_000,
  validRange: { min: -40, max: 125 },
};
