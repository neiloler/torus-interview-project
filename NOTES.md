# Implementation notes

## Scope and status

Tier 1 is complete. Its first commit documents the requirements and adds tests
while `summarize` is still unimplemented. Its second implements `summarize` and
records the passing checks. Tier 2 gap detection is also complete, following
shared utility extraction and a separate commit with 12 initially failing gap
tests. Streaming is now implemented with configurable retained-state limits;
all 65 tests pass. Inputs that exceed those limits fail explicitly, which is a
documented qualification of Tier 2's full-input equivalence requirement.
Tier 3 now has an agreed histogram-based p95 design. Its documentation and tests
are separate commits; percentile implementation is still pending.

## Implementation choices

`summarize` makes one pass in arrival order. Each device has a set of seen
sequences, a maximum accepted timestamp, and a map of window aggregates.
Sequences are recorded before validity and lateness checks. Only accepted
readings update timestamps and aggregates. Summaries are created after the pass
and sorted without mutating the input.

Aggregates store count, sum, min, and max rather than individual readings.
Average is sum/count using JavaScript numbers, without rounding. Extreme custom
ranges or input sizes could overflow the sum; compensated or overflow-resistant
arithmetic is outside this exercise increment.

With typical constant-time map/set operations, processing takes O(n + w log w)
time and O(s + w) extra memory, where n is input readings, s is distinct
device/sequence pairs, and w is populated windows. Duplicate history grows with
input size, which is allowed for Tier 1, not a streaming memory guarantee.

The initial Tier 1 implementation kept types and logic in `summarize.ts`. The
Tier 2 preparation refactor separates acceptance tracking from window aggregates
so gap detection can reuse the rules without depending on summary state. Public
exports/signatures, dependencies, and CLI behavior are unchanged. Type aliases,
annotations, and type-only imports are erasable; no enums, namespaces, or
constructor parameter properties are used.

## Tier 1 coverage review

The original `test/summarize.test.ts` covers empty input, basic statistics,
window boundaries, absent windows, output ordering, invalid values, inclusive
range bounds, duplicate identity, lateness boundaries, device independence,
accepted-time advancement, and a sample-data smoke test.

`test/summarize-edge-cases.test.ts` supplements those tests:

| Requirement or interaction | Added coverage |
| --- | --- |
| Invalid values still count as seen | Each invalid value category followed by a valid resend |
| Nonempty accepted windows only | Invalid-only devices/windows and a late-only window are absent |
| Only accepted readings advance time | Invalid future reading followed by a valid duplicate, then an earlier valid reading |
| Newest means maximum accepted timestamp | Accepted older reading followed by one outside the original cutoff |
| Arrival order and independent windows | Accepted late arrival updates a previous window; one millisecond too late is rejected |
| Inclusive lateness | Zero lateness permits distinct readings at the same timestamp |
| Configurable epoch-aligned windows | Custom width, negative timestamps, boundaries, and custom range |
| Plain string and numeric ordering | Mixed-case IDs and window starts whose lexical and numeric orders differ |
| Independent statistics | Exact count/min/max/fractional average across multiple devices and windows |
| String IDs and numeric sequences | Empty/prototype-like IDs and sequence zero |
| Input immutability | Frozen array and frozen reading objects, plus before/after comparison |
| Independent invocations | Repeated calls have identical results |

Under the stated contract, a resend of a too-late reading has the same timestamp
and remains too late because accepted time never decreases. Its duplicate status
cannot be distinguished through summary output alone. Invalid-first resends do
exercise the observable requirement to remember rejected readings.

## Assumptions and design constraints

- Inputs conform to `Reading`; timestamps and sequences are valid finite numbers.
- Configuration has a positive finite window width, nonnegative finite lateness and gap threshold,
  and ordered finite range bounds. Behavior for malformed configuration is not
  specified by the exercise and is outside this increment.
- Process in arrival order; sort only output summaries. Do not modify inputs.
- Preserve the public exports and function signatures. Use erasable TypeScript,
  `.ts` imports, and type-only imports. Add no dependencies.
- Tier 1 receives an entire array. The existing CLI also reads/parses an entire
  file, so this work does not promise bounded memory for large files.

## Validation

Before implementation, `npm test` on Node v22.23.2 discovers 31 tests (14 original
and 17 added). All 31 fail with `not implemented`, as expected for the first
commit. `git diff --check` passes.

After implementation, all 31 tests pass without changing the tests from the
first commit. `npm start` succeeds and prints 15 sample window summaries.
`git diff --check` passes. Node executes the TypeScript directly; these commands
verify execution, not static type checking.

After shared utility extraction, `npm test` passes all 34 tests: the unchanged
31 Tier 1 tests and one test for each of the three utilities. `npm start` still
prints 15 sample summaries, and `git diff --check` passes.

At the gap-test checkpoint, `npm test` discovered 46 tests: the existing 34 passed,
and the 12 new gap tests failed with `not implemented`. That failure was deliberate:
`src/gaps.ts` remained a stub for the next implementation commit. No existing
tests or production code changed in the gap-test commit.

After implementing `detectGaps`, all 46 tests pass without changing the test
suite. `npm start` still prints 15 sample window summaries, and `git diff --check`
passes. The CLI remains a summary display; gap reporting is available through
the existing `detectGaps` export.

After streaming implementation, all 65 tests pass: the previous 46 plus 9
stream behavior tests, 7 memory tests, 1 limit-resolution test, and 2 shared
aggregation tests. The memory suite exercises 10,000 pushes with one permitted
sequence record; actual retained state plateaus at one device, one sequence,
and two windows. Three seeded messy datasets also produce exactly the same
summaries as batch processing. The sample CLI and whitespace check pass. No
TypeScript compiler is installed in this environment; no dependency was added
for a static type check.

## AI use and preparation

Codex assisted with interpreting the brief, discussing tradeoffs, proposing a
Tier 1 implementation in chat, and reviewing test coverage. The conversation
included preparation before implementation; this is not a claim that all work
occurred within one timed hour.

See `transcripts/conversation-brief.md` for a summarized record. It is not a full
session transcript. Before final submission, export and review the relevant
session transcript as requested by the README/email. No project-specific agent
configuration files have been introduced in this increment.

## Tier 2 decisions and plan

### Decisions agreed during planning

- Complete gap detection before streaming.
- Extract common behavior into small, independently testable functions.
- Aim for one concise test per utility, with a small case table where useful.
  More than one test, or a test longer than a few dozen lines, is a strong signal
  to review whether the function has multiple responsibilities. It is a design
  signal, not a reason to omit boundary cases or fragment a coherent state change.
- Treat memory exhaustion as a major failure mode. Establish streaming retention
  rules and a defensible bound before implementing or claiming bounded memory.
- Continue documenting assumptions, validation, and deliberate omissions here.

### Shared functions (extracted)

| Function | Responsibility | Initial users and focused test |
| --- | --- | --- |
| `isValidValue` | Check finite numeric value and inclusive configured range; narrow the value type | Acceptance logic; compact table of invalid categories and range boundaries |
| `acceptReading` | Apply per-device duplicate/lateness rules and update acceptance state in the required order | Summaries and gaps; a short arrival sequence covering invalid-first resends, accepted-time advancement, and lateness |
| `compareDeviceIds` | Plain string comparison | Summary and gap output ordering; a short mixed-case comparison table |

`src/reading-acceptance.ts` owns value validation and acceptance logic;
`src/compare-device-ids.ts` owns ordering. `summarize` now calls these helpers.
`test/shared-utilities.test.ts` has one short test per utility; the longest is
under two dozen lines and checks a sequence of arrivals plus state after each call.

Each caller creates its own `Map<string, AcceptanceState>`. `acceptReading`
mutates only that map/state and returns a type predicate that lets callers use
the accepted numeric value without a cast. It remembers rejected sequences but
updates newest time only on acceptance. Windows and statistics remain separate.
These helpers are internal module exports; `src/index.ts` is unchanged.

Batch acceptance keeps full sequence history and has O(s) storage for distinct
device/sequence pairs. Streaming uses its own timestamped sequence history so
it can expire old entries. It reuses `isValidValue`, but cannot reuse the batch
helper's permanent history. Batch/stream equivalence tests check their behavior
together. `addToWindow` and `toWindowSummary` now live in
`src/window-aggregation.ts` for both summary implementations, with one concise
test per helper. No generic storage interface or mock store was introduced.

### Gap detection implementation and tests

1. Visit readings in arrival order through shared acceptance logic.
2. Store only accepted timestamps, grouped by device. Summary aggregates cannot
   reconstruct gaps because they discard the individual timestamps.
3. Sort each device's newly allocated timestamp array numerically.
4. Compare consecutive timestamps. Emit `{ deviceId, start, end }` only when
   `end - start > gapMs`. Equality is not a gap; repeated timestamps add no gap.
5. Sort output by plain string device ID, then numeric start. Preserve inputs
   and existing public signatures/exports.

`src/gaps.ts` now implements these steps using `acceptReading` and
`compareDeviceIds`. Each call owns its acceptance map, timestamp arrays, and
output array. The only sorted input-derived collections are newly allocated
timestamp arrays; the caller's readings are never sorted or modified. No new
dependencies or additional utilities were needed.

Use a small set of public `detectGaps` tests for empty/single/invalid-only input,
threshold equality and just above it, out-of-order accepted readings that split
a would-be gap, rejected readings that must not split a gap, independent devices
and output ordering, and input immutability. Keep the 31 Tier 1 tests unchanged
as regression coverage. Utility tests target shared behavior; gap tests target
how accepted timestamps become output, rather than repeating every value case.

The 12 tests are localized in `test/gaps.test.ts`. Expected outputs are explicit,
not computed using the shared acceptance helper or the function under test:

| Case | Expected behavior |
| --- | --- |
| Empty, single, rejected-only, or one reading per device | No gaps; no invented leading/trailing endpoints |
| Separation below, equal to, and above `gapMs` | Only the strictly greater separation is reported |
| Accepted out-of-order reading | Splits a large interval into consecutive gaps after sorting |
| Too-late middle reading | Does not split the interval; sorting must follow acceptance |
| Invalid middle reading and valid resend | Neither contributes an endpoint |
| Invalid future reading and valid resend | Neither advances accepted time nor creates an endpoint |
| Duplicates and distinct sequences at equal timestamps | No repeated or zero-length gaps |
| Independent devices with shared sequences and different clocks | Separate acceptance histories; plain string ID and numeric start ordering |
| Negative timestamps and window boundaries | Preserve exact timestamps; gaps are independent of summary windows |
| Zero `gapMs` | Any positive separation is a gap, equality is not |
| Frozen input array and readings | No mutation during acceptance or sorting |
| Repeated calls | No retained acceptance history or results between invocations |

This is a batch API: its extra memory remains O(n) in the worst case for seen
sequences and accepted timestamps; worst-case time is O(n log n), including
sorting. Store timestamps rather than copies of full reading objects. Do not
describe gap detection or the existing whole-file CLI as bounded-memory input
processing.

### Proposed implementation commits

1. **Completed:** Extract acceptance and ordering helpers, add their focused tests, and refactor
   `summarize` to use them. All Tier 1 tests must remain green. Keep this behavior-
   preserving change separate so regressions can be traced to the refactor.
2. **Completed:** Add the gap detection tests while `detectGaps` is still a stub. Confirm that
   new gap tests fail for the expected reason and existing tests still pass.
3. **Completed:** Implement gap detection and update these notes. Run `npm test`, the sample
   CLI, and `git diff --check` before committing.

### Streaming retention rules

For a device whose newest accepted timestamp is M, let C = M - maxLatenessMs.

- A window can be emitted when `windowStart + windowMs <= C`.
- A duplicate record can be forgotten only once its timestamp is strictly less
  than C: a resend has the same timestamp and must then be rejected as too late.
  Records at C must remain remembered because equality is still admissible.
- Invalid readings never advance M. Invalid future readings still need duplicate
  history until the accepted cutoff passes them.
- Quiet devices retain their open windows until `end()`; another device cannot
  close their windows.

These rules limit retained history by timestamp only, not by number of records.
The written contract permits unlimited distinct sequences at one timestamp,
unlimited devices, and invalid-only input without accepted-time progress. Exact
duplicate detection therefore has no useful unconditional fixed memory bound
under the stated assumptions. Sequence monotonicity is not guaranteed either.

The user chose configurable in-memory limits after discussing SQLite and
hardware sizing. SQLite was not introduced: moving history to disk would still
need a retention policy and disk-capacity handling. We never silently evict
still-relevant records to satisfy a limit.

### Streaming API and limits

Existing signatures remain `createStream(config)`, `push(reading)`, and `end()`.
Existing `Config` objects continue to work. An optional `streamLimits` property
allows partial overrides; batch functions ignore it. `StreamLimits`,
`DEFAULT_STREAM_LIMITS`, and `StreamLimitError` are additive public exports.

```ts
const stream = createStream({
  ...DEFAULT_CONFIG,
  streamLimits: {
    maxDevices: 1_000,
    maxRetainedSequences: 100_000,
  },
});
```

The values shown are the defaults, not a measured hardware-capacity promise.
Both must be positive safe integers. Sequence capacity applies across the whole
stream, including invalid readings. Device capacity includes quiet and
invalid-only devices. Raising limits requires deployment-specific memory and
throughput measurements. Limits/settings are copied at creation so later caller
mutations cannot change an active stream's behavior. Positive finite window
width and nonnegative finite lateness are validated at creation.

On each accepted time advance, the stream prunes obsolete sequences and closes
eligible windows before checking sequence capacity. Duplicates and already-too-
late readings require no new sequence entry. Exceeding a limit throws
`StreamLimitError` with `limit` and `maximum` fields before inserting beyond
capacity. It clears all retained state and makes subsequent `push` or `end`
calls throw the same error. Previously emitted output cannot be retracted;
callers must treat a failed stream as an incomplete result, not a successful
full summary. Even `end()` must not return apparently complete output afterward.

Successful `end()` flushes open windows and releases state; repeated `end()`
returns `[]`. `push()` after successful `end()` throws. These lifecycle choices
fill behavior left unspecified by the README.

**Contract qualification:** This preserves API call compatibility and exact
batch equivalence for inputs that stay within configured limits. It does not
claim unconditional completion for every input permitted by the original
README: inputs exceeding either cap produce an error. Tests expecting arbitrary
device counts or unbounded active duplicate history without an error would not
pass under the defaults. This tradeoff is intentional and must be disclosed.

### Memory bound and verification

Let D be the device cap and S the retained-sequence cap. There are at most D
device states and S sequence/timestamp pairs. Every open window wholly at or
after its device's cutoff contains an accepted reading with a retained sequence.
Only one additional window per device can straddle the cutoff after all of its
sequence records expire. Thus open aggregates are bounded by S + D. Each stores
only count, sum, min, and max. Retained state is O(D + S) entries, independent of
total stream duration. A single flush can temporarily allocate O(D + S) output
summaries; returned results are then owned by the caller.

This is not an absolute process-byte or out-of-memory guarantee. Device IDs have
variable string lengths; their total retained length also contributes to memory.
JavaScript map overhead, garbage collection, caller-owned inputs/output, and
other application allocations are outside the count budget. There is no
empirically established bytes-per-entry or machine RAM requirement in this work.

Cleanup scans the current device's actual maps on accepted-time advances. There
is no secondary expiry queue that can grow independently. A push takes O(R + W)
worst-case work for that device's retained sequences/windows, with typical
constant-time map operations; duplicate/late pushes need only lookups. This
favors a small, auditable implementation over throughput at very large caps.
A bounded indexed expiry structure is a possible follow-up if profiling calls
for it.

`src/stream-engine.ts` is internal and exposes count snapshots for tests; its
factory is not exported from `src/index.ts`. Public streams expose only `push`
and `end`. Diagnostics count actual map entries, not just the capacity counter,
and expose no mutable storage. Tests exercise the real engine rather than a
mock, checking cleanup boundaries, stalled/invalid-only input, future invalid
records, global capacity, quiet devices, terminal errors, and release on end.
Heap-size assertions are avoided because garbage collection makes them noisy.

## Tier 3 decision: approximate p95

### Why a histogram

Use a fixed-width histogram rather than retaining all accepted values for an
exact percentile. Exact storage grows with readings per window. A histogram
stores one count per bucket regardless of reading count, making its memory cost
predictable. The user considers an error of roughly +/-0.5 to +/-0.1 value units
a worthwhile tradeoff for the memory savings. Approximation is explicitly
permitted by the README.

Count every accepted reading; do not randomly sample. Continue using the
existing per-device tumbling windows and final-only streaming API. `push`
returns finalized windows exactly once, and `end` flushes what remains. No
provisional percentile events or rolling windows are introduced.

### Calculation contract for the upcoming implementation

- Add optional `p95?: number` to `WindowSummary`; both `summarize` and successful
  streaming summaries populate it for every nonempty window.
- Define exact reference p95 by nearest rank: sorted value at one-based position
  `ceil(0.95 * count)`. Interpolation is not used.
- Add optional `Config.p95BucketCount`, default 825. Allow integer counts from
  1 through 65,536; the upper bound limits a single counter array to 512 KiB.
  These defaults are design choices, not measured hardware limits.
- Split `validRange` into equal-width buckets, with inclusive lower boundaries,
  exclusive upper boundaries, and the final bucket including the valid maximum.
  Place internal boundary values in the bucket starting at that boundary.
- Find the first bucket whose cumulative count reaches the nearest rank. Return
  its midpoint clamped to the window's observed minimum/maximum. Single-valued
  windows therefore return that value exactly, including range endpoints.
- A zero-width valid range returns its only valid value exactly. Require finite,
  ordered range endpoints and a finite span for percentile calculation. Account
  for floating-point bucket arithmetic and reject configurations whose bucket
  width cannot be represented as positive when the span is nonzero.
- Use eight-byte numeric counters and guard against loss of integer count
  precision. Only accepted readings update counts; expiry of duplicate records
  must never subtract values from the still-open window histogram.

### Accuracy and memory

For range width R and B buckets, bucket width is R/B. The exact nearest-rank p95
lies in the selected bucket. Its distance from the midpoint is at most R/(2B);
clamping to observed min/max cannot worsen that bound. This is a deterministic
absolute-value error bound, subject to floating-point roundoff, not a guarantee
about percentile-rank error. It is independent of sample count or distribution.

For the default range [-40, 125], R = 165:

| Buckets | Maximum absolute error | Counter bytes per window |
| --- | --- | --- |
| 165 | 0.5 | 1,320 |
| 825 (default) | 0.1 | 6,600 |
| 1,650 | 0.05 | 13,200 |

Eight-byte exact-value storage would use 8*n bytes for n readings, before other
overhead. At 100,000 readings in each of 2,000 windows, exact raw values occupy
about 1.49 GiB versus about 12.59 MiB of 825-bucket counters. Exact storage can
be smaller for windows with fewer readings than histogram buckets; the decision
prioritizes predictable worst-case storage for busy windows.

Add `streamLimits.maxHistogramBytes`, default 16 MiB, to cap total retained
counter-array bytes across open windows. It must be a positive safe integer;
even a budget smaller than one histogram is valid but the first accepted window
will fail. Before allocating a new histogram, close eligible windows and free
their histogram storage, then check budget. Updating an existing window needs
no additional array. Rejected readings allocate no histogram. Exceeding budget
uses the existing terminal `StreamLimitError` behavior with limit name
`maxHistogramBytes`, including release of all state. `end()` also frees arrays.

An internal `retainedCounts().histogramBytes` diagnostic will sum actual retained
counter-array byte lengths for tests; it is not added to the public Stream API.
The budget covers retained counter arrays, not process heap, runtime overhead,
temporary allocation/GC delays, device-ID strings, or caller-owned output.
Batch summarization remains an in-memory batch API, without a total-memory cap.

### Test-first implementation plan

1. Commit this decision and the conversation summary before changing tests.
2. Commit tests for explicit percentile examples, the theoretical error bound
   against independently sorted values, bucket/range endpoints, configuration,
   acceptance rules, independent windows/devices, and final-only streaming.
3. Include tests for constant histogram size as reading count grows, allocation
   only for accepted windows, budget reuse after closure, quiet devices sharing
   the budget, and release on end or failure. Test existing metric fields
   independently so adding p95 does not obscure count/min/max/average regressions.
4. Implement the percentile in a later commit. Preserve the original API call
   signatures and the documented resource-limit qualifications.
