# Independent reviewer reports

These are the saved final reports from the three
subagents used during this project. They are historical reports, not fresh ratings
of the final submission. In particular, the 88/100 and 86/100 ratings preceded
commit `05d628d`, which fixed the reported fractional-window bug, and preceded
this transcript export. Their claims and caveats are preserved rather than updated
retroactively. Local repository links are made relative and trailing whitespace
is normalized. Delegation tool records (including opaque encoded payloads),
intermediate tool logs, and internal reasoning are omitted. The user's request
for independent testing is preserved in the main dialogue export.

## Tier 2 contract review

### Final report — 2026-11-10T00:57:23Z

- **Current state:** `git status --short` is empty. `summarize` is implemented; `detectGaps` and `createStream` still throw `not implemented`. `NOTES.md` explicitly defers Tiers 2 and 3.

- **Public contracts:** Preserve `src/index.ts` exports and signatures:
  - `detectGaps(readings: Reading[], config: Config): Gap[]`
  - `createStream(config: Config): Stream`
  - `Stream.push(reading): WindowSummary[]`
  - `Stream.end(): WindowSummary[]`

- **Gaps:** Apply the same arrival-order acceptance rules first, then order accepted timestamps per device. Report consecutive pairs with `end - start > gapMs`, using the actual timestamps. Sort results by plain-string `deviceId`, then numeric `start`. Equal-to-threshold silence is not a gap. Summary aggregates cannot reconstruct gaps because they discard individual timestamps.

- **Streaming:** Only accepted readings advance that device’s maximum timestamp `M`. With cutoff `C = M - maxLatenessMs`, timestamps equal to `C` remain admissible. A window closes when `windowStart + windowMs <= C`. Return newly closed windows immediately from `push`; quiet devices retain open windows until `end`. Emit every populated window exactly once across calls, matching `summarize`, with averages within `1e-9`. Ordering within a call is unrestricted. Repeated `end` and `push` after `end` are unspecified.

- **Duplicate eviction:** Identity is `(deviceId, seq)`, including invalid and late first arrivals. Resends must retain the original timestamp even if value changes. Therefore, an entry with `ts < C` can safely be forgotten: every future resend will remain too late. Entries at `ts === C` must stay. Already-too-late first arrivals need no persistent duplicate entry for observable summary equivalence. Invalid future readings must stay remembered until accepted time eventually passes their timestamps.

- **Bounded-memory limitation:** The specification does not provide enough constraints for an unconditional fixed bound. Arbitrarily many distinct sequences at one admissible timestamp require arbitrarily large exact duplicate history. An invalid-only stream never advances accepted time, yet later valid resends must still be rejected. Invalid timestamps arbitrarily far in the future also accumulate beyond the eviction frontier. Unlimited devices require unlimited independent state. A timestamp horizon alone does not bound record count; assumptions need to bound device count, reading density, and invalid future timestamps, or the guarantee must be qualified.

- **What is bounded already:** Per-device open aggregate windows can be limited to at most `ceil(maxLatenessMs / windowMs) + 1`, assuming valid configuration and prompt closure. This does not solve duplicate-history growth.

- **Reusable implementation:** Extract value validation and the arrival-order acceptance policy from `summarize`; reuse aggregate count/sum/min/max updates, summary conversion, and plain-string ordering. Batch callers can share full-history acceptance state. Streaming needs a different retention strategy rather than blindly sharing the current permanent `Set<number>`.

`NOTES.md` assumes finite valid timestamps/sequences and sensible finite configuration; it does **not** assume sequence monotonicity, a fixed device population, or bounded density. No files changed and no tests were run for this read-only review.

## Final reviewer A

### Final report — 2026-11-10T05:24:31Z

Independent review rating: **88/100**. Strong implementation and tests, but I would finish the transcript requirement and fix one streaming edge case before claiming all criteria are met.

I ran `npm test` (**87/87 passed**) and `npm start` (15 summaries, including p95). I also built an independent oracle rather than reusing production acceptance helpers: **1,000 randomized configurations and 300,000 readings** passed exact checks for acceptance, count/min/max/average, gaps, batch/stream equivalence, and the documented percentile error bound. These included duplicates with changed values, invalid values, negative timestamps, lateness, unusual device IDs, varying window sizes, and varying bucket counts. No tracked files were modified.

**Findings**

1. **Medium: fractional window widths can make streaming emit the same window twice.**
   Location: `src/stream-engine.ts:71`, compared with membership calculation at `src/window-aggregation.ts:10`.

   Reproduction:
   ```ts
   const config = {
     ...DEFAULT_CONFIG,
     windowMs: 0.1,
     maxLatenessMs: 0,
   };
   const readings = [
     { deviceId: 'a', ts: 0.5, seq: 1, value: 1 },
     { deviceId: 'a', ts: 0.6, seq: 2, value: 2 },
   ];
   ```

   `summarize` returns one window starting at `0.5`, count `2`, average `1.5`. Streaming returns **two windows both starting at `0.5`**, each count `1`. Floating-point division places `0.6` into the window starting at `0.5`, but `start + windowMs <= cutoff` closes that window before insertion. The configuration is accepted and fits the documented “positive finite” constraint. This violates exactly-once output and batch equivalence. Existing tests use integer widths and miss it.

   Suggested fix: make closure use the same window-membership arithmetic as insertion, with a regression test. Alternatively explicitly constrain supported time/window values, but merely documenting a new limitation would be weaker.

2. **Submission requirement outstanding: full AI transcript.**
   `NOTES.md:139` explicitly says the conversation brief is not a full transcript and export/review remains to be done. The directory contains the brief and instructions only. The email requests the session transcript and review before committing; completing that is necessary for submission readiness. I did not inspect private session logs or change transcript files.

3. **Low, already disclosed: finite values can produce an infinite average.**
   `src/window-aggregation.ts:18` sums directly, and line 36 divides the sum. With valid range `[0, 1e308]` and two accepted values of `1e308`, the mathematically correct average is `1e308`, but output is `Infinity`. NOTES already identifies extreme-range sum overflow as outside scope. This is not a surprising hidden defect in ordinary sensor ranges, but prevents a completely unrestricted correctness claim.

4. **Low: high-density streams can have quadratic processing cost.**
   `src/stream-engine.ts:64` rescans every retained sequence on each advancing timestamp, even when none can expire. With `windowMs = maxLatenessMs = 1_000_000`, one bucket, one device, timestamps `0..n-1`, I measured roughly 81 ms for 5,000 readings, 248 ms for 10,000, and 904 ms for 20,000. This does not violate an explicit performance target and stays within memory caps, but is relevant to the project's large-stream motivation. Documenting this tradeoff is sufficient for a take-home; an indexed expiry structure could be future work.

**Tier assessment**

- **Tier 1:** Meets ordinary intended requirements. Arrival-order rejection rules, inclusive boundaries, independent devices, sorting, and immutability all held under independent testing. Extreme average overflow is documented.
- **Tier 2 gaps:** Complete and independently verified.
- **Tier 2 streaming:** Strong handling of duplicate expiry, quiet devices, final-only results, lifecycle behavior, and explicit memory-limit failures. Fractional-width issue needs correction. Configurable limits are honestly documented as a qualification of unrestricted equivalence; they are a defensible design response to the impossible combination of unlimited distinct devices/sequence identities and unconditional fixed RAM.
- **Tier 3:** Complete. Fixed histograms implement a weighted nearest-rank estimate, use bounded storage, respect configured budgets, and satisfy the stated error bound across independently generated cases. Batch and streaming return matching p95 values.

The score reflects high-quality core work and clear tradeoff documentation, reduced for the genuine streaming boundary defect and unfinished submission transcript. Repository-template provenance, private-repository collaborator access, and actual email submission were not independently verified.

## Final reviewer B

### Final report — 2026-11-10T05:25:07Z

**Independent rating: 86/100. Strong implementation, but I would address the streaming boundary bug and finish the transcript before submitting.**

I independently ran:

- `npm test`: **87/87 passed**.
- `npm start`: succeeded.
- **1,000 randomized oracle trials, 200,000 readings**: independently checked acceptance, summary statistics, gap detection, p95 error bounds, streaming/batch equivalence, and lifecycle. All passed.
- **200,000 streaming pushes under tight limits**: one device, one retained sequence, one histogram of 80 bytes. Produced exactly 2,000 windows; retained state stayed bounded and cleared after `end()`.

Findings, in priority order:

1. **Medium — fractional window widths can emit the same window twice.**
   [stream-engine.ts:71](../src/stream-engine.ts#L71) closes windows using `start + windowMs <= cutoff`, which can disagree with the required `floor(ts / windowMs) * windowMs` assignment because of floating-point rounding.

   Reproduction:

   ```ts
   const config = {
     ...DEFAULT_CONFIG,
     windowMs: 0.1,
     maxLatenessMs: 0,
   };
   const readings = [
     { deviceId: 'a', ts: 4.2, seq: 1, value: 1 },
     { deviceId: 'a', ts: 4.3, seq: 2, value: 2 },
   ];
   ```

   Batch returns **one window starting at 4.2**, count 2, average 1.5. Streaming returns **two windows starting at 4.2**, each count 1. This violates exactly-once output and batch equivalence. These inputs satisfy the documented finite timestamp/positive finite window assumptions. Add a regression and make finalization consistent with window assignment.

2. **Submission blocker — the requested full AI transcript is missing.**
   Only `transcripts/README.md` and `transcripts/conversation-brief.md` are tracked. [NOTES.md:139](../NOTES.md#L139) explicitly acknowledges that the brief is not a transcript and export/review remains outstanding. The email asks for the session transcript; the summary does not fully satisfy it.

3. **Documented qualification — streaming cannot meet unconditional equivalence for every README-valid input.**
   With default configuration, 1,001 distinct devices each sending one valid reading succeed in batch but throw `StreamLimitError: maxDevices` in streaming. This is deliberate and clearly disclosed, not a hidden implementation defect. The memory-bound design is defensible given unlimited devices and duplicate history, but the submission should call Tier 2 complete **within configured limits**, as its notes already explain.

4. **Low — valid finite values can produce an infinite average.**
   [window-aggregation.ts:18](../src/window-aggregation.ts#L18) sums directly. With `validRange: {min: 1e308, max: 1e308}` and two accepted values of `1e308`, the summary reports `avg: Infinity` instead of `1e308`. This limitation is already disclosed in NOTES. It is unlikely with ordinary sensor ranges, but prevents claiming complete numerical correctness over all finite custom ranges.

Tier assessment:

| Area | Assessment |
|---|---|
| Tier 1 | Correct on ordinary inputs and independent randomized cases; extreme sum-overflow limitation |
| Tier 2 gaps | Complete; no defect found |
| Tier 2 streaming | Strong acceptance, lifecycle, cleanup, and memory tests; fractional-boundary correctness defect; disclosed capacity limits |
| Tier 3 | Complete for intended numeric ranges; independently verified histogram error bounds |
| Submission | Useful small commits, substantial notes, no added dependencies, erasable TypeScript; full transcript outstanding |

The score rewards the independently verified behavior, explicit memory tradeoffs, localized tests, and useful commit history. The deductions reflect the reproducible streaming bug, incomplete submission artifact, and remaining contract/numerical qualifications. I made no repository changes.
