# Signed-in market capture

The ordinary URL fetcher has its own unauthenticated session. A successful HTTPS request can therefore return a sign-in or verification page rather than the market. This is a retrieval/access limitation, not evidence that the signed-in page contains no data. Do not copy login cookies or tokens into the toolkit.

Open `/market-capture` on the local or private hosted toolkit. Drag **Capture Urban Rivals market** to the bookmarks bar. Open the signed-in Urban Rivals market and click that bookmark to display a local capture panel. Capturing reads the page locally. **Review in workbench** explicitly opens your toolkit and transfers the captured listing data to its normal review flow. No purchases, sales or automated market pagination occur.

1. Click **Capture loaded offers** on the main results page.
2. Manually open **View all** for a card. After the listings load, capture again. If offer pagination exists, capture every required page.
3. Close the overlay and repeat for the other cards on this main page. The helper never clicks market controls itself.
4. Click **Review in workbench**. A fresh toolkit tab receives the capture after Cloudflare sign-in if needed. Review the six core columns (sale ID, card, quantity, Clintz price, level, seller), switch batches, and download approved rows using the existing whole-table controls. Sale IDs are text; rows are never autoapproved.
5. Save source and all reviews, or download captured source to preserve all fields, raw observations and coverage. The helper’s evidence JSON can also be opened through Add source as a fallback. Reloading the market loses its in-memory capture. A changed search or main-page selection requires a separate capture session.

Replace previously installed capture bookmarks with the updated link on `/market-capture` to get the direct-review button. No extension is required. Browser popup restrictions or isolation may prevent handoff; keep the evidence JSON fallback. The handoff validates both window identity and exact origins, uses a one-use random token, and never overwrites an existing review. No capture data is placed in the URL or browser storage.

The helper reads listing tables, card IDs/names, sale IDs, quantities, prices in Clintz, level, edition labels/markup, power, damage, ability, seller display name and relative time remaining. It does not read account balances, messages, cookies or browser storage. Unknown layouts retain raw cell text in JSON issues; numbers are not guessed. Browser/site restrictions may block bookmarklets: do not disable security protections to make one work.

The live pilot captured a fresh main-page view of ten cards: 926 unique listing IDs and 2,452 units. Every observed per-card listing count matched its advertised count. This was a separate view from the earlier screenshot, whose ten card groups advertised 1,020 offers and initially loaded 200 preview rows. The two views were not merged. Private captures, raw observations and CSV/JSON exports remain under ignored `.wrangler/market/`, outside the release. No API calls, transactions or paid services were used.

Distinct sale IDs remain distinct even when every visible value is the same. Repeated observations of one sale count once in the combined CSV; evidence JSON retains every observation and changes. Offer quantity and listing count are different metrics. Observed quantities are not current inventory or completed sales. Empty edition text does not establish an edition; inspect the retained labels/markup and original. Relative countdowns are observations, not exact expiration timestamps.

Advertised totals, observed unique listings and their differences are reported separately. Count agreement alone does not prove completeness. Listings can be added or removed during a capture, and a filtered overlay can differ from the main preview. Reports describe a capture interval, not an atomic market snapshot. They cover one selected main page, not every marketplace page. Limits are 50 observations / 10,000 observed rows; reaching a limit stops capture without deleting the previous observations.

Capture JSON imports are bounded to 500,000 characters, 50 observations, 10,000 observed rows, and the existing review metadata limits. Oversized or malformed captures are rejected explicitly; the original helper session remains intact. Counts are recomputed from observations rather than trusting summary totals.

CSV is unreviewed captured data. Import it into the workbench for mapping, evidence and approval if needed. Its wide columns may create separate column groups; do not infer joins from display names. Preserve the evidence JSON and original page context with the delivery.

`npm.cmd run check:market-browser` uses a fresh browser with intercepted synthetic responses. It verifies the actual generated bookmarklet, distinct/repeated sale IDs, coverage counts, loading and changed-search guards, formula-safe CSV, JSON downloads, no purchases, no helper network requests and exclusion of account UI. It does not log in or contact Urban Rivals. The full release gate includes this check.

The browser check also exercises a real cross-origin popup handoff into the built Worker, text IDs, zero approvals, visible coverage, retained evidence, unrelated-message rejection and the evidence-JSON fallback.
