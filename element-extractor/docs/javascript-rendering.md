# Local JavaScript table renderer

The optional renderer executes webpage JavaScript in a fresh installed Chrome, Edge, or Chromium profile and extracts native HTML tables and simple accessible tables/grids from the resulting DOM. It is a separate local Node companion. The Cloudflare Worker has no native browser or paid binding. The normal local Interpretation Lab server can call this renderer automatically through its explicit Fetch page workflow; the standalone companion remains available too.

From the updated `element-extractor` folder in PowerShell:

```powershell
npm.cmd run dev:browser
Start-Process 'http://127.0.0.1:8791/'
```

Keep that terminal open; Ctrl+C stops the service. Use `RENDER_PORT` to choose another port. No npm browser download is required: Windows checks installed Edge/Chrome; Linux defaults to `chromium`. Set `CHROMIUM_PATH` to select an installed compatible executable. Node 22+ and curl are required. Browser startup will fail clearly if the executable or operating-system sandbox is unavailable. In a separate PowerShell window you can run the browser renderer alongside the usual toolkit server. Browser profiles are temporary; existing profiles, cookies and logins are never used.

Paste a public HTTPS URL and select **Render tables**. Search the captured rows and export CSV, JSON or TSV. TSV can be pasted into Interpretation Lab's automatic column mapping for typed interpretation and human review. CSV/TSV protect formula-leading text; JSON preserves original strings, source/final URLs, retrieval time and diagnostics. These renderer exports are raw snapshots, not approved Interpretation Lab records.

The page is polled for a nonempty table that stays unchanged for 750 ms, with a 12-second render window. This is not proof of completeness. Pagination, scroll-triggered content, virtualized rows, later updates, interaction-dependent views, canvas, charts, images, nested/merged tables and embedded frames are unsupported. Ambiguous/merged layouts disable export. No login, CAPTCHA bypass, custom cookies, authorization headers or downloads are supported. Only GET requests for HTML, scripts, stylesheets and fetch/XHR data are allowed. Sites needing POST data requests may remain incomplete. Blocked resources, script-error counts and unsupported structures appear in diagnostics.

Bounds: one job at a time, a 64-request budget (further attempts are blocked), four concurrent resource fetches, 2 MiB per resource, 8 MiB total fetched resources, 20 tables, 5,000 rows, 100 columns, 50,000 cells, and 10,000 characters per cell. Oversized structures fail rather than silently truncate. Diagnostic resource lists are capped at 20 entries. Public URL/DNS checks reject private/reserved destinations and validate redirects; direct desktop curl requests pin a checked address. In managed environments curl retains the configured proxy and CA path. Browser networking uses a dead proxy so intercepted requests must pass through the guarded read-only fetcher; service workers and WebSocket/file/FTP requests are blocked. The local UI is loopback-only and rejects cross-origin POSTs and unexpected request fields.

`npm.cmd run check:renderer-browser` exercises a local synthetic source that has no table until JavaScript fetches data and creates it. A real Chromium session verifies rendering, private-address and POST blocking, inert cell text, search, and actual CSV/JSON/TSV downloads. The Linux fixture test opts out of Chromium sandboxing for restricted CI; the production launcher retains the OS sandbox by default. `TOOLKIT_BROWSER_NO_SANDBOX=1` is only an explicit diagnostic option for a disposable restricted container, not a recommended desktop setting. This verification does not establish compatibility with every public website or a Windows execution environment.

No paid services, AI APIs, FantasyBrief code, credentials or deployment changes are involved.
