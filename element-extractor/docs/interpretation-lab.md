# Browser Interpretation Lab

Start with `npm.cmd run dev` in PowerShell, then open **Open the offline Interpretation Lab** on the toolkit home page (`/interpretation`). The local server must be restarted after a code update. Nothing is deployed automatically. The isolated [Windows launcher](windows-launcher.md) downloads the latest feature branch into a separate folder and verifies startup.

## Automatic suggestions (default)

Paste prose unchanged, leave **Suggest columns and facts from prose** selected, and click **Preview suggested records**. No column names or special input formatting are needed. Manual column inputs are hidden and disabled in this mode, so they cannot trigger a browser pattern-validation error.

For prose, the `prose-facts-v2` offline interpreter suggests four columns: `measure` (text), `value` (number), `unit` (optional text), and `qualifier` (optional text). It recognizes explicit rates followed by “based on” or “of” labels, simple percentage statements, selected count nouns and simple name/number pairs. These are generic quantitative rules, not a BLS-only adapter or general language understanding. It does not summarize definitions, infer missing relationships, interpret arbitrary text-only facts or guarantee complete coverage. The preview explains the method, and every paragraph stays visible.

For the supplied OEWS passage, suggestions include establishments / 66.2 / percent, weighted sampled employment / 67.2 / percent, areas / 530 / areas / over, and states / 50 / states. The original sentence remains the evidence; “over 530” is not turned into an exact count. Bare years, NAICS classification digits and URL target numbers are not treated as facts. Units and qualifiers preserve literal source spelling; there is no unit conversion. Different measures may have different contexts, so inspect the quotation before treating them as comparable.

Automatic suggestions are always pending. Negation/correction/uncertainty keywords and percentages outside 0–100 create blocking findings. These keyword checks are incomplete; even a clean literal match requires human association review. Ambiguous unsupported clauses may produce no candidates instead of a guess. Optional blank unit/qualifier values are allowed when correcting a record. No-result and partial matches are not proof that all information has been extracted.

## Pasted employment/wage tables

Automatic mode also recognizes the explicit grouped header `Major occupational group Percent of total employment Mean hourly wage ($)` followed by repeated `United States <local region>` labels. Paste the header and rows together, with rows on separate lines or separated by blank lines. This is a supported layout, not a universal reconstruction of arbitrary flattened tables. Missing/ambiguous headers or incomplete rows are not guessed.

The `pasted-wage-table-v2` schema separates occupational group, national employment percent, local employment percent, national hourly wage in dollars, and local hourly wage in dollars. The region is shown in the preview explanation. Numeric cells cite both their row and the header, so a reviewer can verify alignment and units. The header is supporting evidence, not a data row.

For the supplied Jacksonville table, 23 rows are recognized. The first row has employment shares of 100% / 100% and hourly wages of $33.54 / $31.59. The screen displays percentage and dollar symbols; CSV/JSON retain numeric values in clearly named percent/dollar columns, allowing numeric sorting/calculation. This is not a formatted Excel workbook. The source dollar sign is retained; the tool does not perform currency conversion or infer an ISO currency code.

Rows currently require exactly four ungrouped decimal values, optionally with dollar signs on the two wage cells. This single-table layout does not support thousands separators, locale-specific currency formatting or other grouped headings. The separate full-page intake below handles recognized multiple tables and comma grouping in explicitly tagged employment/annual-wage columns. Table percentages are checked against 0–100 and wages against zero; all associations still require review. The prose parser itself has not acquired general currency understanding.

## Whole-page intake and section selection

Automatic mode accepts up to **64,000 UTF-16 characters** and **512 source paragraphs**. A paste is not clipped by the textarea; an oversized paste stays in the box with an error instead of being silently truncated. The URL is still only attribution and is never fetched.

Pages exceeding one packet, or containing multiple recognized table headers, enter full-page intake. The complete normalized source is retained. The UI lists sections; the first recognized table is previewed automatically. Use **Open selected section** to review another table batch or the surrounding prose. Each section gets its own schema, candidate cache, review and export. Switching starts a new review session: save its session file or download its export before leaving. Decisions do not transfer between sections and are not saved to a durable workspace. Current approved exports cover only the selected section, never the entire document.

The supplied Jacksonville page contains 89 paragraphs and 71 table rows. Intake produces four selections: the 23-row employment-share/hourly-wage table; two 24-row batches of the employment/location-quotient/hourly/annual table; and the surrounding article, headings and footnotes. The table parser handles row labels followed by a newline and tab-delimited values. Unrecognized text outside table blocks remains selectable; it is not discarded or silently parsed as the other table type. This is still limited recognition of supported layouts and quantitative prose, not a universal webpage interpreter.

Each table batch repeats its **own** header as evidence and stays within the core packet's 16,000-character / 32-paragraph / 50-record limits. The second table uses separate `employment_count`, `location_quotient`, `hourly_wage_dollars` and `annual_wage_dollars` fields. It does not use the first table's employment percentages or national/local columns. Strict comma grouping is enabled only for explicitly tagged numeric columns: `96,850` becomes the numeric value `96850`, and `$49,690` becomes `49690`, with the original quotation retained. Malformed grouping, comma suffix matches and locale-specific conversions are rejected. Other existing numeric schemas keep their ungrouped behavior. Grouped columns use validator identity `evidence-grouped-v1`; unchanged legacy schemas retain their prior validator identity.

JSON includes the whole retained normalized page, its hash, the original pasted-text hash, the selected section ID, the section list and the mapping from packet offsets to full-page offsets. Every validated quotation also has server-computed original-page offsets and document hash. Intake/revalidation rederive the selected source from the full page, so replacing a section ID while keeping another packet is rejected. The source is normalized only from CRLF/CR to LF; whitespace/sections are not silently deleted. JSON therefore contains text outside the approved/selected records and is **not** a redacted delivery.

Intake currently allows at most 32 sections, with up to 24 table rows per batch. Very long single paragraphs (>12,000 characters), malformed/ambiguous table headers and unsupported table shapes receive an explanation rather than a guessed mapping. Large prose is batched, but supported quote-length and per-section candidate limits still apply; extraction is not guaranteed for every section. The API request limit is now 1 MiB to allow a retained page plus its selected review job; candidate raw responses remain capped at 128 KiB by the core contract.

## Manual pair mode

Choose **Manual name/number column names** if you want to specify a two-column schema for the original narrow parser.

1. Paste your passage into **Use your own text**. The optional HTTPS URL is attribution only; it is never fetched. The pasted text, rather than the URL, is the source snapshot.
2. Set two requested column names: one text field, then one numeric field. Defaults are `entity_name` and `score`. Use distinct lowercase identifiers with underscores. The core validator supports other schemas, but manual pair mode is limited to this pair.
3. Click **Preview suggested records**. The `name-number-v1` grammar supports simple lines/sentences such as `Alpha scored 98.6.`, `Alpha received a score of 98.6.` or `Alpha: 98.6`. It accepts signed, ungrouped decimals; there is no assumed 0–100 range. It does not infer arbitrary relationships or handle all natural-language wording. Sentence splitting is basic; abbreviations and complex clauses may need manual correction.
4. Inspect every candidate against its highlighted exact quotation. Every candidate starts pending. Paragraphs without a supported match stay visible with an explicit no-result explanation; that is not proof of absent data. Keywords for correction, negation or uncertainty block rule candidates in that paragraph, but this heuristic is not complete semantic analysis.
5. Enter reviewer name, note and source confirmation to approve a clean candidate. The button explains missing steps and displays **Already approved** after success.
6. Download approved CSV/JSON or diagnostic JSON. Approved exports omit rejected/pending records. Diagnostic JSON retains all current statuses and failed evidence.

The interface is ready for text later; you do not need to provide text during setup. No paid or AI service is used. The deterministic parser's output uses the existing versioned scripted-response cache contract; it is not model inference.

## Correcting and adding candidates

Open **Correct selected candidate or add a record**. Click **Edit selected record** or **Add a record**. For each column, supply a value, supporting paragraph, exact quotation and zero-based quotation occurrence (first match is 0). Enter your reviewer name above and a reason in the candidate editor, then choose **Save candidate and revalidate**.

A revision explicitly replaces the selected candidate's values, evidence and interpreter flags. It does not change the source snapshot. The independent validator recalculates quotation offsets, literal support, types and bounds. Invalid evidence can be saved as a pending candidate but cannot be approved. Relationship correctness still requires human review; a matching number alone does not prove association.

Saving any candidate revision resets **all** current decisions to pending, including other records, because decisions are bound to the entire validation snapshot. Earlier decisions are retained alongside their candidate revision. Reapprove candidates after checking the new version. No flagged record is silently approved and no original proposal is deleted from the retained history.

For **Scores and a correction**, row-2 proposes the outdated `95.1`. Edit its score to `95.4`, retain the full quotation containing the correction and name, and give the correction reason. Save/revalidate, then review and approve. For unsupported prose, add a record manually rather than inventing an automatic extraction.

## Save a session and continue on another computer

Click **Save review session** to download `toolkit-review-session.json`. Transfer that file to your laptop or desktop, start the same app version, choose it under **Saved session JSON**, and click **Open saved session**. No account, credentials or paid storage are needed. Local session files can also protect against losing work on reload.

A portable session contains the retained source/page, selected section, columns, raw candidates, candidate revisions and earlier/current review journals. It preserves the current section only; save each section before switching if you want to return to its decisions. Full-page source and history can contain unapproved/private material; this is not a redacted delivery file.

Opening a file replays rule/fixture extraction, source/hash and document-map checks, candidate corrections, evidence validation and review history. A corrupted or incompatible file fails without replacing the current review. Imported review names remain self-declared, not authenticated proof; the current reviewer input clears so the app does not impersonate the person whose file was imported. No record is newly approved during import; the file's consistent prior decisions are replayed.

The portable format is `toolkit-review-session-v1`. Use this dedicated session download for reopening: approved/diagnostic data exports are reports, not session files. Session downloads are limited to 1,000,001 bytes including their final newline; the restore request still fits the 1 MiB API limit. Files depend on supported parser/validator versions; future incompatible versions should be reported rather than silently rewritten.

## Exports and review history

JSON exports include the original candidates, correction commands/reasons, previous review journals, current validation, source hashes and evidence. The current review log is separate from the candidate revision history. The latter retains decisions invalidated by revisions. The raw current response is also included in diagnostic JSON.

CSV's `validation_issues` column preserves original automated finding codes. In particular, `association_unverified` describes the automatic check; `review_status=approved` records completed human association review. The source pane explicitly distinguishes original findings from completed human review. Human review does not retroactively make automated semantic verification possible.

Both JSON export types contain the full source snapshot, passage outcomes and original candidates. Approved-only filters current records, **not** source text, historical proposals or review history. These exports are not privacy redaction.

## Session limits and trust boundaries

- Core packet: at most 16,000 UTF-16 code units, 32 paragraphs, 50 candidates. Automatic page intake can retain up to 64,000 characters and 512 paragraphs, splitting selections into core packets. No silent truncation. Evidence quotations: at most 2,048 characters each. API body: at most 1 MiB; repeated evidence/history can reach this limit before other limits.
- Maximum 8 candidate revisions and 64 review decisions per version. On a limit, download diagnostic JSON before starting a smaller session. History is not silently discarded.
- Working state stays in browser memory: new extraction, new example or reload clears it. Save a portable review session file to reopen it later. No automatic browser storage or durable server saving is provided.
- Names and correction reasons are self-declared. The API rederives rule/fixture candidates, replays corrections, independently validates evidence and verifies review journals. It is not authenticated approval, a protected audit database or tamper-proof storage; a caller controlling all client state can construct a different self-consistent session.
- Source and notes render as text under a restrictive CSP. JSON POSTs only, no CORS grants; supplied cross-origin Origin headers are rejected. There are no outbound source/provider calls.
- OCR, JavaScript scraping, paid inference and FantasyBrief dependencies remain absent. The existing table/DCI/element routes and offline CLI are separate and unchanged.

## Developer entry points

- `src/interpretation/page-intake.js`: full-page section planning, typed table extraction and original-document evidence mapping.
- `src/interpretation/wage-table.js`: grouped pasted wage-table detection, mapping and row/header evidence.
- `src/interpretation/prose-rules.js`: versioned automatic quantitative suggestions and schema.
- `src/interpretation/text-rules.js`: bounded `name-number-v1` grammar. Change its version when changing replay semantics.
- `src/interpretation/lab-api.js`: stateless source/fixture handling, correction replay, independent validation/review/export.
- `src/interpretation/lab-page.js` and `lab-client.txt`: UI; `.txt` is a source JavaScript text module.
- `GET /interpretation`, `GET /interpretation-client.js`.
- `POST /api/interpretation/start`: automatic mode uses `{example_id:"custom-text",mode:"auto",source:{text,url:null}}` without a client schema; pass the returned `dataset_id` to open another full-page section. Manual mode uses `mode:"pair"` plus a two-column schema (omitting mode preserves older clients). Examples use `{example_id:"scores-and-correction"}` (also `missing-evidence`, `ambiguous-association`), or `{example_id:"custom-text",source:{text,url:null},schema:{fields:[{name:"entity_name",type:"string",required:true},{name:"score",type:"number",required:true}]}}`.
- `POST /api/interpretation/action`: returned job plus `action`: `revalidate`, `review`, `correct`, `export`, `save`, `restore`. Restore uses `{action:"restore",session:{format:"toolkit-review-session-v1",job}}` and no separate job; save returns the portable JSON download. Review needs `decision`; correction needs `{record_id:null|id,fields,reviewer,note}`. Null adds a record; supplied field evidence uses the core quotation contract. Export needs `format:"csv"|"json"` and optional `diagnostic:true`.

`npm test` exercises the backend in workerd, including the full BLS prose fixture, automatic schema suggestions, units/qualifiers, URL/year exclusion, custom rules, no-result accounting, correction/review history, tampering and approval guards. `npm run check:lab-browser` checks real browser paste, manual addition, correction, approval, exports, inert markup, mobile layout and session reset. Chromium is required (optional `CHROMIUM_PATH`); the browser test temporarily uses ports 8794 and 9225. `npm run check:browser` covers the separate table UI. `npm run check` is a Wrangler deployment dry run; none of these commands deploys.

## Review queue and compact workspace

Source entry and advanced details collapse after preview. Select a record to inspect its quotation in the side panel. “Passage 1” is the readable label for internal source ID `p001`; IDs and offsets remain available in source references. Filters show pending records or records requiring individual attention.

Supported table rows without blocking findings can be selected together. Batch approval requires a reviewer name, note and explicit confirmation of the header mapping. The server checks every selected record and records a separate journal event for each; a blocked or ineligible selection rejects the entire batch. Edited rows, prose suggestions and rows with blocking findings cannot use batch approval. This reduces repeated clicks without automatic acceptance or removal of evidence.

Prose v2 recognizes explicit lists such as “Office occupations accounted for 12.6 percent of employment, followed by transport (9.9 percent), sales (9.8 percent)” as separate subject/value pairs. Parenthetical occupation lists preserve internal commas and conjunctions. Each pair cites its own clause. Unsupported wording may still be missed and prose always requires individual review. Legacy v1 sessions replay with their original interpreter version rather than silently changing candidates.

## Browser-copied captions and extraction diagnostics

A recognizable `Table A.` (or numbered table) caption may precede the wage headings, including when a copied year joins directly to `Major occupational group`. Labels and their four numeric cells may be separated by line breaks. Wrapped heading whitespace is accepted; the repeated national/local column labels must still agree. Original text and evidence offsets are preserved. Legacy v1 wage sessions retain their original parser behavior. Missing or ambiguous headings do not justify guessing the four numeric column meanings.

The result message reports candidate counts and passages with no records. Table-like content without a supported mapping reports **column mapping unresolved**, rather than implying extraction succeeded. Unmatched-passage counts do not measure complete fact coverage: a passage with one candidate can still contain missed facts. Manual two-column mode cannot represent a four-value wage table.

## Automatic column mapping

Paste one tab-separated, pipe-separated (including simple Markdown tables), or unquoted CSV table with a single explicit header. Automatic mode suggests up to eight columns and 50 rows without column-name entry or source reformatting. The delimited-table path is limited to the existing 16,000-character / 32-paragraph packet bounds; larger pages still use supported full-page layouts. It does not infer arbitrary space-separated column boundaries, quoted CSV dialects, multiline CSV cells, or grouped/merged headers.

Open **Column mapping · suggested automatically** to see source headings, export names, formats and samples. Percentage and dollar headings or consistent explicit cell markers preserve their units. Plain consistent numeric columns become numbers; IDs, codes, dates, years and leading-zero values stay text. Malformed grouping and mixed unit markers are not silently converted. Missing required cells, invalid numeric cells, unit conflicts and out-of-range percentages block approval. Dollar signs do not identify an ISO currency.

Optional name/format edits start a new unapproved review; save the current session before applying them. No approval carries over. Saved sessions preserve the chosen mapping, source quotations, validation and review journal. Unsupported row widths/CSV quoting are listed in the preview and result message; skipped rows remain in retained source. These diagnostics do not prove full extraction coverage. No AI calls, OCR, browser rendering, new service credentials or FantasyBrief dependencies are introduced.
