# Extraction benchmark

This baseline separates source availability, deterministic parsing, evidence validity and mixed-document interpretation. It makes no model calls, changes no approvals and does not deploy anything. It retains the current JavaScript/Cloudflare architecture.

## Reference cases

| Case | Frozen target | Expected result | Source boundary |
| --- | --- | --- | --- |
| W3Schools HTML tables | Company / Contact / Country | 6 rows, 18 exact cell values | Focused reference transcription of the public company example; not a raw HTML capture. |
| Wikipedia Statistics | Project(s) / Articles / All pages / Edits / Admins / Users / Editors / Files | 18 rows, 144 exact values for the saved snapshot | Actual selected HTML table from a saved full HTTP 200 response. Full page is retained locally for a separate noise/selection replay. Values are frozen, not assumed current forever. |
| BLS Jacksonville, May 2025, Table A | Occupational group; national/local employment share; national/local hourly wage | 23 rows, 115 exact values, correct geographic association and units | Retained copied-text fixture tests grouped-header pasted text. Deployed URL intake is measured separately; it is not represented by fabricated original HTML. |
| Fischer esterification Word document | 12 explicitly named materials and 4 explicit quantity/time facts | Separate capture and semantic scores | Optional private original, never copied into tracked fixtures or sent to an AI provider. Diagrams are supplementary for this chosen task, not automatically irrelevant for other tasks. |

Frozen data and provenance live in `test/fixtures/extraction-benchmark/expected.json`. The reference extraction is independent of the production interpretation code. The Wikipedia reference cells were read with a separate Python HTML parser and inspected against the table. The BLS fixture and expected values preserve percentages separately from hourly dollars. These are reference-checked baselines, not James's approval of individual records.

## Running the evaluations

From `element-extractor`:

```powershell
npm.cmd run benchmark:offline
npm.cmd run benchmark:live
npm.cmd run benchmark:report
```

The offline evaluation builds and compares every frozen row/cell through the real Worker endpoints in local workerd. It also verifies exact evidence offsets and zero automatic approvals. Missing, duplicate, extra or changed rows and wrong columns/values are reported explicitly. `npm test` includes these frozen cases and a regression showing that an access-denied response stops before renderer fallback.

`benchmark:live` explicitly requests the three public sources through the existing deployed workbench, then compares the intended tables against the frozen references. Each response is retained under ignored `.wrangler/benchmarks/live/`. It creates no approvals. Source changes can cause a reference mismatch; do not automatically overwrite the expected values. `BENCHMARK_BASE_URL` can select a local/preview toolkit instead.

For the private mixed case, set `TOOLKIT_DOCX_FIXTURE` to the original document's absolute path, then run:

```powershell
npm.cmd run benchmark:mixed
```

That command tests browser file capture and every resulting section through the current deterministic interpreter. It compares captured text with the original Word XML and checks the desired materials and quantity/time facts separately. Reports stay in ignored `.wrangler/benchmarks/`. Exit 2 means a measured semantic gap; missing original input is an error, not a pass. These sixteen desired output items define this evaluation's scope rather than every possible fact in the document.

## Fetch and parser failures stay separate

`npm.cmd run benchmark:capture` makes one ordinary local curl request per public source and retains raw response bodies, headers, HTTP status and hashes in a new timestamped ignored directory. It stops at request limits, never retries access denials, bypasses no challenge/login wall and does not update expected rows. No credentials or cookies are attached. These full local captures are diagnostic evidence, not material to repeatedly paste into a model.

The initial full Wikipedia response can be replayed offline using:

```powershell
node scripts/evaluate-extraction.mjs --full-wikipedia
```

This uses the hash-pinned local `.wrangler/benchmarks/raw/wikipedia.html` captured for this baseline. It deliberately fails if that snapshot is missing or changed. Normal cloned-checkout tests use the tracked focused table and require no network or private files.

## Observed baseline on November 21, 2026

- All three frozen structured cases matched every row and cell, with valid evidence and no approvals.
- The full saved Wikipedia page matched the same target table despite unrelated content.
- All three deployed workbench URL cases matched the frozen references.
- Local curl received 403 for W3Schools and BLS and 200 for Wikipedia. Those are route-specific availability results, not parser failures or proof that the deployed Worker is blocked.
- The chemistry document retained all 46 original text paragraphs in 33 captured blocks and accounted for its two unread images. It produced zero candidates: 0/12 materials and 0/4 quantity/time facts. This remains an explicit interpretation gap.

`npm.cmd run benchmark:report` combines available measurements into `.wrangler/benchmarks/RESULTS.md`; missing measurements remain labeled unmeasured. These four cases are a useful controlled baseline, not a representative claim of universal extraction accuracy. Future AI should be evaluated against these same expected outputs and evidence requirements; capture success must never be substituted for semantic success.
