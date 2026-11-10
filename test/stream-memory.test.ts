import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamEngine } from '../src/stream-engine.ts';
import { StreamLimitError, DEFAULT_CONFIG, type Config, type Reading } from '../src/index.ts';

const config: Config = { ...DEFAULT_CONFIG, windowMs: 10, maxLatenessMs: 5 };
const r = (deviceId: string, ts: number, seq: number, value: number | null = 1): Reading => ({ deviceId, ts, seq, value });

// Histogram bytes have their own assertions in p95-memory.test.ts.
function coreCounts(engine: ReturnType<typeof createStreamEngine>) {
  const { devices, sequences, windows } = engine.retainedCounts();
  return { devices, sequences, windows };
}

test('retained state stays constant over long progress and end releases everything', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxDevices: 1, maxRetainedSequences: 1 } });
  let emitted = 0;
  for (let i = 0; i < 10_000; i++) {
    emitted += engine.stream.push(r('a', i * 10, i)).length;
    // One window may straddle the cutoff even after its last sequence expires.
    assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 1, windows: Math.min(i + 1, 2) });
  }
  assert.equal(emitted, 9_998);
  assert.equal(engine.stream.end().length, 2);
  assert.deepEqual(coreCounts(engine), { devices: 0, sequences: 0, windows: 0 });
});

test('a stalled timestamp hits the sequence cap, releases state, and cannot resume', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxRetainedSequences: 2 } });
  engine.stream.push(r('a', 0, 1));
  engine.stream.push(r('a', 0, 2));
  assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 2, windows: 1 });
  assert.throws(() => engine.stream.push(r('a', 0, 3)), { name: 'StreamLimitError', limit: 'maxRetainedSequences', maximum: 2 });
  assert.deepEqual(coreCounts(engine), { devices: 0, sequences: 0, windows: 0 });
  assert.throws(() => engine.stream.end(), StreamLimitError);
  assert.throws(() => engine.stream.push(r('a', 100, 4)), StreamLimitError);
});

test('invalid-only readings count toward capacity even without accepted progress', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxRetainedSequences: 2 } });
  engine.stream.push(r('a', 100, 1, null));
  engine.stream.push(r('a', 200, 2, null));
  assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 2, windows: 0 });
  assert.throws(() => engine.stream.push(r('a', 300, 3, null)), StreamLimitError);
});

test('invalid future records remain remembered while older accepted records expire', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxRetainedSequences: 2 } });
  engine.stream.push(r('a', 0, 1));
  engine.stream.push(r('a', 100, 2, null));
  engine.stream.push(r('a', 10, 3));
  assert.deepEqual(engine.stream.push(r('a', 100, 2, 10)), []);
  assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 2, windows: 2 });
  assert.equal(engine.stream.push(r('a', 20, 4)).length, 1);
  assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 2, windows: 2 });
});

test('records at the cutoff stay remembered; evicted resends stay too late', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxRetainedSequences: 2 } });
  engine.stream.push(r('a', 10, 1));
  engine.stream.push(r('a', 5, 2, null));
  assert.deepEqual(engine.stream.push(r('a', 5, 2, 100)), []);
  engine.stream.push(r('a', 11, 3)); // Cutoff 6: forget seq 2, freeing a slot.
  assert.deepEqual(engine.stream.push(r('a', 5, 2, 100)), []);
  assert.deepEqual(engine.stream.push(r('a', 11, 3, 100)), []); // Duplicate at capacity.
  assert.deepEqual(coreCounts(engine), { devices: 1, sequences: 2, windows: 1 });
  assert.equal(engine.stream.end()[0].count, 2);
});

test('sequence capacity is global across devices, including quiet ones', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxRetainedSequences: 2 } });
  engine.stream.push(r('a', 0, 1));
  engine.stream.push(r('b', 0, 1));
  assert.throws(() => engine.stream.push(r('a', 0, 2)), StreamLimitError);
});

test('device capacity includes quiet and invalid-only devices', () => {
  const engine = createStreamEngine({ ...config, streamLimits: { maxDevices: 2 } });
  engine.stream.push(r('a', 0, 1));
  engine.stream.push(r('b', 0, 1, null));
  engine.stream.push(r('a', 100, 2));
  assert.equal(engine.retainedCounts().devices, 2);
  assert.throws(() => engine.stream.push(r('c', 0, 1)), { name: 'StreamLimitError', limit: 'maxDevices', maximum: 2 });
  assert.deepEqual(coreCounts(engine), { devices: 0, sequences: 0, windows: 0 });
});
