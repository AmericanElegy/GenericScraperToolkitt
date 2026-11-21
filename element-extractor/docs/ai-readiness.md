# Boundary for future AI evaluation

The workbench currently performs deterministic extraction only. No OpenAI or Anthropic SDK, endpoint, key, paid inference or automatic AI fallback has been added. Possession of API keys is not approval to make calls. Establish the provider, model, document scope and spending limit before an evaluation.

The source-preview/coverage stage is the boundary before interpretation:

- `file-import.js` captures supported source text/cells and exposes unreadable content explicitly. `source-coverage.js` links captured parts to review selections without claiming semantic completeness.
- Source snapshots have hashes. Website captures describe what was retrieved; they are not authenticated provenance and are not guaranteed full-page captures.
- The existing interpretation pipeline independently checks candidate schema, types, source evidence and review events. A matching quotation does not prove the proposed relationship is correct.
- Coverage decisions and record approvals are separate operator actions. Unsupported or intentionally excluded source content stays visible. Portable backups retain source accounting and revalidated review sessions.

An eventual provider adapter should consume selected captured parts and a requested schema, then propose candidates through this same validation and review boundary. It must not mark coverage checked, approve records, hide omissions, execute instructions embedded in documents, or overwrite deterministic evidence. Keep provider credentials server-side and out of browser scripts, source downloads, sessions, logs and backups. The current backup format does not need keys.

Evaluate against known answers before enabling normal use: ordinary tables; mixed Word prose/table/image content; text and image-only PDF pages; multiple Excel sheets; long or unsupported source parts; ambiguous relationships; conflicting statements; missing values; quoted source instructions; and damaged/corrupt backups. Report omissions, incorrect associations, invented values, evidence validity, processing time and actual cost separately. The supplied chemistry document is an optional local fixture, not a checked-in document or permission to transmit it to a provider.

Preview coverage is bounded by what the parser captures. It does not solve arbitrary document understanding or OCR. Those limits must remain visible after adding AI.
