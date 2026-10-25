# Web Table Toolkit — local first release

**[Start here: links, downloads and PowerShell launch commands](START-HERE.md).**

A standalone Cloudflare Worker for discovering HTML tables and turning pasted page text into reviewable data with CSV/JSON exports. It has no FantasyBrief dependencies or paid service bindings.

For pages that build their tables with JavaScript, the optional [local browser renderer](docs/javascript-rendering.md) provides a separate read-only capture and export workflow using an installed browser.

## Release workflow

- **Public URL:** find supported native/accessible tables, preview/search and export. The original 118-element example and DCI score adapter remain available.
- **Fetch into the lab:** enter a source URL and click **Fetch page**. Ordinary HTML is tried first; the normal local server can automatically use the installed browser when client rendering is indicated. Paste-only previews remain offline. See [the source-fetch guide](docs/interpretation-lab.md#fetch-a-source-url-and-automatically-try-the-local-renderer).
- **Pasted text:** open **Interpretation Lab**, paste ordinary text or a whole page, and preview suggested records/columns. Supported table sections keep percentages, job counts and dollar amounts separate.
- **Review:** inspect source quotations, correct/add candidates, revalidate, then approve or reject. Unsupported content stays visible with an explanation.
- **Move computers:** use **Save review session**, transfer that JSON file, and **Open saved session** on the other computer. Source, corrections, selected section and existing decisions are revalidated. Review names are self-declared; these are local portable files, not authenticated cloud storage.

See [the release guide](docs/local-release.md) for the exact boundary and verification. This release uses limited deterministic rules, not general AI interpretation.

For pages with many navigation/layout tables, the lab URL importer uses bounded candidate discovery and lists unsupported tables separately. Wide URL tables are split into labeled column groups; some merged tables still require a narrower source or manual mapping.

## PowerShell quick start

Run these commands from the repository's `element-extractor` directory (Node 22+ and curl required):

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local server on port 8787. Keep PowerShell open; Ctrl+C stops the server. `npm run dev` builds an editor-ready bundle and runs native workerd using Miniflare. Its local-only curl bridge respects the managed environment's proxy and CA trust. Deployment uses native Workers fetch.

1. Paste a public HTTPS page URL and click **Find tables**.
2. Choose a discovered table. Unsupported tables show a reason.
3. Search the preview and download the selected table as CSV or JSON.

Exports contain **all rows in the selected table**; searching changes only the preview. JSON contains positional headers/rows, source URL, and extraction time, preserving duplicate column names. CSV quotes fields and prefixes potentially executable spreadsheet formulas with an apostrophe. Source HTML is displayed with `textContent`, never inserted as markup. No extraction history or user-entered source URLs are stored by the application; provider request logs may still exist.

Useful public examples:

- `https://www.w3schools.com/html/html_tables.asp` — two simple tables.
- `https://en.wikipedia.org/wiki/ISO_3166-1` — includes a 249-row country-code table.
- `https://www.dci.org/scores/final-scores/2026-dci-all-age-world-championship-finals/` — a verified 12-row div-based score grid.
- `/example` — the preserved, specialized chemical-elements demo with 118-element validation and cached exports. Its `/api/elements` and `/elements.csv` endpoints are unchanged.

## Supported public-page tables

UTF-8 HTML tables returned directly by public HTTPS webpages. DCI final-score pages also have a targeted adapter for their single-division div-based score grid (Place / Corps / Score); it validates headings and score formatting and excludes sponsor/recap rows. This does not imply arbitrary div layouts are supported. Multiple divisions in one score grid are rejected rather than combined incorrectly. Tables with a single header row or no explicit header row are supported; headerless tables receive positional column names. Text entities are decoded and whitespace collapsed. Scripts, styles and templates are ignored.

Merged cells, nested tables, multiple full header rows, and inconsistent row widths are marked unsupported and cannot be exported from the UI. JavaScript rendering, authenticated pages, anti-bot bypasses, server-stored jobs, scheduled source batches, videos, accounts and billing are outside this release. Interpretation reviews can be saved/reopened as local session files. Access denial or no tables produces an actionable message; no automatic retry is made.

Limits: 2 MiB per source page, 15-second overall source fetch deadline, three redirects, 20 tables, 5,000 total rows, 100 columns, 50,000 cells and 10,000 characters per cell. Limit violations reject the page rather than silently truncating data.

## Request safeguards and deployment boundary

`POST /api/tables` accepts `{ "url": "https://..." }` with a JSON content type. Cross-origin requests are rejected when an Origin header is present, and no CORS access is granted. Input is capped at 4 KiB. The API is not authenticated; this is a demo, not a multi-tenant commercial service.

Only HTTPS hostnames without credentials or custom ports are accepted. Literal IPs, local hostnames, the toolkit's own hostname, and private/reserved A/AAAA DNS answers are rejected. Cloudflare DNS-over-HTTPS checks run before the initial request and every redirect; redirects are followed manually. Request cookies and authorization headers are never forwarded.

DNS checks are a preflight, **not connection-level IP pinning**. Native Workers fetch resolves independently, so this does not fully eliminate DNS-rebinding races. Keep this prototype for trusted public sources. Before offering unrestricted public scraping commercially, add destination enforcement at connection time (or a vetted source allowlist), authenticated quotas and abuse controls. None of those protections is claimed by this stage.

Outbound access requires `cloudflare-dns.com` plus each source hostname (including redirect destinations). Example domains are `www.w3schools.com` and `en.wikipedia.org`. Builds require `registry.npmjs.org`; GitHub synchronization requires `github.com`. Cloudflare authentication/deployment uses `dash.cloudflare.com` and `api.cloudflare.com`.

## Validation

The complete local release gate requires Chromium (or `CHROMIUM_PATH`) and runs the Workers suite, both browser workflows and a Cloudflare deployment dry run:

```powershell
npm.cmd run release:check
```

It stops on failure and records actual outcomes plus the tested Worker hash in ignored `.wrangler/release-report.json`. No deployment is performed. For smaller checks:


```powershell
npm.cmd test
npm.cmd run test:live
npm.cmd run check
```

- `npm test`: workerd regression checks, including the existing chemical-elements workflow and a table-extraction suite covering discovery, entities, plain-text rendering, unsafe URL forms, private/mixed DNS, redirects, limits, unsupported structures, and API input handling.
- `npm run test:live`: downloads current Wikipedia HTML and verifies 118-element extraction and CSV in workerd. Requires network access.
- `npm run check`: Wrangler deployment dry run; uploads nothing.
- `npm run check:browser`: optional Chromium test for table selection, search, actual downloads, CSV formula protection and inert HTML. Install Chromium and put it on PATH, or set `CHROMIUM_PATH`. It uses fixed local ports 8790 and 9223 and does not require external sites.

Live general table discovery was also checked against W3Schools and Wikipedia ISO 3166-1. Those checks do not guarantee compatibility with every public page.

## Build and deploy

`src/worker.js` is canonical. `npm run build` bundles its small HTML-entity decoder dependency into **worker-code.txt**, a standalone ES module suitable for pasting into Cloudflare's editor. The bundle is generated; edit the source and rebuild rather than editing both files. Wrangler deploys the source and bundles its dependencies automatically.

`npm run deploy` updates the `genericscrapertoolkit` Worker using your authenticated account. This project does not enable paid services or change your subscription. Deploying and saving a Codex environment snapshot are separate operations.

DCI support requires outbound access to `www.dci.org` (and `dci.org` if using its alternate hostname). The score adapter uses the already returned HTML; it does not execute page JavaScript or use a paid browser.

## General detection checklist

The API now returns `diagnostics` on extraction success and on failures after a valid request begins. The UI shows the next action and an expandable **What was checked?** list. It checks the public request, native HTML tables, general accessible (`role=table/grid`) structures, matching site adapters, embedded JSON, JavaScript indicators, and images/canvas. Accessible grids use the same row/cell/size limits and unsupported-structure rules as native tables. A native table with an ARIA role is not duplicated.

Messages distinguish observations from hypotheses: an app container plus linked scripts suggests possible client rendering but does not prove it. JSON blocks may be metadata, not data. Images may be logos; finding one does not prove the requested rows are image-based. A password field or verification title is an access indicator, not a license to bypass it. Access and request-limit failures stop extraction before fallback methods run.

A direct image URL explains that OCR is needed. Pages containing only possible visual data explain that image contents were not read. **OCR, JavaScript execution, and automatic extraction from arbitrary embedded JSON are not enabled.** Future OCR would require row/column reconstruction and review of uncertain values before claiming a verified dataset. No paid service has been added.

## Offline paragraph interpretation prototype

Run `npm.cmd run interpretation:demo` in PowerShell for the new **scripted, offline** backend lab. It exercises bounded passages, requested columns, evidence offsets/hashes, independent validation, explicit no-result accounting, raw-response replay, append-only review events, and approved/diagnostic exports. It does not infer values from arbitrary prose or call an AI service. The home page links to a browser-based [Interpretation Lab](docs/interpretation-lab.md) for pasted prose with automatic quantitative suggestions, fictional examples, evidence highlighting, candidate correction/addition, session-only review and downloads. Automatic mode accepts full-page text with bounded section selection, preserves original-page evidence, and suggests measure/value/unit/qualifier columns for prose or typed columns for supported tables; manual mode retains two configurable columns (text and number). These are limited rule-based suggestions, not general language understanding. The public Worker is not deployed automatically. See [the walkthrough and trust limits](docs/offline-interpretation.md).
