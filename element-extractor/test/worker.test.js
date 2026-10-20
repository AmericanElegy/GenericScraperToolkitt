import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
// Synthetic structural fixture: runtime regression coverage, not proof of live Wikipedia extraction.
function fixture({implicit = false, columns = 16} = {}) {
  const endCell = implicit ? '' : '</td>';
  const endRow = implicit ? '' : '</tr>';
  const symbols = Array.from({length:118}, (_,i) => i === 0 ? 'H' : i === 117 ? 'Og' : String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(97 + i % 26));
  return '<table class="wikitable"><tr><th>Z</th><th>Sym.</th><th>Element</th></tr>' + symbols.map((s,i) => '<tr>' + [i+1, `<a>${s}</a>`, `Element${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(97+i%26)}`, 'origin', i%18+1, Math.min(7,Math.floor(i/18)+1), ...Array(columns-6).fill('value')].map(v=>'<td>'+v+endCell).join('')+endRow).join('')+'</table>';
}
async function runtime(html, outbound) {
  return new Miniflare(convertV4MiniflareOptions({modules:true, compatibilityDate:'2026-10-01', script: source,
    outboundService: outbound ?? (async () => new Response(html,{headers:{'Content-Type':'text/html'}}))}));
}
for (const implicit of [false,true]) test(`handles ${implicit ? 'omitted closing tags by rejecting malformed extraction' : 'explicit closing tags with 118 validated rows'}`, async()=>{
  const mf=await runtime(fixture({implicit}));
  try { const r=await mf.dispatchFetch('https://demo.test/api/elements'); const d=await r.json(); if (implicit) { assert.equal(r.status,502); assert.match(d.error,/extraction stopped/); } else { assert.equal(r.status,200,JSON.stringify(d)); assert.equal(d.count,118); assert.equal(d.elements[117].symbol,'Og'); } } finally {await mf.dispose()}
});
test('serves UI, CSV, JSON and cached validated results', async()=>{
  let calls=0;
  const mf=await runtime(null,async()=>{calls++;return new Response(fixture(),{headers:{'content-type':'text/html'}})});
  try {
    const page=await mf.dispatchFetch('https://demo.test/');assert.equal(page.status,200);assert.match(await page.text(),/Search name, symbol or atomic number/);
    const r=await mf.dispatchFetch('https://demo.test/api/elements');const data=await r.json();assert.equal(data.count,118);
    // Allow waitUntil's cache write to complete before asserting cache reuse.
    await new Promise(resolve=>setTimeout(resolve,100));
    const csv=await mf.dispatchFetch('https://demo.test/elements.csv');assert.equal(csv.status,200);assert.match(csv.headers.get('content-disposition'),/chemical-elements.csv/);
    const lines=(await csv.text()).trim().split('\r\n');assert.equal(lines.length,119);assert.equal(lines[1],'"1","H","ElementAa","1","1"');
    const cached=await (await mf.dispatchFetch('https://demo.test/api/elements')).json();assert.equal(cached.retrieved_at,data.retrieved_at);assert.equal(calls,1);
    assert.equal((await mf.dispatchFetch('https://demo.test/missing')).status,404);
    assert.equal((await mf.dispatchFetch('https://demo.test/',{method:'POST'})).status,405);
  } finally {await mf.dispose()}
});
for (const [label,handler,message] of [
  ['upstream HTTP failure',()=>new Response('unavailable',{status:503}),/HTTP 503/],
  ['redirect',()=>new Response(null,{status:302,headers:{location:'https://other.test/'}}),/HTTP 302/],
  ['wrong content type',()=>new Response('{}',{headers:{'content-type':'application/json'}}),/content type/],
  ['changed columns',()=>new Response(fixture({columns:15}),{headers:{'content-type':'text/html'}}),/columns changed/],
  ['missing table',()=>new Response('<html>changed</html>',{headers:{'content-type':'text/html'}}),/table not found/],
]) test(`rejects ${label} without caching it`,async()=>{
  let calls=0;const mf=await runtime(null,()=>{calls++;return handler()});
  try { for(let i=0;i<2;i++){ const r=await mf.dispatchFetch('https://demo.test/api/elements');assert.equal(r.status,502);assert.match((await r.json()).error,message); } assert.equal(calls,2); } finally {await mf.dispose()}
});
