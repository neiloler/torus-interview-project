# Reading stream

A take-home exercise for engineering candidates at Torus. Plan on about **an hour**.

You get a stream of sensor readings from a fleet of devices. The data is messy: readings arrive out of order, some are sent twice, devices sometimes go quiet, and some values are garbage. Your job is to build the step that cleans the stream and summarizes it for each device.

**There's more here than fits in an hour, on purpose.** We want to see what you choose to do, how you do it, and how you explain what you didn't get to. A clean Tier 1 with good notes beats a rushed attempt at everything.

## Getting started

You need Node.js 22.18 or later. There are **no dependencies and no install step**. Node runs the TypeScript directly, and nothing in this repo touches the network. Read it all before running anything if you like; it's small.

```sh
npm test          # every test/**/*.test.ts (the Tier 1 tests fail until you implement summarize)
npm start         # print the window summaries for data/sample.json
node scripts/generate.ts --seed 7 --devices 5 --minutes 10 > data/big.json   # more data
```

Node strips the types but doesn't check them, so stick to TypeScript that can simply be erased (no `enum`, `namespace` or constructor parameter properties), import with `.ts` extensions, and use `import type` for types.

You're welcome to add dependencies, change the structure, or rewrite anything; if you do, tell us why in `NOTES.md`. Keep the exports and signatures in `src/index.ts` working, though, because we run our own tests against them.

## The data

```ts
type Reading = { deviceId: string; ts: number; seq: number; value: number | null };
```

`ts` is in milliseconds since the Unix epoch. `seq` is a per-device sequence number. A resent reading has the same `seq` and `ts` as the original (its `value` may differ). The input array is in **arrival order**, which is not `ts` order. See `src/types.ts` for the full types and `src/config.ts` for the defaults.

## Rules

Process the readings in arrival order. Drop a reading if any of these is true:

1. **Invalid:** `value` is not a finite number (`null`, `NaN`, `±Infinity`) or is outside `validRange` (bounds inclusive).
2. **Duplicate:** a reading with the same `deviceId` and `seq` arrived earlier, whether or not that earlier one was accepted. For example, a `null` reading followed by a valid resend of it: both are dropped.
3. **Too late:** its `ts` is more than `maxLatenessMs` behind the newest `ts` already **accepted** for the same device. Exactly `maxLatenessMs` behind is still fine.

Every other reading is **accepted**.

Windows are tumbling and `windowMs` wide. A reading belongs to the window starting at `floor(ts / windowMs) * windowMs`.

## Tasks

### Tier 1: clean and summarize

Implement `summarize` in `src/summarize.ts`. Return one `WindowSummary` (count, min, max, avg) for each device and window that has at least one accepted reading, sorted by `deviceId` (plain string comparison, not `localeCompare`) and then by `windowStart`. Don't modify the input array or its readings. The tests in `test/summarize.test.ts` pin the rules down.

### Tier 2: gaps and streaming

- **Gaps.** Implement `detectGaps` in `src/gaps.ts`. Take each device's accepted readings in `ts` order. Wherever two consecutive readings are more than `gapMs` apart, report `{ deviceId, start, end }`, using the two readings' `ts` values. Sort the output by `deviceId`, then by `start`.
- **Streaming.** Implement `createStream` in `src/stream.ts`. It takes readings one at a time through `push`. As soon as a window can no longer change, `push` returns it. Lateness is per device, so a window closes only when its own device's accepted readings move far enough forward; a device that goes quiet keeps its windows open until `end`. `end` returns whatever is left. Windows within one call can come back in any order. Across all calls, each window must come out exactly once, with the same values `summarize` gives (averages within `1e-9`). The catch is that memory must stay bounded however long the stream runs. A stream that keeps every reading, or every `seq` it has ever seen, doesn't count. Showing the bound is up to you: a test-only hook, an argument in `NOTES.md`, or both.

Write the tests for this tier yourself, in `test/`; `npm test` picks up any `*.test.ts` file there.

The streaming task is the hardest part of the exercise. Partial work is fine here: one task done well beats both done thinly.

### Tier 3: stretch

- Add a **p95** of the values to each window, as an optional `p95` field on `WindowSummary`. Exact or approximate is your call; say which in your notes, and why. Update the Tier 1 tests to match the new shape.
- Or do something else you think matters more. Tell us what, and why.

## What to send back

1. Create your own copy with **Use this template → Create a new repository**. Please don't fork it, and don't open a pull request here; other candidates would be able to see your work.
2. **Commit as you go.** We read the history, so small commits with real messages help you.
3. **Using AI tools is fine, and we'd like to see how.** Commit any agent files you used (`CLAUDE.md`, `AGENTS.md`, `.cursor/`, prompts, and so on), and save your session transcripts in `transcripts/`. In Claude Code that's `/export transcripts/claude-code.txt` before you close the session; `transcripts/README.md` covers other tools. If you didn't use AI, say so.
4. Add a **`NOTES.md`** covering what you did, what you skipped and why, any assumptions you made, and what you'd do next with more time.
5. Reply with the repo URL and the commit SHA you're submitting. If the repo is private, invite the GitHub account we gave you as a collaborator.

We'll talk through your work with you in the next interview, so be ready to explain your choices.
