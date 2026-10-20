# Web Table Toolkit — Stage 1

A standalone Cloudflare Worker for discovering HTML tables on public HTTPS pages, choosing a table, searching its rows, and downloading CSV/JSON. It has no FantasyBrief dependencies or paid service bindings.

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
- `/example` — the preserved, specialized chemical-elements demo with 118-element validation and cached exports. Its `/api/elements` and `/elements.csv` endpoints are unchanged.

## Supported in Stage 1

UTF-8 HTML tables returned directly by public HTTPS webpages. Tables with a single header row or no explicit header row are supported; headerless tables receive positional column names. Text entities are decoded and whitespace collapsed. Scripts, styles and templates are ignored.

Merged cells, nested tables, multiple full header rows, and inconsistent row widths are marked unsupported and cannot be exported from the UI. JavaScript rendering, authenticated pages, anti-bot bypasses, saved jobs, batch extraction, scheduling, videos, accounts and billing are outside this stage. Access denial or no tables produces an actionable message; no automatic retry is made.

Limits: 2 MiB per source page, 15-second overall source fetch deadline, three redirects, 20 tables, 5,000 total rows, 100 columns, 50,000 cells and 10,000 characters per cell. Limit violations reject the page rather than silently truncating data.

## Request safeguards and deployment boundary

`POST /api/tables` accepts `{ "url": "https://..." }` with a JSON content type. Cross-origin requests are rejected when an Origin header is present, and no CORS access is granted. Input is capped at 4 KiB. The API is not authenticated; this is a demo, not a multi-tenant commercial service.

Only HTTPS hostnames without credentials or custom ports are accepted. Literal IPs, local hostnames, the toolkit's own hostname, and private/reserved A/AAAA DNS answers are rejected. Cloudflare DNS-over-HTTPS checks run before the initial request and every redirect; redirects are followed manually. Request cookies and authorization headers are never forwarded.

DNS checks are a preflight, **not connection-level IP pinning**. Native Workers fetch resolves independently, so this does not fully eliminate DNS-rebinding races. Keep this prototype for trusted public sources. Before offering unrestricted public scraping commercially, add destination enforcement at connection time (or a vetted source allowlist), authenticated quotas and abuse controls. None of those protections is claimed by this stage.

Outbound access requires `cloudflare-dns.com` plus each source hostname (including redirect destinations). Example domains are `www.w3schools.com` and `en.wikipedia.org`. Builds require `registry.npmjs.org`; GitHub synchronization requires `github.com`. Cloudflare authentication/deployment uses `dash.cloudflare.com` and `api.cloudflare.com`.

## Validation

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
