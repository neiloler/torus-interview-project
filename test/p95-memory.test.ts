import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, StreamLimitError, type Reading } from '../src/index.ts';
import { createStreamEngine } from '../src/stream-engine.ts';
import { resolveStreamLimits } from '../src/stream-limits.ts';
import { readP95 } from './helpers/percentile.ts';

const config = { ...DEFAULT_CONFIG, windowMs: 10, maxLatenessMs: 0,
  validRange: { min: 0, max: 100 }, p95BucketCount: 10 };
const r = (deviceId: string, ts: number, seq: number, value: number | null = 1): Reading => ({ deviceId, ts, seq, value });
const limits = (maxHistogramBytes: number) => ({ maxDevices: 100, maxHistogramBytes });

function histogramBytes(engine: ReturnType<typeof createStreamEngine>): number {
  const snapshot = engine.retainedCounts();
  assert.ok('histogramBytes' in snapshot, 'internal diagnostics must report actual histogram bytes');
  assert.ok(typeof snapshot.histogramBytes === 'number');
  return snapshot.histogramBytes;
}

test('histogram budget defaults to 16 MiB and validates explicit byte limits', () => {
  const defaults = resolveStreamLimits();
  assert.ok('maxHistogramBytes' in defaults);
  assert.equal(defaults.maxHistogramBytes, 16 * 1024 * 1024);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveStreamLimits(limits(value)), RangeError);
  }
  assert.equal(histogramBytes(createStreamEngine({ ...config, streamLimits: limits(1) })), 0);
});

test('histogram bytes stay constant as one open window accumulates 10,000 readings', () => {
  const engine = createStreamEngine({ ...config, windowMs: 20_000,
    streamLimits: { ...limits(80), maxRetainedSequences: 1 } });
  for (let i = 0; i < 10_000; i++) {
    assert.deepEqual(engine.stream.push(r('a', i, i, i < 9_500 ? 10 : 100)), []);
    assert.equal(histogramBytes(engine), 80);
  }
  const summary = engine.stream.end()[0];
  assert.equal(summary.count, 10_000);
  assert.equal(readP95(summary), 15);
  assert.equal(histogramBytes(engine), 0);
});

test('rejected readings allocate no histogram; an undersized budget fails on the first accepted window', () => {
  const engine = createStreamEngine({ ...config, streamLimits: limits(79) });
  engine.stream.push(r('a', 0, 1, null));
  engine.stream.push(r('a', 0, 1, 100)); // Valid resend remains rejected.
  assert.equal(histogramBytes(engine), 0);
  assert.throws(() => engine.stream.push(r('a', 0, 2)), {
    name: 'StreamLimitError', limit: 'maxHistogramBytes', maximum: 79,
  });
  assert.equal(histogramBytes(engine), 0);
  assert.throws(() => engine.stream.end(), StreamLimitError);
});

test('window closure frees histogram capacity before the next allocation', () => {
  const engine = createStreamEngine({ ...config, streamLimits: limits(80) });
  for (let i = 0; i < 1_000; i++) {
    const closed = engine.stream.push(r('a', i * 10, i));
    assert.equal(closed.length, i === 0 ? 0 : 1);
    assert.equal(histogramBytes(engine), 80);
  }
  assert.equal(readP95(engine.stream.end()[0]), 1);
  assert.equal(histogramBytes(engine), 0);
});

test('quiet devices share one histogram budget, and exceeding it releases all stream state', () => {
  const engine = createStreamEngine({ ...config, streamLimits: limits(160) });
  engine.stream.push(r('a', 0, 1));
  engine.stream.push(r('b', 0, 1));
  engine.stream.push(r('a', 1, 2)); // Updating an existing histogram needs no new bytes.
  assert.throws(() => engine.stream.push(r('c', 0, 1)), {
    name: 'StreamLimitError', limit: 'maxHistogramBytes', maximum: 160,
  });
  assert.deepEqual(engine.retainedCounts(), { devices: 0, sequences: 0, windows: 0, histogramBytes: 0 });
  assert.throws(() => engine.stream.push(r('a', 100, 3)), StreamLimitError);
  assert.throws(() => engine.stream.end(), StreamLimitError);
});

test('accepted late readings can open another histogram, and only eligible windows release bytes', () => {
  const engine = createStreamEngine({ ...config, maxLatenessMs: 5, streamLimits: limits(160) });
  engine.stream.push(r('a', 11, 1));
  engine.stream.push(r('a', 9, 2));
  assert.equal(histogramBytes(engine), 160);
  assert.equal(engine.stream.push(r('a', 16, 3)).length, 1);
  assert.equal(histogramBytes(engine), 80);
  engine.stream.end();
  assert.equal(histogramBytes(engine), 0);
});
