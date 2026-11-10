import assert from 'node:assert/strict';
import type { WindowSummary } from '../../src/types.ts';

export function readP95(summary: WindowSummary | undefined): number {
  assert.ok(summary, 'expected a window summary');
  assert.ok('p95' in summary, 'nonempty summaries must include p95');
  assert.ok(typeof summary.p95 === 'number' && Number.isFinite(summary.p95), 'p95 must be finite');
  return summary.p95;
}

/** Keep existing metric assertions independent of the new optional percentile. */
export function withoutP95(summary: WindowSummary & { p95?: number }): WindowSummary {
  const { p95, ...metrics } = summary;
  return metrics;
}
