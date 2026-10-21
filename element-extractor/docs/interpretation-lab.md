# Browser Interpretation Lab

Start the existing project with `npm.cmd run dev` in PowerShell, then use **Open the offline Interpretation Lab** on the toolkit home page. The lab is at `/interpretation`. It works in the local Workers runtime; it is not deployed automatically.

## What to try

1. Load **Scores and a correction**. All candidates start pending.
2. Click `corps_name` or `score`. The source pane highlights validated quotations and shows the exact evidence beside the proposed value.
3. For a clean record, enter a reviewer name and note, compare the source, and explicitly confirm the association before approving. Literal support alone never approves a record.
4. Select the record containing an old score and correction. Approval stays blocked by the finding; reject it or leave it pending.
5. Click **Revalidate evidence**. The cached scripted response and the review journal are checked again, without calling an interpreter or provider.
6. Download **Approved CSV**, **Approved JSON**, or **Diagnostic JSON**. Before approval the approved exports contain no records. Diagnostic JSON retains all statuses, raw proposals, source hashes, quotations and review history.
7. Try **Missing supporting evidence** and **Wrong name–score association**. Both are intentionally flawed examples; the lab does not repair or silently accept them.

The requested columns and their order come from the example's schema. A no-result passage is labeled as an interpreter-reported outcome, not independent semantic verification. System findings remain visible after a human decision, with later review events appended rather than old events edited.

## Session and trust boundaries

- Built-in **fictional scripted examples only**. There is no free-text or URL interpretation input, AI service, OCR, browser-rendered scraping or paid inference.
- State stays in browser memory between requests. Reloading or loading another example clears it. No automatic local-storage or durable server saving is provided.
- Download diagnostic JSON before clearing the session if you need a retained record. Import/restore through the browser is not implemented.
- JSON contains the full source snapshot and passage outcomes. Approved-only filters records; it is **not** source-text redaction.
- Reviewer names are self-declared. This is a demonstration of review controls, not authenticated customer approval or protected audit storage. The browser sends the journal back for hash/revalidation checks; this is not an authoritative server-side append-only database.
- Decisions are bound to the packet and validation identity. Changing them invalidates the journal. A caller with control of the entire client state can start a new session; this lab makes no authentication guarantee.
- The stateless API accepts only unchanged built-in source/schema/response fixtures, JSON posts, up to 128 KiB per request and 64 review events. No history is silently truncated. Cross-origin requests with an Origin header are rejected; there are no CORS grants.
- Source, candidate values, evidence and notes are rendered as text. The lab's Content Security Policy permits its same-origin script and API, not third-party scripts. The lab makes no outbound source or provider request.

The standalone CLI remains available for custom **scripted** packets; its limits and artifacts are described in [offline-interpretation.md](offline-interpretation.md).

## Developer entry points

- `src/interpretation/lab-page.js`: responsive lab page.
- `src/interpretation/lab-client.txt`: JavaScript served as a Workers text module; it is source, despite its `.txt` extension.
- `src/interpretation/lab-api.js`: routes and built-in example fixtures, reusing the independent interpretation validator/review/export module.
- `GET /interpretation`, `GET /interpretation-client.js`.
- `POST /api/interpretation/start`: `{ "example_id": "scores-and-correction" }` (also `missing-evidence` or `ambiguous-association`).
- `POST /api/interpretation/action`: an action (`revalidate`, `review`, `export`) and returned job. Review also needs a decision; export needs `format` (`csv` or `json`) and optionally `diagnostic: true`.

`npm run build` embeds the text asset into `worker-code.txt` using esbuild's text loader. Wrangler has a matching Text module rule, so CLI deployments also bundle/ship the same asset. No extra paid binding is needed. Do not edit the generated Worker bundle directly.

## Verification

`npm test` includes native workerd checks for page/script delivery, zero outbound calls, explicit approval guards, flagged/missing evidence, journal replay, approved/diagnostic exports, request limits and fixture/history tampering, alongside the existing backend/table/DCI tests.

`npm run check:lab-browser` uses Chromium to test the real UI: field highlighting, approve/reject/pending decisions, revalidation, actual downloaded files, inert markup in reviewer notes, mobile width and session reset. Install Chromium or set `CHROMIUM_PATH`. It temporarily uses ports 8794 and 9225. `LAB_SCREENSHOT_DIR` optionally saves screenshots; screenshots are otherwise not generated.

`npm run check:browser` retains the table UI regression. `npm run check` remains a deployment dry run. No command above deploys the public Worker or changes FantasyBrief.
