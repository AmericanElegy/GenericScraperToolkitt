const SOURCE = 'https://en.wikipedia.org/wiki/List_of_chemical_elements';
const FIELDS = ['atomic_number', 'symbol', 'name', 'group', 'period'];

function clean(value) {
  return value.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeRows(rows) {
  const elements = rows.filter(c => /^\d+$/.test(clean(c[0] || ''))).map(c => {
    if (c.length !== 16) throw new Error('Source table columns changed; extraction stopped.');
    const group = clean(c[4]);
    return {atomic_number: Number(clean(c[0])), symbol: clean(c[1]), name: clean(c[2]),
      group: /^\d+$/.test(group) ? Number(group) : null, period: Number(clean(c[5]))};
  });
  elements.sort((a, b) => a.atomic_number - b.atomic_number);
  if (elements.length !== 118) throw new Error('Expected 118 elements; extraction stopped.');
  const symbols = new Set();
  const names = new Set();
  elements.forEach((e, i) => {
    if (e.atomic_number !== i + 1 || !/^[A-Z][a-z]?$/.test(e.symbol) ||
      !/^[A-Za-z]+$/.test(e.name) || symbols.has(e.symbol) || names.has(e.name) ||
      !Number.isInteger(e.period) || e.period < 1 || e.period > 7 ||
      (e.group !== null && (e.group < 1 || e.group > 18))) {
      throw new Error('Element identity or range validation failed; extraction stopped.');
    }
    symbols.add(e.symbol); names.add(e.name);
  });
  if (elements[0].symbol !== 'H' || elements[117].symbol !== 'Og') {
    throw new Error('Source identity validation failed.');
  }
  return elements;
}

function toCSV(elements) {
  const quote = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [FIELDS.join(','), ...elements.map(e => FIELDS.map(k => quote(e[k])).join(','))].join('\r\n') + '\r\n';
}

async function extract(response) {
  const tables = [];
  let table, row, cell;
  const rewriter = new HTMLRewriter()
    .on('table.wikitable', {element(el) {
      table = []; tables.push(table);
      el.onEndTag(() => {table = undefined;});
    }})
    .on('table.wikitable tr', {element(el) {
      if (!table) return;
      cell = undefined; row = []; table.push(row);
      el.onEndTag(() => {row = undefined;});
    }})
    .on('table.wikitable tr > td, table.wikitable tr > th', {
      element(el) {
        if (!row) return;
        const current = {text: ''}; cell = current; row.push(current);
        el.onEndTag(() => {if (cell === current) cell = undefined;});
      },
      text(chunk) {if (cell) cell.text += chunk.text;}
    });
  await rewriter.transform(response).text();
  for (const candidate of tables) {
    const rows = candidate.map(r => r.map(c => c.text));
    const header = rows.find(r => clean(r[0] || '') === 'Z' && clean(r[1] || '') === 'Sym.');
    if (header && clean(header[2]) === 'Element') return normalizeRows(rows);
  }
  throw new Error('Chemical elements table not found; source layout may have changed.');
}

const SECURITY = {'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {...SECURITY, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', {status:405, headers:{Allow:'GET'}});
    if (url.pathname === '/') return new Response(PAGE, {headers:{...SECURITY, 'Content-Type':'text/html; charset=utf-8'}});
    if (!['/api/elements', '/elements.csv'].includes(url.pathname)) return json({error:'Not found'},404);
    try {
      const key = new Request(new URL('/_cache/elements-v1', url.origin));
      let cached = await caches.default.match(key);
      let data;
      if (cached) data = await cached.json();
      else {
        const upstream = await fetch(SOURCE, {headers:{'User-Agent':`ElementExtractorDemo/0.1 (${url.origin})`, Accept:'text/html'}, redirect:'manual', signal:AbortSignal.timeout(15000)});
        if (!upstream.ok) throw new Error(`Wikipedia returned HTTP ${upstream.status}. No automatic retry was made.`);
        if (!(upstream.headers.get('content-type') || '').includes('text/html')) throw new Error('Unexpected source content type.');
        const elements = await extract(upstream);
        data = {source:SOURCE, retrieved_at:new Date().toISOString(), count:elements.length, elements,
          attribution:'Wikipedia contributors, List of chemical elements; CC BY-SA 4.0', license:'https://creativecommons.org/licenses/by-sa/4.0/'};
        ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json', 'Cache-Control':'public, max-age=86400'}})));
      }
      if (url.pathname === '/elements.csv') return new Response(toCSV(data.elements), {headers:{...SECURITY,
        'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="chemical-elements.csv"',
        'X-Source-URL':SOURCE, 'X-Retrieved-At':data.retrieved_at, 'Cache-Control':'no-store'}});
      return json(data);
    } catch (error) {return json({error:error.message || 'Extraction failed. Try again later.'},502);}
  }
};

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Element Extractor</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17283c;font:16px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:48px 22px}h1{font-size:clamp(32px,6vw,52px);margin:12px 0}p{line-height:1.6}.tag{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#47607a}.bar{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}input{flex:1;min-width:180px;padding:13px;border:1px solid #8596a8;border-radius:8px;font:inherit}button,.button{padding:13px 18px;border:0;border-radius:8px;background:#173b59;color:white;font:inherit;cursor:pointer;text-decoration:none}button:disabled{opacity:.6}a{color:#18568b}#status{min-height:26px}#wrap{overflow:auto;background:white;border:1px solid #d7dfe6;border-radius:12px}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:13px 18px;border-bottom:1px solid #e7edf2;white-space:nowrap}th{background:#e8eff5}td:nth-child(2){font-weight:700;color:#126563}footer{font-size:13px;margin-top:24px;color:#47607a}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #bc6b10;outline-offset:3px}[hidden]{display:none!important}</style>
<main><span class="tag">Web data → validated dataset</span><h1>Element Extractor</h1><p>A small extraction demo: one Wikipedia table, 118 validated elements, ready to explore and export.</p>
<button id="load">Load elements</button><p id="status" role="status" aria-live="polite">Load the dataset to begin.</p>
<section id="results" hidden><div class="bar"><input id="search" type="search" aria-label="Search by name, symbol or atomic number" placeholder="Search name, symbol or atomic number"><a class="button" href="/elements.csv">Download CSV</a><button id="download">Download JSON</button></div><p id="count"></p><div id="wrap"><table><caption class="tag">Chemical elements</caption><thead><tr><th scope="col">Atomic no.</th><th scope="col">Symbol</th><th scope="col">Element</th><th scope="col">Group</th><th scope="col">Period</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<footer>Source: <a href="https://en.wikipedia.org/wiki/List_of_chemical_elements">Wikipedia contributors — List of chemical elements</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Columns selected and formatting normalized. Missing group values stay blank in exports.<br>Validated responses are cached for up to 24 hours per Cloudflare location. No AI or browser service is used.</footer></main>
<script>let dataset;const $=id=>document.getElementById(id);function render(){const q=$('search').value.trim().toLowerCase();const items=dataset.elements.filter(e=>[e.name,e.symbol,e.atomic_number].some(v=>String(v).toLowerCase().includes(q)));$('rows').replaceChildren(...items.map(e=>{const tr=document.createElement('tr');for(const k of ['atomic_number','symbol','name','group','period']){const td=document.createElement('td');td.textContent=e[k]??'—';tr.append(td)}return tr}));$('count').textContent=items.length+' of '+dataset.count+' elements'}$('load').onclick=async()=>{$('load').disabled=true;$('status').textContent='Fetching and validating…';try{const r=await fetch('/api/elements');const d=await r.json();if(!r.ok)throw Error(d.error);dataset=d;render();$('results').hidden=false;$('status').textContent='Validated '+d.count+' elements · Source retrieved '+new Date(d.retrieved_at).toLocaleString();$('load').textContent='Reload dataset'}catch(e){$('status').textContent=e.message}finally{$('load').disabled=false}};$('search').oninput=()=>{if(dataset)render()};$('download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(dataset,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='chemical-elements.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};</script></html>`;
