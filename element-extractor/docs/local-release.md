# Local first release

The supported release workflow is: paste a public-page URL or its copied text → detect supported structures/quantitative patterns → preview → inspect quotations → correct/revalidate → review → export CSV/JSON. The app is independent of FantasyBrief and has no paid-service bindings.

## Use it on laptop and desktop

Use Node.js 22+ and Git. The Windows [launcher](windows-launcher.md) creates an isolated checkout, installs the lockfile, selects an available loopback port and verifies the page/API before opening the browser. Its checks run on the computer where it is launched; it does not remotely control another computer.

For an existing checkout, from `element-extractor`:

```powershell
npm.cmd ci
npm.cmd run dev
```

Restart the development server after a code update. Use **Interpretation Lab** for copied text. Use the URL workflow on the toolkit home page for supported public tables. Merely pasting a URL into source attribution does not fetch it.

Save the current review with **Save review session** before switching computers or sections. Open that JSON on the other machine with **Open saved session**. CSV/approved JSON are data deliveries; diagnostic JSON is a report; the session file is the reopenable review. Session files contain full source/history, not just approved rows. There is no automatic synchronization or hosted customer storage.

## Acceptance checks

`npm.cmd run release:check` (or `npm run release:check` in Bash) builds the editor bundle, runs the native Workers regression suite, exercises the table browser UI, exercises the Interpretation Lab browser UI, and checks the Wrangler bundle without deploying. Chromium is required; set `CHROMIUM_PATH` if necessary. Test ports 8790/9223 and 8794/9225 must be free. The checks run sequentially, stop at the first failure, and write `.wrangler/release-report.json` with the actual status, exit codes, timings, Node version and tested bundle hash. It does not install a browser or create a cloud service.

The browser and API checks cover:

- Native/accessible HTML tables, the preserved 118-element demo and DCI score fixture.
- Quantitative prose with suggested columns, exact evidence offsets and explicit unmatched passages.
- The full 89-paragraph BLS page, retaining all text and 71 table rows in separate typed batches.
- Percentages versus hourly/annual dollars, strict opt-in thousands grouping and original-page evidence mappings.
- Correcting candidates, resetting stale decisions, explicit review guards and original findings/history retention.
- Actual CSV/JSON downloads, session save/reopen after a reload, and rejecting altered session history.
- Inert source/note markup, spreadsheet formula protection, mobile layout, source/request limits, and no outbound calls from the interpretation workflow.

A live-source check (`npm.cmd run test:live`) is separate and requires Wikipedia access; normal release tests use fixed fixtures for reproducibility. A successful dry run is not a public deployment or a fresh Codex snapshot restoration.

## Exact boundaries

This is a local, trusted-source first release, not an unrestricted commercial service. It uses limited rules and explicitly supported pasted-table headers, not general natural-language understanding. Definitions, arbitrary tables/units, OCR, video transcripts, JavaScript-rendered scraping, anti-bot bypass, accounts, billing, scheduled jobs and paid inference are not implemented. Unsupported content is retained/explained rather than promised as extracted.

Reviewers are self-declared. Evidence and journals are independently revalidated but do not constitute authenticated customer approval or tamper-proof storage. A person controlling a complete client/session file can construct a new self-consistent session. No automatic approval is claimed.

Approved exports contain only approved current-section records. Their JSON still retains source/history; approved-only is not redaction. Section switching starts a separate review, so save each review before leaving it.

Public URL extraction has bounded fetches, origin checks and DNS preflight safeguards, but no connection-level destination pinning, authentication or commercial quotas. Follow the README deployment boundary. The generated `worker-code.txt` is suitable for the editor; actual deployment remains a separate action.

Codex environment publication, current workspace validation, GitHub code and the public Cloudflare Worker are separate states. Environment settings must reference the intended release commit and startup instructions; saved draft changes require product publication. Restoring a fresh cloud task must be verified separately from testing this existing workspace.
