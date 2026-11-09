// Generates messy readings, deterministically from a seed, in arrival order.
// Usage: node scripts/generate.ts [--seed 1] [--devices 3] [--minutes 5] > data/readings.json
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Reading } from '../src/types.ts';

export type GenerateOptions = { seed: number; devices: number; minutes: number };

// mulberry32: a tiny seeded PRNG, so the same seed always gives the same data.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate({ seed, devices, minutes }: GenerateOptions): Reading[] {
  const rand = prng(seed);
  const seconds = minutes * 60;
  const START = Date.UTC(2026, 0, 1);
  const arrivals: { at: number; reading: Reading }[] = [];

  for (let d = 0; d < devices; d++) {
    const deviceId = `dev-${String(d + 1).padStart(2, '0')}`;
    const base = 20 + rand() * 10;
    // Each device goes silent once, for 15-30 s, somewhere in the middle.
    const silenceFrom = Math.floor(seconds * (0.3 + rand() * 0.4));
    const silenceFor = 15 + Math.floor(rand() * 16);

    for (let i = 0; i < seconds; i++) {
      if (i >= silenceFrom && i < silenceFrom + silenceFor) continue;

      const ts = START + i * 1000 + Math.floor(rand() * 200);
      let value: number | null = Math.round((base + 3 * Math.sin(i / 30) + (rand() - 0.5)) * 100) / 100;
      const r = rand();
      if (r < 0.005) value = null; // JSON has no NaN; a failed read comes through as null
      else if (r < 0.01) value = 9999; // sensor fault: out of range

      // Usually delivered within 2 s; occasionally very late.
      const delay = rand() < 0.01 ? 8000 + rand() * 7000 : rand() * 2000;
      const reading: Reading = { deviceId, ts, seq: i, value };
      arrivals.push({ at: ts + delay, reading });

      // Occasionally resent.
      if (rand() < 0.02) arrivals.push({ at: ts + delay + rand() * 3000, reading: { ...reading } });
    }
  }

  // Stable sort, so ties keep their insertion order and the output is deterministic.
  arrivals.sort((a, b) => a.at - b.at);
  return arrivals.map((a) => a.reading);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '1' },
      devices: { type: 'string', default: '3' },
      minutes: { type: 'string', default: '5' },
    },
  });
  const readings = generate({ seed: Number(values.seed), devices: Number(values.devices), minutes: Number(values.minutes) });
  process.stdout.write('[\n' + readings.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
}
