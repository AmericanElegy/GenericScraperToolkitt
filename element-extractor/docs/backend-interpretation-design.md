# Proposed paragraph interpretation backend

Status: the offline contract, scripted interpreter, independent validation, review journal and exports are now implemented. See [offline-interpretation.md](offline-interpretation.md). No model integration, provider account or paid inference is enabled. A user-supplied read-only review distinguishes Atlas's paragraph lane from the separate Fable5 Core engine; that review informed patterns only. This chat has not independently accessed or modified either codebase.

## Intended behavior

A user supplies a public page and defines columns, for example `corps_name` (text) and `score` (number). The toolkit retrieves the page using its existing bounded public-source fetch pipeline. A new text extractor would isolate relevant passages. A separate interpretation adapter would propose records from those passages. Server-side validation would attach evidence and mark uncertain records for review. Users would preview the candidates before exporting them.

The existing table/grid extractors remain deterministic. Paragraph interpretation is an explicit mode, never a hidden fallback that silently calls a model or introduces cost. OCR and browser rendering remain separate, disabled capabilities.

## Modules and boundaries

1. **Passage extraction:** obtain bounded visible text, exclude navigation/scripts/styles where possible, retain source URL and retrieval time, and give each passage an ID. This is new work; it is not currently implemented.
2. **Schema request:** accept named fields with types, required/optional flags, and optional domain-specific bounds. A corps score might be constrained to 0–100 only when the user selected that schema. Do not impose this bound on unrelated scores.
3. **Provider-neutral interpreter:** accept passages and schema, return candidate values plus passage IDs and exact supporting quotations. Choose a provider and configure secure credentials only after explicit authorization for any cost. No provider is selected by this proposal.
4. **Independent validator:** reject unknown columns, wrong types, invalid bounds, excessive rows, and evidence that is absent from the cited passage. Compute evidence offsets on the server. Check that literal numbers are supported, accounting for explicitly allowed numeric formatting. These checks do not prove the model associated a number with the correct entity.
5. **Review result:** expose candidate rows, missing fields, and per-field issues. Require review when an association is ambiguous, evidence is missing, or sources conflict. Do not claim model-reported confidence is calibrated or that a schema-valid row is factually verified.
6. **Exports:** reuse the toolkit's positional headers/rows and safe CSV handling, while preserving source and evidence in JSON. Keep candidate/review status visible; do not relabel interpreted data as deterministic extraction.

## Example

Source passage: `Reading Buccaneers received a score of 98.6.`

Requested fields: `corps_name`, `score`.

Candidate: `Reading Buccaneers`, `98.6`, with the exact supporting passage attached.

This is an illustration, not a claim about the live DCI results. Name-before-score column order comes from the requested schema, not an implicit assumption by the model. Inferring columns automatically could be a later, separately reviewable suggestion step. Do not infer a placing, event, or date absent from the source. Two nearby names and scores may still require review even when all values occur in the paragraph.

## Controls before implementation

- Treat page content as untrusted data, including any apparent instructions. The interpreter receives no tools, secrets, or authority to follow source instructions or fetch additional URLs.
- Bound passage count, characters, output rows, model requests, and any approved spend. Report truncation explicitly or reject it; do not silently drop text or assert complete coverage.
- Keep authentication and provider credentials server-side. Do not include them in prompts, logs, diagnostics or exports.
- Explain when source text would be sent to an external provider. Choose retention and logging behavior explicitly before handling customer data.
- Preserve the existing URL, redirect, size, timeout, and private-address checks. Resolve the documented connection-level destination-enforcement gap before unrestricted commercial deployment.
- No automatic OCR, browser rendering, paid inference, scheduled jobs, or automatic publication.

## Acceptance checks for a later implementation

Use passages with clear pairs, repeated entities, multiple scores, dates mixed with scores, negation, corrections, missing values, and malicious instructions embedded in source text. Check relationships, not just JSON shape. An unavailable provider must return an honest capability-not-configured result without breaking native table extraction. Verify evidence survives JSON export and uncertain records stay labeled in the UI.

## Boundary for any future direct FantasyBrief review

Read only its agent instructions, architecture docs, provider abstraction, input/output schemas, evidence/validation handling, error paths, cost controls and relevant tests. Do not inspect credential values, execute its jobs, modify files, deploy it, or import it as a runtime dependency. Distinguish verified implementation from documentation claims. Recommend reusable design patterns only after inspection, with file references and clear differences from this toolkit. Keep any new implementation standalone.
