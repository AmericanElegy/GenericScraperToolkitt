# Signed-in market capture

The ordinary URL fetcher has its own unauthenticated session. A successful HTTPS request can therefore return a sign-in or verification page rather than the market. This is a retrieval/access limitation, not evidence that the signed-in page contains no data. Do not copy login cookies or tokens into the toolkit.

Open `/market-capture` on the local or private hosted toolkit. Drag **Capture Urban Rivals market** to the bookmarks bar. Open the signed-in Urban Rivals market and click that bookmark to display a local capture panel. Nothing is uploaded, purchased, sold, refreshed or fetched by the helper.

1. Click **Capture loaded offers** on the main results page.
2. Manually open **View all** for a card. After the listings load, capture again. If offer pagination exists, capture every required page.
3. Close the overlay and repeat for the other cards on this main page. The helper never clicks market controls itself.
4. Download **offers CSV**, **card coverage CSV**, and **evidence JSON** before reloading. Reloading loses the in-memory session. A changed search or main-page selection requires a separate capture session.

The helper reads listing tables, card IDs/names, sale IDs, quantities, prices in Clintz, level, edition labels/markup, power, damage, ability, seller display name and relative time remaining. It does not read account balances, messages, cookies or browser storage. Unknown layouts retain raw cell text in JSON issues; numbers are not guessed. Browser/site restrictions may block bookmarklets: do not disable security protections to make one work.

The live pilot captured a fresh main-page view of ten cards: 926 unique listing IDs and 2,452 units. Every observed per-card listing count matched its advertised count. This was a separate view from the earlier screenshot, whose ten card groups advertised 1,020 offers and initially loaded 200 preview rows. The two views were not merged. Private captures, raw observations and CSV/JSON exports remain under ignored `.wrangler/market/`, outside the release. No API calls, transactions or paid services were used.

Distinct sale IDs remain distinct even when every visible value is the same. Repeated observations of one sale count once in the combined CSV; evidence JSON retains every observation and changes. Offer quantity and listing count are different metrics. Observed quantities are not current inventory or completed sales. Empty edition text does not establish an edition; inspect the retained labels/markup and original. Relative countdowns are observations, not exact expiration timestamps.

Advertised totals, observed unique listings and their differences are reported separately. Count agreement alone does not prove completeness. Listings can be added or removed during a capture, and a filtered overlay can differ from the main preview. Reports describe a capture interval, not an atomic market snapshot. They cover one selected main page, not every marketplace page. Limits are 50 observations / 10,000 observed rows; reaching a limit stops capture without deleting the previous observations.

CSV is unreviewed captured data. Import it into the workbench for mapping, evidence and approval if needed. Its wide columns may create separate column groups; do not infer joins from display names. Preserve the evidence JSON and original page context with the delivery.

`npm.cmd run check:market-browser` uses a fresh browser with intercepted synthetic responses. It verifies the actual generated bookmarklet, distinct/repeated sale IDs, coverage counts, loading and changed-search guards, formula-safe CSV, JSON downloads, no purchases, no helper network requests and exclusion of account UI. It does not log in or contact Urban Rivals. The full release gate includes this check.
