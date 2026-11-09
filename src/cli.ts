// Usage: node src/cli.ts [path/to/readings.json]
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, summarize, type Reading } from './index.ts';

const path = process.argv[2] ?? 'data/sample.json';
const readings: Reading[] = JSON.parse(readFileSync(path, 'utf8'));

console.table(
  summarize(readings, DEFAULT_CONFIG).map((w) => ({
    ...w,
    windowStart: new Date(w.windowStart).toISOString(),
    avg: Number(w.avg.toFixed(2)),
  })),
);
