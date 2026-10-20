# Element Extractor

Standalone Cloudflare Worker: Wikipedia chemical elements → validated table, JSON and CSV. No FantasyBrief code, paid bindings, AI, browser services, or database is used.

## Develop and test

Requires Node 22 or later, npm, and curl. From this directory:

```sh
npm ci
npm test
npm run check
npm run test:live
npm run dev
```

`npm test` executes the actual Worker source using Miniflare/workerd, including native HTMLRewriter and Cache API. Its synthetic 118-row structural fixture is not a copy of Wikipedia and does not establish that Wikipedia's current layout works. Tests cover successful extraction, cached JSON and CSV, routes, upstream failures, redirects, content types, changed columns and fail-closed handling of omitted closing tags.

## Deploy on Cloudflare Workers Free

`src/worker.js` is the canonical ES module. `worker-code.txt` is an identical editor-paste copy. Paste the whole file into the Cloudflare Worker editor using module syntax, or use `npm run deploy` with your own authenticated Wrangler. The configured Worker name is `genericscrapertoolkit`. No command here changes your Cloudflare subscription or creates paid services. Confirm the account remains on Workers Free in your dashboard.

After deployment, request `/api/elements`: expect status 200, `count: 118`, atomic numbers 1–118, Hydrogen/H through Oganesson/Og. Download `/elements.csv`: expect a header and 118 data rows. Open `/`, load the dataset, search for Hydrogen, and download JSON. Test a second API request and confirm `retrieved_at` stays the same while cached (up to 24 hours per location). A 502 contains the extraction or upstream error; an error is never cached.

## Fixes from the supplied source

- Removed named exports of constants. Workers treats module exports as entrypoints; exporting a string or array prevents startup. Keep the default fetch handler export.
- Replaced unsupported `redirect: 'error'` with `redirect: 'manual'`. The existing non-OK status check rejects redirects without following them.
- Clear the active cell when starting a row to prevent previous-cell state leaking into a new row.

The extractor deliberately rejects unexpected schemas rather than returning guessed data. It expects the source table header `Z`, `Sym.`, `Element` and 16 columns. Live Wikipedia extraction was verified in workerd: 118 elements from Hydrogen through Oganesson, with 119 CSV lines. `npm run dev` starts a local workerd server on port 8787 and uses a curl bridge for outbound requests to honor this cloud environment’s proxy and CA trust. Deployment still uses native Workers fetch; no bridge is bundled. `npm run dev:wrangler` is available for ordinary machines. The deployed Worker currently returns HTTP 502 from its old unsupported redirect setting; it needs the corrected source deployed. No Cloudflare deployment credentials are currently configured.
