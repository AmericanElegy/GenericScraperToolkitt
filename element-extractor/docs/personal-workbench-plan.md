# Personal workbench completion plan

James authorized steps 1–5 on November 21, 2026: reproducible release, private access, requested output columns, bounded AI comparison and end-to-end personal workflows. This is an operator tool, not a public customer service.

## Decisions and boundaries

- Protect the existing Worker with Cloudflare Access for James only. Do not create customer accounts, billing, another checkout or another hosted site.
- Total approval for this evaluation: **US $5 across OpenAI and Anthropic combined, including failed calls and retries**. No automatic retry. Keep a persistent local reservation ledger and stop before exceeding that authorization. This is not approval for future ongoing usage.
- Credentials remain in process memory or ignored local secrets files; never put them in the browser, repository, exports, logs or review backups.
- Use the existing three structured reference cases plus the private chemistry document. For the chemistry task, diagrams are supplementary for extracting the materials list and explicit quantity/time facts. This is a task-specific operator choice, not a universal judgment about diagrams.
- Provider results are proposals only. Source evidence is independently checked; no AI result approves records or marks coverage checked. Preserve the deterministic workflow and portable sessions.
- At completion, remind James about any unfinished readiness items and subsequent personal-use evaluation. Do not schedule an automation to watch this task's own completion.

## Ordered work

1. Save the current tested baseline to the existing development branch, reconcile deployed/local documentation, push, and verify installation/build from tracked files without copying private originals, credentials or machine runtime state.
2. Configure Cloudflare Access on the existing Worker for production and previews, verify unauthenticated page/API requests are denied, and verify James can still use the workbench. Current Wrangler OAuth grants Worker writes but no Access-application management permission; use the authorized dashboard or an already configured suitable connector. Do not widen permissions silently.
3. Add a task description and editable requested fields, retain those decisions in sessions/backups, and distinguish selected/irrelevant source from unreadable source. Allow manual review and additions for requested columns even when deterministic rules cannot interpret them.
4. Add provider adapters behind the existing evidence/review boundary, test them with offline responses, then run a bounded measured comparison. Record model/version, source/schema, valid evidence, correct/missing/extra values, latency and actual/reserved cost. Missing credentials or account actions remain explicit blockers rather than fabricated results.
5. Verify import, task selection, interpretation, correction, approval, backup/restore and CSV/JSON export with actual benchmark inputs. Run release checks, publish only the tested private release, confirm live behavior, commit/push final work, and leave a concise readiness report.

## Progress

- Baseline committed and pushed as `1a0b106`; final implementation remains on the same development branch.
- Cloudflare Access configured for the existing Worker, production and previews, James's single email only. All routes additionally verify signed Access tokens and owner identity. Unauthenticated page, API and asset requests redirect to Access.
- Task description, editable columns and diagram relevance are retained in requested reviews and sessions. Preparing columns makes no paid call. Imported provider proposals remain unapproved and independently validated.
- Both providers evaluated on the three structured tables and two chemistry tasks. See [results and spending](ai-evaluation.md). No further evaluation calls are needed.
- Final release gate, tracked-source reproduction and deployment write machine receipts under ignored `.wrangler/`; inspect these receipts rather than treating this plan as proof of a deployment.

## Remaining suggestions after this release

Use the tool on several real personal jobs and keep original sources plus portable backups. Expand test cases when a real failure appears, particularly conflicting facts, ambiguous associations and unusual document layouts. Add OCR or visual interpretation only when an actual task needs it. Hosted one-click AI generation and ongoing provider spending require a separate decision; this evaluation does not enable them. No commercial launch, customer management or billing work is needed for personal use.
