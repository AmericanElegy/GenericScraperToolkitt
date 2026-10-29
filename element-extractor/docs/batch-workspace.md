# Batch workspace

The usual PowerShell launcher now opens **Your scraping workspace** at `/workspace`. The single-source Interpretation Lab remains linked in the header. No paid inference, scheduler, account login or new external storage service is enabled.

## Daily flow

1. Name the workspace and add up to ten public HTTPS source URLs, one per line. Canonical duplicates are skipped; invalid URLs do not partially modify the queue.
2. Click **Fetch queued pages**. Sources run sequentially through the existing bounded ordinary-HTML path and targeted local JavaScript fallback. A blocked source stays visible with its reason. There is no automatic retry. **Stop after current page** leaves later sources queued for your next explicit run.
3. Select a source. Compare table headings and sample rows. Keep the columns and source row range you want, then **Prepare selected content**. A single unambiguous section can be prepared automatically; multiple sections require selection. Preparation always starts a fresh unapproved review.
4. **Review prepared records** opens Interpretation Lab in another tab. Keep both tabs open. Approved/rejected/pending decisions and corrections are independently revalidated before returning to the workspace. The Lab displays whether its current review is still linked. Loading another source there starts a separate review; it cannot silently replace the workspace source. Explicit column remapping of the same source can replace its review with approvals reset.
5. Choose a compatible export group, then **Approved CSV/JSON**. Groups require identical ordered field names, types, constraints and number formats. Only approved records from prepared sources are exported. Failed refreshes do not silently contribute older approvals. Source URL, source entry, review hash (the complete validated job fingerprint), text snapshot hash, label and record identity remain available. JSON includes full source packets and review history, including unapproved text. Rows are never silently joined or deduplicated.

Use **Add another part** to create a separate selection from the same captured page without another request. For example, prepare project counts first, then a different row range or set of columns. Explicit extra parts consume another source-entry slot. They receive no inherited approvals. Distinct entry/review identifiers keep overlapping parts traceable in combined exports.

## Reusable table settings

Expand **Reuse these settings** after choosing a table's columns and range. Save a name. Settings require the same hostname, exact ordered headings, and any explicit source caption. A missing/changed heading, ambiguous table or multiple matching settings holds that source for manual selection. Nothing picks the nearest-looking column, infers a join key or approves a record automatically. Fixed row ranges that no longer exist also require correction rather than truncation. Duplicate identical settings are not added repeatedly.

Recipes apply to tables only. Paragraph sections use their versioned interpretation profiles. Changes to a page's values alone do not require new settings, but the newly fetched records still need review.

## Persistence and recovery

The workspace uses the same separately configured Drive root as Interpretation Lab. Immutable files are under **Web Table Toolkit/workspaces**, separate from feedback cases and FantasyBrief. Prepared jobs, source receipts and settings persist. A prepared table retains its captured parent, allowing another part after reopening without refetching; unprepared page previews are held only in the current tab and need refetching after reopening. Unsaved typing is not a durable job. The launcher’s isolated code updates do not move this data directory.

**Saved locally** is not confirmation of cloud upload. Wait for Drive for desktop synchronization before moving computers. Open the named workspace from **Saved workspaces and backups** on the other machine. Reviews are independently revalidated on load. Conflicting histories from concurrent machines are held without selecting a winner. Source snapshots and reviewer names remain self-declared rather than authenticated customer approvals.

Download a portable workspace backup before closing when Drive saving fails. Portable backup generation is independent of the Drive write path. Import validates checksums and every prepared review. The UI protects dirty work from accidental replacement. Interrupted fetches resume as queued sources and require an explicit run; they do not become completed jobs.

Bounds: ten source entries (including extra parts), twenty settings, 3.5 MB of workspace data, 200 revision links; local store up to 200 immutable snapshots and 100 MB, each at most 4 MB. The UI reports capacity errors. Archive old histories outside the live folder or start another workspace when needed. Individual source/table/quote/record and network safeguards still apply. This is an internal personal workspace, not an unattended crawler or transactional multi-user database.

## Verification

- `npm run check:workspace-browser` exercises a serial queue, access failure accounting, exact recipes, changed-heading holds, a real same-origin review-tab handoff, explicit remapping, approved-only source-attributed CSV, portable backup, Drive reopening, currency formatting, extra captured parts, mobile layout and stop-after-current behavior.
- `npm run release:check` also runs all Workers regressions, the existing extraction/renderer/feedback browser workflows and a deployment dry run. It does not deploy or call a model.

An optional live check is available with `npm run test:live-workspace`. Its default public sources are W3Schools, DCI and Wikipedia. It uses a temporary local folder, prepares unapproved jobs and saves a JSON receipt; it does not test the user’s actual Google Drive synchronization or establish overall extraction accuracy. Set `LIVE_WORKSPACE_OUTPUT_DIR` to retain the report and screenshot.

## Finding sources

Use **Find a source** to search URLs and captured table names without changing their order. **Show** narrows the queue to sources needing attention or selection, prepared sources with pending or approved records, or queued sources. **Clear filters** restores the full list. Filters affect only queue visibility: the active editor stays open, batch fetching still processes all queued sources, and compatible exports still include all eligible approved records. The totals always summarize the full workspace. Search and filters are temporary view preferences and are not saved into snapshots.

## Recognizing table choices

Both the workspace and Interpretation Lab include column counts and headings in table choices. Long heading lists are shortened in the menu; the selected preview retains the full captured headings. Workspace samples label source row positions and distinguish selected columns from the full source width. Separate choices can be separate tables, row batches or column groups, rather than revisions. Selection order and review approvals are unchanged.

## Paragraph review context

The selected evidence can include a collapsed **Surrounding text** excerpt with up to 350 characters before and after the exact quotation. When a full retained page has validated original offsets, the excerpt uses those offsets; otherwise it uses the current source snapshot. The highlighted quote remains the evidence. Nearby text is a review aid, not an inferred subject, date, additional claim or approval. Context is rebuilt from the retained source on reopening and does not change exported evidence or parser versions. It cannot recover text never captured from the page.
