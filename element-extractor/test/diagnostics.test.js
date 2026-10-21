import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
test('general detection distinguishes accessible grids, page signals, images, and request failures',async()=>{
 let html='',content='text/html',status=200;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{status,headers:{'content-type':content}})}));
 const get=async()=>{const r=await mf.dispatchFetch('https://toolkit.example.org/api/tables',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://source.example.org/'})});return {status:r.status,...await r.json()}};
 try {
  html='<div role="grid" aria-label="Inventory"><div role="row"><span role="columnheader">Name</span><span role="columnheader">Quantity</span></div><div role="row"><span role="rowheader">Nuts &amp; bolts</span><span role="gridcell">24</span></div></div>';
  let d=await get();assert.equal(d.status,200,JSON.stringify(d));assert.equal(d.tables[0].extraction_method,'aria-grid');assert.deepEqual(d.tables[0].headers,['Name','Quantity']);assert.deepEqual(d.tables[0].rows,[['Nuts & bolts','24']]);assert.equal(d.tables[0].title,'Inventory');assert.equal(d.diagnostics.code,'extracted');assert.ok(d.diagnostics.checks.some(c=>c.step==='HTML tables'&&c.status==='not_found'));
  html='<table role="grid"><tr><th>Name</th></tr><tr><td>one</td></tr></table>';d=await get();assert.equal(d.tables.length,1);assert.equal(d.tables[0].extraction_method,'html-table');
  for(const [page,code] of [
   ['<script type="application/ld+json">{"name":"Metadata only"}</script>','embedded_data_detected'],
   ['<div id="root"></div><script src="/app.js"></script>','possible_client_rendering'],
   ['<title>Sign in</title><input type="password"><script type="application/json">{}</script>','possible_access_barrier'],
   ['<div class="scores-grid"><div class="row">not enough to infer columns</div></div>','unsupported_page_layout'],
   ['<img src="scores.png" alt="Scores">','visual_content_present'],
   ['<script src="/analytics.js"></script><p>A plain article</p>','no_supported_structure']
  ]){html=page;d=await get();assert.equal(d.status,422,JSON.stringify(d));assert.equal(d.diagnostics.code,code);assert.ok(d.diagnostics.next_action);assert.ok(d.diagnostics.checks.every(c=>c.message));assert.equal(d.tables,undefined)}
  content='image/png';html='image bytes';d=await get();assert.equal(d.status,422);assert.match(d.error,/OCR.*not enabled/);assert.equal(d.diagnostics.checks.at(-1).step,'Public page request');
  content='text/html';status=403;d=await get();assert.equal(d.status,422);assert.match(d.error,/HTTP 403/);assert.ok(!d.diagnostics.checks.some(c=>c.step==='HTML tables'));
  status=200;html='<div role="table"><div role="row"><div role="cell" aria-colspan="2">Merged</div></div></div>';d=await get();assert.equal(d.status,200);assert.equal(d.diagnostics.code,'unsupported_table_structure');assert.match(d.tables[0].unsupported,/Merged/);
 }finally{await mf.dispose()}
});
