# Operator workbench

Use `npm.cmd ci`, then `npm.cmd run dev` from `element-extractor`. Open **http://127.0.0.1:8787/**. The Windows launcher now opens this same workbench on its chosen port. The same workbench is also deployed on the existing Worker. Cloudflare Access restricts every hosted route to James. The Worker independently verifies the signed Access token and owner identity. Local loopback use stays available. The bounded AI evaluation is recorded in [the comparison report](ai-evaluation.md). There are no customer accounts or billing features.

## Add source → Review/edit table → Download

1. In **Add source**, fetch a public website link, paste text, or read/drop one file. Files are parsed in your browser; selected text and review requests go to the same-origin toolkit backend. The local server stays on loopback. The hosted Worker receives those review requests; browser parsing does not mean the entire review workflow stays offline.
2. Read **Check source coverage** and choose a sheet, page, table or section. Map columns, click cells to inspect evidence, correct/add records, and approve or reject using the existing review tools. Nothing is automatically approved. For file selections, decisions stay in this tab while you switch between selections of the current file. Save a review session before replacing the file or reloading.
3. **Download** exports approved rows from the current selection only, as CSV or JSON. Formula-like CSV cells remain protected. Use **Download captured source** to retain all parsed text/cells, including unsupported selections. Keep the original file for images, formatting and content the parser cannot read. Saved review sessions keep the selected source, file coverage notes, corrections and decisions; they do not embed the original file or other sheet reviews.

Technical extraction settings are collapsed under **Advanced**. Saved reviews, batch tools, Drive feedback and the original table explorer remain available under the bottom **Advanced** section. The original `/interpretation`, `/workspace`, `/tables`, `/example` and extraction APIs remain available.

## Source preview and coverage

**Preview and account for the source** shows captured text, cell grids and explicit unread-image/page placeholders. Word parts follow converted document order; conversion is not a facsimile of the original layout. Website previews cover captured selections only, not the full original page. Pasted text is retained as supplied, without its original images or formatting. Table previews show at most 100 rows and label that limit; captured-source downloads retain all captured rows.

Each source part starts **pending** or **unsupported**. **Mark checked** requires a note and records that you examined that captured part; it does not approve its candidate records or assert that every fact was extracted. **Exclude with reason** requires a reason. Excluding unreadable content keeps its limitation visible; unreadable parts cannot be marked checked. Source parts link descriptively to the review selections containing them. Parts with no matching review selection remain visible for manual examination rather than disappearing from the accounting.

**Save source and all reviews** downloads a `toolkit-workbench-v1` backup containing captured source, coverage notes and current-source reviews across selections. Restore it under Advanced. Restoration checks snapshot hashes and independently revalidates each saved review before replacing current work. Coverage notes remain self-declared operator decisions, not authenticated completeness evidence. Backups are limited to 20 MiB; if the combined history is larger, save individual sessions and captured source separately. Keep backups private: they contain source content and review history. Save before changing sources or closing the tab; there is no automatic durable source storage.

Single-review session files still work, but do not contain the full-source preview or the coverage ledger. Reimport the original or restore a full workbench backup to recover those. Original files remain necessary for images, diagrams, unsupported document features and any content that was never captured.

## Format boundaries

| Input | Behavior and review limits |
| --- | --- |
| Website | Existing checked public-HTTPS fetching, table discovery and targeted local JavaScript fallback. Access barriers, unsupported structures and capture omissions remain explicit. |
| Pasted text | Existing deterministic table/fact rules, evidence, column mapping, corrections, and no-result accounting. Arbitrary prose is not guaranteed to produce records. |
| Excel `.xlsx` | All sheets, including hidden sheets, are listed separately. First populated row is treated as headings. Dates become ISO text; numeric display formatting is not retained. Formulas use saved values only, with a warning when present. Merged cells are flagged; covered blanks are never filled by guessing. Charts/images/macros are not interpreted. Older `.xls` must be saved as `.xlsx`. |
| CSV / TSV | UTF-8; quoted commas, escaped quotes and multiline fields are supported. Different row widths and broken quoting stop import, preserving the current review. First row is treated as headings. Review normalizes whitespace; captured-source JSON retains exact parsed cells and the input text. |
| PDF | Pages with extractable text are offered separately; reading order and spacing are uncertain. Tables are not reconstructed automatically. Pages with no readable text are listed as possible scan/image/blank pages and require external OCR if visible content exists. Embedded images in text PDFs are also not read. Password-protected/damaged documents report failure. No OCR service is connected. |
| Word `.docx` | Simple tables and paragraph text are offered separately. Merged/nested tables remain in captured source and are flagged unsupported. Headers/footers, images, text boxes, layout and tracked changes may be incomplete. Older `.doc` must be saved as `.docx`. |

Limits: 10 MiB input, 32 MiB expanded Office archive / 3,000 parts, 500,000 characters of captured source, 100 PDF pages, 5,000 table data rows and 100 source columns. Excel dimensions beyond these bounds are rejected before parsing. Reviews retain the existing small row/column batches and evidence limits. A table or text block that cannot enter review is explicitly listed; full parsed content remains in captured-source JSON after a successful import. A rejected file replaces neither the existing review nor captured source. Partial PDF page failures are individually listed. No claim of complete visual or semantic extraction is made.

## Verification

After opening a source, describe the task and edit columns using `name:text:required` or `name:number`, one per line. Record diagram relevance for this task. Excluding diagrams requires a reason and never clears unread-content warnings. **Prepare requested columns** opens an empty review when no interpretation is supplied. Add grounded records manually or open a local AI proposal. All rows remain unapproved until reviewed. See [comparison results](ai-evaluation.md). Save the original full-source backup before importing a proposal containing only selected text.

`npm.cmd run verify:source` requires a clean committed repository. It installs locked dependencies from a tracked-source archive without copying credentials, checks a byte-identical Worker build and runs regression tests. Receipt: `.wrangler/source-verification.json`. Protected hosted benchmark requests report `access_required` rather than treating a login page as a parsing failure.

- `npm.cmd run check:workbench-browser`: real installed Chromium/Edge/Chrome; exercises all six source types, multi-sheet switching, file warnings, exact multiline CSV retention, approved CSV protection, saved-session restore, unsupported files and malformed CSV. Captures desktop/mobile screenshots under ignored `.wrangler/`.
- `npm.cmd test`: existing extraction, source safeguards, evidence, mapping, review, feedback and batch regressions.
- `npm.cmd run release:check`: complete local gate, including legacy browser workflows and Cloudflare bundle dry run. It deploys nothing. Windows uses an installed Edge/Chrome automatically; `CHROMIUM_PATH` can override it.

`npm.cmd run build` generates browser parser assets, their third-party notices and the editor-ready Worker bundle. Dependencies are bundled locally; no runtime CDN is needed. Generated parser source is ignored and recreated during builds. `npm.cmd run check` and `npm.cmd run deploy` build first. The existing Cloudflare target is retained. Deployment is explicit, separate from local tests, and uses the verified source release.
