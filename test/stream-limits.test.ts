import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStreamLimits, DEFAULT_STREAM_LIMITS } from '../src/stream-limits.ts';

test('resolveStreamLimits supplies defaults, allows partial overrides, and rejects invalid counts', () => {
  assert.deepEqual(resolveStreamLimits(), DEFAULT_STREAM_LIMITS);
  assert.deepEqual(resolveStreamLimits({ maxDevices: 2 }), { ...DEFAULT_STREAM_LIMITS, maxDevices: 2 });
  assert.deepEqual(resolveStreamLimits({ maxRetainedSequences: 3 }), { ...DEFAULT_STREAM_LIMITS, maxRetainedSequences: 3 });
  for (const key of ['maxDevices', 'maxRetainedSequences'] as const) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => resolveStreamLimits({ [key]: value }), RangeError);
    }
  }
});
