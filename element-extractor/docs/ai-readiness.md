# AI safeguards and evaluation boundary

The hosted workbench preserves deterministic extraction and imports locally generated AI proposals. No provider credentials, paid generation endpoint or automatic fallback are deployed. Local OpenAI and Anthropic adapters completed the specifically authorized $5 comparison; see [results](ai-evaluation.md). Possession of keys is not approval for ongoing calls.

The source-preview/coverage stage is the boundary before interpretation:

- `file-import.js` captures supported source text/cells and exposes unreadable content explicitly. `source-coverage.js` links captured parts to review selections without claiming semantic completeness.
- Source snapshots have hashes. Website captures describe what was retrieved; they are not authenticated provenance and are not guaranteed full-page captures.
- The existing interpretation pipeline independently checks candidate schema, types, source evidence and review events. A matching quotation does not prove the proposed relationship is correct.
- Coverage decisions and record approvals are separate operator actions. Unsupported or intentionally excluded source content stays visible. Portable backups retain source accounting and revalidated review sessions.

The local adapters consume selected captured text and a requested schema, then propose candidates through this same validation and review boundary. They cannot mark coverage checked, approve records, hide omissions, execute document instructions or overwrite deterministic evidence. Provider credentials remain local and outside browser scripts, source downloads, sessions, logs and backups.

Continue evaluating real failures against known answers: mixed layouts, scans, long sources, ambiguous relationships, conflicts and missing values. Report omissions, associations, invented values, evidence validity, time and cost separately. The supplied chemistry document is private and never checked in; selected text was used only within the specifically authorized comparison.

Preview coverage is bounded by what the parser captures. It does not solve arbitrary document understanding or OCR. Those limits must remain visible after adding AI.
