import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {planPage} from '../src/interpretation/page-intake.js';

test('BLS detailed table exports approved rows across batches with original positions and explicit omissions',async()=>{
 const source=(await readFile(new URL('./fixtures/bls-full-page.txt',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 const plan=planPage({text:source});
 const datasets=plan.datasets.filter(d=>d.schema.fields.some(f=>f.name==='occupation'));
 assert.deepEqual(datasets.map(d=>d.row_count),[24,24]);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',outboundService:()=>{throw Error('Offline test');}}));
 const post=async(path,body)=>mf.dispatchFetch('https://toolkit.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const action=async body=>{const r=await post('/api/interpretation/action',body);const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 try{
  const parts=[];
  for(const [i,d]of datasets.entries()){
   let v=await (await post('/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:'https://www.bls.gov/example'},retrieval:{method:'static-html',source:'https://www.bls.gov/example',retrieved_at:'2026-11-21T12:00:00Z',snapshot_hash:await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.text)).then(b=>Buffer.from(b).toString('hex')),label:'Table 1 batch '+i,content_kind:'table'}})).json();
   v=await action({action:'review',job:v.job,decision:{record_id:'row-1',decision:'approved',reviewer:'Table test',note:'Compared literal values and association',confirmed_association:true}});
   parts.push({row_start:i*24+1,row_count:24,snapshot_hash:v.job.packet.source.text_hash,job:v.job});
  }
  const body={action:'table_export',format:'json',total_rows:48,parts};
  const r=await post('/api/workspace',body);assert.equal(r.status,200);const out=await r.json();assert.deepEqual(out.records.map(r=>r.source_row),[1,25]);assert.equal(out.coverage.pending,46);assert.equal(out.coverage.excluded,46);
  const partial=await (await post('/api/workspace',{...body,parts:[parts[0],{...parts[1],job:null}]})).json();assert.equal(partial.coverage.unopened,24);assert.equal(partial.records.length,1);
  assert.equal((await post('/api/workspace',{...body,parts:[parts[0],{...parts[1],row_start:24}]})).status,422);
  const bad=structuredClone(body);bad.parts[1].snapshot_hash='0'.repeat(64);assert.equal((await post('/api/workspace',bad)).status,422);
  bad.parts[1]=structuredClone(parts[1]);bad.parts[1].job.events[0].note='Changed history';assert.equal((await post('/api/workspace',bad)).status,422);
 }finally{await mf.dispose();}
});
