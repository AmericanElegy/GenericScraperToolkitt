# Toolkit links and launch commands

Bookmark this page: https://github.com/AmericanElegy/GenericScraperToolkitt/blob/codex/general-table-extraction/element-extractor/START-HERE.md

## Project and downloads

- The updated launcher opens **Your scraping workspace** (`/workspace`). [Batch workflow and recovery](docs/batch-workspace.md); single-page review is still linked as **Interpretation Lab**.
- [Latest development branch](https://github.com/AmericanElegy/GenericScraperToolkitt/tree/codex/general-table-extraction) — contains the current extraction, review, mapping and local JavaScript-rendering features. These have not been merged into main or deployed automatically.
- [Download this branch as ZIP](https://github.com/AmericanElegy/GenericScraperToolkitt/archive/refs/heads/codex/general-table-extraction.zip).
- [Windows launcher source/download](https://github.com/AmericanElegy/GenericScraperToolkitt/blob/codex/general-table-extraction/element-extractor/scripts/Start-Toolkit-Lab.ps1) — use GitHub's **Download raw file** button to save the script.
- [Windows launcher instructions](docs/windows-launcher.md).
- [Interpretation Lab and column mapping guide](docs/interpretation-lab.md).
- [Local JavaScript renderer guide](docs/javascript-rendering.md).
- [Local release and verification guide](docs/local-release.md).
- [Public Cloudflare demo](https://genericscrapertoolkit.jamesjustice95.workers.dev/) — older deployed demo; newer local features are not deployed there.

## Launch the latest copy on Windows

After saving the launcher in Downloads, run in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\Start-Toolkit-Lab.ps1"
```

It downloads the development branch into a new folder under Documents, starts the toolkit on an available port, verifies the lab/API, and opens the correct browser address. Use that new tab. The port changes between launches; bookmark this guide rather than an old random-port tab. The launcher prints the downloaded app path and a stop command.

## Reuse an updated project folder

Open PowerShell in the `element-extractor` folder of a checkout on `codex/general-table-extraction`. When no local edits need preservation, `git pull --ff-only` updates that branch; restart running servers after updating. Then:

```powershell
npm.cmd ci
npm.cmd run dev
```

Default addresses while that server is running:

- [Web Table Toolkit](http://127.0.0.1:8787/).
- [Interpretation Lab](http://127.0.0.1:8787/interpretation) — source URL fetching with targeted local JavaScript fallback, pasted prose/tables, column mapping, evidence, review, portable sessions and approved exports.

The isolated Windows launcher instead prints its own available port.

## JavaScript-rendered pages

In another PowerShell window, change to the same updated `element-extractor` folder and run:

```powershell
npm.cmd run dev:browser
```

Open [JavaScript Table Renderer](http://127.0.0.1:8791/). This companion needs an installed Edge, Chrome or Chromium browser plus Node 22+ and curl. It does not start automatically with the normal launcher. Keep its terminal open and use Ctrl+C to stop it.

Renderer CSV/JSON/TSV exports are raw snapshots, not approved Interpretation Lab records. TSV can be pasted into Interpretation Lab for mapping and review. Pagination, scrolling, later updates, authentication and POST-driven data loads remain unsupported. Local addresses refer to the computer running the server; they do not connect a phone or another computer automatically.

## Verification

From the app folder:

```powershell
npm.cmd run release:check
```

This runs the regression suite, four real browser workflows and a Cloudflare bundle dry run. It requires Chromium on the test path (`CHROMIUM_PATH` may select an executable); the existing browser check scripts are verified in Linux, not Windows. It performs no deployment. No paid inference, paid browser service or FantasyBrief dependency is enabled.
