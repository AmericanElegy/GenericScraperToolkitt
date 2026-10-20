import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const fixture=await readFile(new URL('./fixtures/dci-finals.html',import.meta.url),'utf8');
test('DCI div grid extracts 12 real score rows and excludes sponsor/footer rows',async()=>{
 let html=fixture;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{headers:{'content-type':'text/html'}})}));
 const post=url=>mf.dispatchFetch('https://toolkit.example.org/api/tables',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
 try {
  let r=await post('https://www.dci.org/scores/final-scores/2026-dci-all-age-world-championship-finals/'),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.tables.length,1);
  const t=d.tables[0];assert.equal(t.title,'All Age Class');assert.deepEqual(t.headers,['Place','Corps','Score']);assert.equal(t.rows.length,12);assert.deepEqual(t.rows[0],['1','Reading Buccaneers','96.200']);assert.deepEqual(t.rows[11],['12','Minnesota Brass','79.625']);assert.equal(t.rows[10][1],'Northern Lights Drum & Bugle Corps');assert.ok(!t.rows.flat().some(v=>/Powered by|recap/.test(v)));assert.equal(t.extraction_method,'dci-final-scores');
  assert.equal((await post('https://other.example.org/scores/final-scores/same/')).status,422);
  html=fixture.replace('<span>Score</span>','<span>New heading</span>');r=await post('https://www.dci.org/scores/final-scores/event/');assert.equal(r.status,422);assert.match((await r.json()).error,/headings changed/);
  html=fixture.replace('All Age Class','All Age Class</h2><h2 class="score-division-name">Another division');r=await post('https://www.dci.org/scores/final-scores/event/');assert.equal(r.status,422);assert.match((await r.json()).error,/Multiple DCI divisions/);
  html=fixture.replace('96.200','not a score');r=await post('https://www.dci.org/scores/final-scores/event/');assert.equal(r.status,422);assert.match((await r.json()).error,/values changed/);
 }finally{await mf.dispose()}
});
