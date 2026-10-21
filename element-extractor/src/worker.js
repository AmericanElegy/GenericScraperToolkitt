import { decodeHTML } from 'entities';

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

// Stage 1 bounds: reject oversized or ambiguous data instead of silently truncating it.
const LIMITS = {bytes: 2 * 1024 * 1024, tables: 20, rows: 5000, columns: 100, cells: 50000, text: 10000};
class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function publicURL(input) {
  if (!input || input.length > 2048) throw new InputError('Enter a public HTTPS URL (up to 2048 characters).');
  let url;
  try { url = new URL(input); } catch { throw new InputError('Enter a valid public HTTPS URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      host.length > 253 || host.endsWith('.') || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) ||
      host.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      /^[0-9.]+$/.test(host) || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host)) {
    throw new InputError('Use a public HTTPS hostname without credentials, IP addresses, or custom ports.');
  }
  url.hash = '';
  return url;
}
function publicAddress(ip) {
  if (ip.includes(':')) {
    // Conservative global-unicast policy: also exclude transition and special-use ranges.
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^200[12]:|^3fff:/i.test(ip);
  }
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
async function checkPublicDNS(hostname, signal) {
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname); url.searchParams.set('type', type);
    const r = await fetch(url, {headers: {Accept: 'application/dns-json'}, redirect: 'manual', signal});
    if (!r.ok) throw new InputError('Public DNS verification is unavailable. Try again later.', 502);
    const body = await r.json();
    if (body.Status !== 0) throw new InputError('The source hostname could not be resolved publicly.');
    return (body.Answer || []).filter(a => a.type === 1 || a.type === 28).map(a => a.data);
  }));
  const addresses = answers.flat();
  if (!addresses.length || addresses.some(ip => !publicAddress(ip))) throw new InputError('Private, reserved, and unresolved network destinations are not supported.');
}
async function readBounded(response) {
  if (Number(response.headers.get('content-length')) > LIMITS.bytes) { await response.body?.cancel(); throw new InputError('Page exceeds the 2 MiB size limit.', 422); }
  if (!response.body) throw new InputError('The source returned an empty page.', 422);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMITS.bytes) { await reader.cancel(); throw new InputError('Page exceeds the 2 MiB size limit.', 422); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, {type: 'text/html'});
}
async function fetchPublicPage(input, ownHost) {
  let url = publicURL(input);
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.hostname === ownHost) throw new InputError('Choose a source page outside this toolkit.');
    await checkPublicDNS(url.hostname, signal);
    const r = await fetch(url.href, {redirect: 'manual', signal, headers: {Accept: 'text/html', 'User-Agent': 'GenericScraperToolkit/1.0 (public HTML tables)'}});
    if ([301,302,303,307,308].includes(r.status)) {
      const location = r.headers.get('location'); await r.body?.cancel();
      if (!location || redirects === 3) throw new InputError('Source redirected too many times or omitted its destination.', 422);
      url = publicURL(new URL(location, url).href); continue;
    }
    if (!r.ok) { await r.body?.cancel(); throw new InputError(`Source returned HTTP ${r.status}. Login-protected or blocked pages are not supported.`, 422); }
    if (/^image\//i.test(r.headers.get('content-type') || '')) {await r.body?.cancel(); throw new InputError('This URL returns an image. Reading image-based data requires OCR, which is not enabled. Use an HTML source or an official text/CSV export.',422);}
    if (!/^text\/html(?:;|$)/i.test(r.headers.get('content-type') || '')) { await r.body?.cancel(); throw new InputError('The source must return an HTML webpage.', 422); }
    const charset = (r.headers.get('content-type') || '').match(/charset\s*=\s*[\"']?([^;\s\"']+)/i)?.[1];
    if (charset && !/^(utf-?8|us-ascii)$/i.test(charset)) {await r.body?.cancel(); throw new InputError('This first version supports UTF-8 HTML pages only.',422);}
    return {source: url.href, page: await readBounded(r)};
  }
}
async function discoverTables(page, accessible = false) {
  const rootSelector = accessible ? '[role="table"], [role="grid"]' : 'table';
  const rowSelector = accessible ? '[role="row"]' : 'tr';
  const cellSelector = accessible ? '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]' : 'td, th';
  const tables = [], stack = []; let totalRows = 0, totalCells = 0, ignored = 0;
  const current = () => stack[stack.length - 1];
  const rewrite = new HTMLRewriter()
    .on(rootSelector, {element(el) {
      if (accessible && el.tagName === 'table') {if (current()) current().unsupported = 'Nested tables are not supported yet.'; return;}
      if (tables.length >= LIMITS.tables) throw new InputError('Page exceeds the limit of 20 tables.', 422);
      const parent = current(); if (parent) parent.unsupported = 'Nested tables are not supported yet.';
      const table = {rows: [], caption: accessible ? (el.getAttribute('aria-label') || '') : '', unsupported: parent ? 'Nested tables are not supported yet.' : null};
      tables.push(table); stack.push(table);
      el.onEndTag(() => { if (current() === table) stack.pop(); });
    }})
    .on(rowSelector, {element(el) {
      const table = current(); if (!table) return;
      if (++totalRows > LIMITS.rows) throw new InputError('Page exceeds the limit of 5000 total rows.', 422);
      const row = []; table.rows.push(row); table.row = row; table.cell = undefined;
      el.onEndTag(() => { if (table.row === row) {table.row = undefined; table.cell = undefined;} });
    }})
    .on(cellSelector, {element(el) {
      const table = current(); if (!table?.row) return;
      if (table.row.length >= LIMITS.columns || ++totalCells > LIMITS.cells) throw new InputError('Page exceeds the cell or column limit.', 422);
      if (['rowspan','colspan','aria-rowspan','aria-colspan'].some(k => el.hasAttribute(k) && el.getAttribute(k) !== '1')) table.unsupported = 'Merged cells are not supported yet.';
      const cell = {text: '', header: accessible ? el.getAttribute('role') === 'columnheader' : el.tagName === 'th'}; table.row.push(cell); table.cell = cell;
      el.onEndTag(() => {if (table.cell === cell) table.cell = undefined;});
    }})
    .on('caption', {element(el) {const table = current(); if (!table) return; table.inCaption = true; el.onEndTag(() => {table.inCaption = false;});}})
    .on('script, style, template', {element(el) {ignored++; el.onEndTag(() => {ignored--;});}})
    .on('br', {element() {const t = current(); if (t?.cell) t.cell.text += ' ';}})
    .onDocument({text(chunk) {
      const table = current(); if (!table || ignored) return;
      if (table.inCaption) {table.caption += chunk.text; if (table.caption.length > LIMITS.text) throw new InputError('Table caption is too long.', 422);}
      else if (table.cell) {table.cell.text += chunk.text; if (table.cell.text.length > LIMITS.text) throw new InputError('A table cell exceeds the text limit.', 422);}
    }});
  await rewrite.transform(new Response(page)).arrayBuffer();
  return tables.filter(t => t.rows.some(r => r.length)).map((t, id) => {
    const rows = t.rows.filter(r => r.length), width = Math.max(...rows.map(r => r.length));
    const heading = rows[0]?.every(c => c.header);
    if (rows.slice(heading ? 1 : 0).some(r => r.some(c => c.header) && r.every(c => c.header))) t.unsupported ||= 'Multiple header rows are not supported yet.';
    if (rows.some(r => r.length !== width)) t.unsupported ||= 'Rows have inconsistent column counts.';
    const normalize = text => decodeHTML(text).replace(/\s+/g, ' ').trim();
    return {id, title: normalize(t.caption) || `${accessible ? 'Accessible table' : 'Table'} ${id + 1}`, headers: heading ? rows[0].map(c => normalize(c.text)) : Array.from({length: width}, (_,i) => `Column ${i + 1}`),
      rows: rows.slice(heading ? 1 : 0).map(r => r.map(c => normalize(c.text))), unsupported: t.unsupported, extraction_method: accessible ? 'aria-grid' : 'html-table'};
  });
}
// DCI publishes its score grid as divs, not a semantic HTML table.
// Scope this adapter to DCI final-score pages and their explicit grid classes.
async function discoverDCIScores(page) {
  const sections = []; let section, row, field;
  const normalize = text => decodeHTML(text).replace(/\s+/g, ' ').trim();
  const capture = (selector, key, destination) => ({selector, handler:{
    element(el) {
      const target = destination(); if (!target) return;
      if (key === 'title' && target.title) throw new InputError('Multiple DCI divisions in one grid are not supported yet.',422);
      const current = {target, key, text:''}; field = current;
      el.onEndTag(() => {target[key] = normalize(current.text); if (field === current) field = undefined;});
    },
    text(chunk) {if (field?.key === key) {field.text += chunk.text; if (field.text.length > LIMITS.text) throw new InputError('A score field exceeds the text limit.',422);}}
  }});
  let rewriter = new HTMLRewriter()
    .on('.score-tbl.finalscores', {element(el) {
      if (sections.length >= LIMITS.tables) throw new InputError('Page exceeds the table limit.',422);
      const current = {title:'', headers:{}, rows:[]}; sections.push(current); section=current;
      el.onEndTag(() => {if(section===current) {section=undefined; row=undefined; field=undefined;}});
    }})
    .on('.score-tbl.finalscores .tbl-row:not(.poweredby-row)', {element(el) {
      if(!section)return;
      if (sections.reduce((n,s)=>n+s.rows.length,0) >= LIMITS.rows) throw new InputError('Page exceeds the row limit.',422);
      const current={};section.rows.push(current);row=current;
      el.onEndTag(()=>{if(row===current)row=undefined;});
    }});
  for (const [selector,key,destination] of [
    ['.score-tbl.finalscores .score-division-name','title',()=>section],
    ...[['.col-2','place'],['.col-7','corps'],['.col-3','score']].flatMap(([column,key])=>[
      ['.score-tbl.finalscores .filter-cards .row > '+column+' > span',key,()=>section?.headers],
      ['.score-tbl.finalscores .tbl-row:not(.poweredby-row) .row > '+column+' > span',key,()=>row]
    ])
  ]) {const {handler}=capture(selector,key,destination);rewriter=rewriter.on(selector,handler);}
  await rewriter.transform(new Response(page)).arrayBuffer();
  return sections.filter(s=>s.rows.length).map((s,id)=>{
    if(s.headers.place!=='Place'||s.headers.corps!=='Corps'||s.headers.score!=='Score') throw new InputError('DCI score headings changed; extraction stopped.',422);
    const rows=s.rows.map(r=>[r.place,r.corps,r.score]);
    if(rows.some(([place,corps,score])=>!/^\d+$/.test(place||'')||!corps||!/^\d{1,3}\.\d{3}$/.test(score||'')||Number(score)>100)) throw new InputError('DCI score layout or values changed; extraction stopped.',422);
    return {id,title:s.title||'DCI final scores',headers:['Place','Corps','Score'],rows,unsupported:null,extraction_method:'dci-final-scores'};
  });
}

async function inspectPage(page) {
  const signals = {html_tables:0, accessible_grids:0, json_blocks:0, linked_scripts:0, app_roots:0, password_fields:0, layout_hints:0, images:0, canvases:0, title:''};
  let title = false;
  await new HTMLRewriter()
    .on('table', {element(){signals.html_tables++;}})
    .on('[role="table"], [role="grid"]', {element(el){if(el.tagName!=='table')signals.accessible_grids++;}})
    .on('script', {element(el){
      const type=(el.getAttribute('type')||'').toLowerCase();
      if(['application/json','application/ld+json'].includes(type))signals.json_blocks++;
      if(el.hasAttribute('src'))signals.linked_scripts++;
    }})
    .on('#root, #app, #__next, #__nuxt', {element(){signals.app_roots++;}})
    .on('img', {element(){signals.images++;}})
    .on('canvas', {element(){signals.canvases++;}})
    .on('input[type="password"]', {element(){signals.password_fields++;}})
    .on('[class]', {element(el){if(/(?:^|[\s_-])(table|tbl|score|grid|row)(?:$|[\s_-])/i.test(el.getAttribute('class')||''))signals.layout_hints++;}})
    .on('title', {element(el){title=true;el.onEndTag(()=>{title=false;});},text(chunk){if(title&&signals.title.length<300)signals.title+=chunk.text.slice(0,300-signals.title.length);}})
    .transform(new Response(page)).arrayBuffer();
  signals.title=decodeHTML(signals.title).replace(/\s+/g,' ').trim();
  return signals;
}
function noDataReason(signals) {
  if (/access denied|just a moment|verify (you are|you're) human|attention required|sign in|log in/i.test(signals.title) || signals.password_fields) return {
    code:'possible_access_barrier',
    message:'The returned page contains a sign-in or verification indicator, and no supported data structure was found.',
    next_action:'Check the URL in your browser. Use a public source or an authorized export; this toolkit does not sign in or bypass verification.'
  };
  if(signals.json_blocks)return {
    code:'embedded_data_detected',message:`Found ${signals.json_blocks} embedded JSON blocks but no supported table. These blocks may contain page metadata rather than the requested rows.`,
    next_action:'The next extraction option is a validated embedded-data adapter or a documented public API. No script was executed and no JSON was guessed into rows.'
  };
  if(signals.app_roots&&signals.linked_scripts)return {
    code:'possible_client_rendering',message:'Found an application container and linked scripts, but no supported rows in the returned HTML. The data may load after JavaScript runs; this is an indication, not a confirmed diagnosis.',
    next_action:'Look for an official export or public data endpoint. Browser rendering is not enabled, and the toolkit did not execute these scripts.'
  };
  if(signals.layout_hints)return {
    code:'unsupported_page_layout',message:'Found table-like layout class names, but no HTML table, accessible grid, or matching supported adapter. Class names alone do not establish which values belong together.',
    next_action:'This page needs a validated layout adapter or explicit row/column selection. The toolkit stopped rather than guessing a dataset.'
  };
  if(signals.images||signals.canvases)return {code:'visual_content_present',message:`Found ${signals.images} images and ${signals.canvases} canvas elements, but no supported dataset. Their presence does not prove the requested data is in a picture. Image contents were not read.`,next_action:'If the data is shown only as an image, OCR plus row/column verification is needed. OCR is not enabled. Prefer an official text or CSV export when available.'};
  return {code:'no_supported_structure',message:'The page downloaded successfully, but no supported row-and-column structure was found. There is not enough evidence to say JavaScript or login is the cause.',next_action:'Check that this is the actual data page. Try a direct public table, an official export, or provide the page for a new adapter.'};
}
async function analyzePage(page, source, checks) {
  const signals=await inspectPage(page);
  let tables=await discoverTables(page);
  const summarize=(label,items)=>({step:label,status:items.length?'found':'not_found',message:items.length?`${items.length} structures found; ${items.filter(t=>!t.unsupported).length} usable for preview and export.`:'No matching structures found in the returned HTML.'});
  checks.push(summarize('HTML tables',tables));
  const accessible=await discoverTables(page,true);
  checks.push(summarize('Accessible tables and grids',accessible));tables.push(...accessible);
  const u=new URL(source);
  if(['www.dci.org','dci.org'].includes(u.hostname)&&u.pathname.startsWith('/scores/final-scores/')) {
    const scores=await discoverDCIScores(page);checks.push(summarize('DCI final-score adapter',scores));tables.push(...scores);
  } else checks.push({step:'Supported site adapters',status:'not_applicable',message:'No site-specific adapter matches this URL.'});
  const cells=tables.reduce((n,t)=>n+t.rows.length*t.headers.length,0);
  if(tables.length>LIMITS.tables||tables.reduce((n,t)=>n+t.rows.length,0)>LIMITS.rows||cells>LIMITS.cells)throw new InputError('Combined extraction exceeds the table, row or cell limit.',422);
  checks.push({step:'Embedded data',status:signals.json_blocks?'found':'not_found',message:`${signals.json_blocks} JSON blocks found. They may contain metadata rather than table rows; no dataset was inferred from them.`});
  checks.push({step:'JavaScript indicators',status:signals.app_roots&&signals.linked_scripts?'indicated':'checked',message:`${signals.linked_scripts} linked scripts and ${signals.app_roots} application containers found. Scripts were not executed; these clues do not confirm where data loads.`});
  checks.push({step:'Images and canvas',status:signals.images||signals.canvases?'found':'not_found',message:`${signals.images} images and ${signals.canvases} canvas elements found. Their contents were not read; OCR is not enabled.`});
  if(!tables.length)return {tables,signals,...noDataReason(signals)};
  const usable=tables.filter(t=>!t.unsupported).length;
  return {tables:tables.map((t,id)=>({...t,id})),signals,code:usable?'extracted':'unsupported_table_structure',message:usable?`${usable} usable datasets found.`:'Tables were found, but their structures are not supported yet.',next_action:usable?'Choose a dataset to preview and export.': 'Choose a table to see its specific issue, such as merged cells, nested tables or inconsistent columns.'};
}

async function tablesAPI(request, url) {
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405, headers:{...SECURITY, Allow:'POST'}});
  // Do not provide a cross-origin scraping proxy; no CORS headers are emitted.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({error:'Cross-origin extraction is not supported.'},403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({error:'Send a JSON request.'},415);
  const checks = []; let phase = 'Request validation';
  try {
    if (Number(request.headers.get('content-length')) > 4096) throw new InputError('Request is too large.',413);
    const reader = request.body?.getReader(); const chunks = []; let bytes = 0;
    if (reader) {try {while (true) {const {value, done} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) {await reader.cancel(); throw new InputError('Request is too large.',413);} chunks.push(value);}} finally {reader.releaseLock();}}
    const text = await new Blob(chunks).text();
    let body; try {body = JSON.parse(text);} catch {throw new InputError('Invalid JSON request.');}
    if (!body || typeof body.url !== 'string') throw new InputError('Provide a public HTTPS URL.');
    checks.push({step:'Request validation',status:'passed',message:'A bounded JSON request with a URL was received.'});
    phase='Public page request';
    const {source, page} = await fetchPublicPage(body.url, url.hostname);
    checks.push({step:phase,status:'passed',message:'Public HTTPS and DNS checks passed for the request and redirects. HTML downloaded within the size and time limits.'});
    phase='Structure detection';
    const result=await analyzePage(page,source,checks);
    const diagnostics={code:result.code,summary:result.message,next_action:result.next_action,checks,signals:result.signals};
    if(!result.tables.length)return json({error:result.message,source,diagnostics},422);
    return json({source,retrieved_at:new Date().toISOString(),tables:result.tables,diagnostics});
  } catch (error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The source exceeded the 15-second request limit.' : error.message || 'Table extraction failed.';
    checks.push({step:phase,status:'failed',message});
    return json({error:message,diagnostics:{code:'extraction_stopped',summary:message,next_action:phase==='Request validation'?'Correct the request and try again.':'Resolve the failed check before retrying. A later extraction strategy cannot bypass an access or request-limit failure.',checks}},error.status||502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tables') return tablesAPI(request, url);
    if (request.method !== 'GET') return new Response('Method not allowed', {status:405, headers:{Allow:'GET'}});
    if (url.pathname === '/example') return new Response(PAGE, {headers:{...SECURITY, 'Content-Type':'text/html; charset=utf-8'}});
    if (url.pathname === '/') return new Response(TABLE_PAGE, {headers:{...SECURITY, 'Content-Type':'text/html; charset=utf-8'}});
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

const TABLE_PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web Table Toolkit</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17283c;font:16px system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:40px 22px}h1{font-size:clamp(30px,5vw,48px);margin:12px 0}p{line-height:1.6}a{color:#18568b}.bar{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}input,select{padding:12px;border:1px solid #8596a8;border-radius:8px;font:inherit;max-width:100%}input{flex:1;min-width:200px}button,.button{padding:12px 18px;border:0;border-radius:8px;background:#173b59;color:white;font:inherit;cursor:pointer;text-decoration:none}button:disabled{opacity:.5;cursor:wait}label{display:block;font-weight:600;margin:12px 0 6px}.hint,footer{font-size:14px;color:#47607a}#status{min-height:28px}#wrap{overflow:auto;background:white;border:1px solid #d7dfe6;border-radius:10px;max-height:65vh}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:12px 16px;border-bottom:1px solid #e7edf2;max-width:420px;overflow-wrap:anywhere;min-width:100px}th{background:#e8eff5;position:sticky;top:0}footer{margin-top:28px}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #bc6b10;outline-offset:3px}[hidden]{display:none!important}</style></head>
<body><main><h1>Web Table Toolkit</h1><p>Turn tables on public webpages into searchable data. Preview a table, then download CSV or JSON.</p>
<form id="extract"><label for="url">Public webpage URL</label><div class="bar"><input id="url" type="url" maxlength="2048" required placeholder="https://www.w3schools.com/html/html_tables.asp"><button id="submit" type="submit">Find tables</button></div></form>
<p class="hint">Public HTTPS pages only. HTML tables, accessible grids, or supported score grids must be present in the page source. Images require OCR, which is not enabled. Maximum 2 MiB, 20 tables, and 5,000 total rows. Complex tables are marked unsupported.</p>
<p><button id="try" type="button">Try a sample table</button> <a href="/example">Open the validated 118-element example</a></p>
<p id="status" role="status" aria-live="polite">Enter a URL to begin.</p>
<p id="next-action" class="hint"></p><details id="diagnostics" hidden><summary>What was checked?</summary><ol id="checks"></ol></details>
<section id="results" hidden><label for="tables">Choose a table</label><select id="tables"></select><p id="source" class="hint"></p><p id="notice" role="status"></p><p id="method" class="hint"></p>
<div class="bar"><input id="search" type="search" aria-label="Search table rows" placeholder="Search table rows"><button id="csv" type="button">Download CSV</button><button id="json" type="button">Download JSON</button></div>
<p id="count"></p><p class="hint">Exports include all rows in the selected table. Search filters the preview only.</p><div id="wrap"><table><caption id="caption"></caption><thead id="head"></thead><tbody id="rows"></tbody></table></div></section>
<footer>Only extract sources you are authorized to use and respect their terms. Source content stays text, never executable HTML. Extraction data is not saved by this application. No AI or browser service is used.</footer></main>
<script>
const $=id=>document.getElementById(id);let dataset;
function selected(){return dataset.tables[Number($('tables').value)]}
function showDiagnostics(d){$('diagnostics').hidden=!d;$('checks').replaceChildren();$('next-action').textContent=d?.next_action||'';if(d)for(const check of d.checks||[]){const li=document.createElement('li');li.textContent=check.step+' — '+check.status.replaceAll('_',' ')+': '+check.message;$('checks').append(li)}}
function render(){
 const table=selected();const q=$('search').value.trim().toLowerCase();const rows=table.rows.filter(r=>r.some(c=>c.toLowerCase().includes(q)));
 $('method').textContent='Extraction method: '+({'html-table':'HTML table','aria-grid':'accessible table or grid','dci-final-scores':'validated DCI score layout'}[table.extraction_method]||'supported layout');
 $('notice').textContent=table.unsupported||'';for(const id of ['csv','json','search'])$(id).disabled=Boolean(table.unsupported);
 $('wrap').hidden=Boolean(table.unsupported);$('caption').textContent=table.title;
 const heading=document.createElement('tr');for(const name of table.headers){const th=document.createElement('th');th.scope='col';th.textContent=name;heading.append(th)}$('head').replaceChildren(heading);
 $('rows').replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td)}return tr}));
 $('count').textContent=table.unsupported?'Choose another table to preview or export.':rows.length+' of '+table.rows.length+' rows · '+table.headers.length+' columns';
}
$('extract').onsubmit=async event=>{
 event.preventDefault();showDiagnostics(null);$('submit').disabled=true;$('try').disabled=true;$('results').hidden=true;dataset=undefined;$('status').textContent='Fetching page and finding tables…';
 try{const r=await fetch('/api/tables',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('url').value.trim()})});const d=await r.json();showDiagnostics(d.diagnostics);$('diagnostics').open=!r.ok;if(!r.ok)throw Error(d.error||'Extraction failed.');dataset=d;
 $('tables').replaceChildren(...d.tables.map((t,i)=>{const option=document.createElement('option');option.value=i;option.textContent=t.title+' · '+t.rows.length+' rows × '+t.headers.length+' columns'+(t.unsupported?' · unsupported':'');return option}));
 const first=d.tables.findIndex(t=>!t.unsupported);$('tables').value=String(first<0?0:first);$('search').value='';
 const link=document.createElement('a');link.href=d.source;link.rel='noreferrer';link.target='_blank';link.textContent=d.source;$('source').replaceChildren('Source: ',link,' · Retrieved '+new Date(d.retrieved_at).toLocaleString());
 render();$('results').hidden=false;$('status').textContent=d.diagnostics?.summary||('Found '+d.tables.length+' tables. Choose one to preview.');
 }catch(e){$('status').textContent=e.message}finally{$('submit').disabled=false;$('try').disabled=false}
};
$('try').onclick=()=>{$('url').value='https://www.w3schools.com/html/html_tables.asp';$('extract').requestSubmit()};
$('tables').onchange=()=>{$('search').value='';render()};$('search').oninput=()=>{if(dataset)render()};
function download(text,type,extension){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download='table-'+(Number($('tables').value)+1)+extension;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('csv').onclick=()=>{const t=selected();if(t.unsupported)return;const quote=value=>{let s=String(value);if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};download([t.headers,...t.rows].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n','text/csv;charset=utf-8','.csv')};
$('json').onclick=()=>{const t=selected();if(t.unsupported)return;download(JSON.stringify({source:dataset.source,retrieved_at:dataset.retrieved_at,table:t},null,2),'application/json','.json')};
</script></body></html>`;
