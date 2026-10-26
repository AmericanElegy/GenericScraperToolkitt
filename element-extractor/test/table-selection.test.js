import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {capturedTableCatalog,selectCapturedTable} from '../src/interpretation/table-selection.js';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const post=(mf,path,body)=>mf.dispatchFetch('http://127.0.0.1'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const setup=html=>new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{headers:{'content-type':'text/html'}})}));
const html='<table><caption>English Wikipedia</caption><tr><th>Item</th><th>Count</th></tr><tr><td>Articles</td><td>1234</td></tr></table><table><tr><th>Project(s)</th><th>Articles</th><th>Edits</th><th>Users</th></tr>'+Array.from({length:30},(_,i)=>`<tr><td>Project ${i+1}</td><td>${1000+i}</td><td>${2000+i}</td><td>${3000+i}</td></tr>`).join('')+'</table>';

test('table catalog distinguishes a summary from project comparison; selected parts span captured batches and retain source context through export/restore',async()=>{
 const mf=setup(html);try{
  const f=await (await post(mf,'/api/interpretation/fetch',{url:'https://en.wikipedia.org/test'})).json();assert.equal(f.table_catalog.length,2);assert.match(f.datasets[0].display_label,/item counts/);const parent=f.table_catalog[1];assert.match(parent.name,/Project\(s\) comparison/);assert.equal(parent.rows.length,30);assert.equal(f.datasets.filter(d=>d.table_key===parent.key).length,2);
  let response=await post(mf,'/api/interpretation/select',{parent,options:{columns:[0,2],first_row:23,last_row:27}});assert.equal(response.status,200);const part=await response.json();assert.equal(part.row_count,5);assert.equal(part.text,'Project(s)\tEdits\nProject 23\t2022\nProject 24\t2023\nProject 25\t2024\nProject 26\t2025\nProject 27\t2026');
  const retrieval={method:f.method,source:f.source,retrieved_at:f.retrieved_at,snapshot_hash:part.snapshot_hash,label:part.label,content_kind:'table',table_selection:part.table_selection};
  response=await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:part.text,url:f.source},retrieval});assert.equal(response.status,200);let v=await response.json();assert.equal(v.counts.candidates,5);assert.equal(v.counts.approved,0);assert.equal(v.validation.records[0].fields.edits.value,2022);
  for(const r of v.validation.records)for(const field of Object.values(r.fields))for(const e of field.evidence)assert.equal(part.text.slice(e.source_start,e.source_end),e.quote);
  response=await post(mf,'/api/interpretation/action',{action:'review_batch',job:v.job,record_ids:v.review_queue.eligible_ids,reviewer:'Table selection test',note:'Checked project labels and chosen edits column.',confirmed_mapping:true});assert.equal(response.status,200);v=await response.json();assert.equal(v.counts.approved,5);
  const exported=await (await post(mf,'/api/interpretation/action',{action:'export',job:v.job,format:'json'})).json();assert.deepEqual(exported.source_retrieval.table_selection.columns,[0,2]);assert.equal(exported.source_retrieval.table_selection.first_row,23);
  const session=await (await post(mf,'/api/interpretation/action',{action:'save',job:v.job})).json();assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session})).status,200);
  session.job.retrieval.table_selection.parent.rows[22].cells[2]='Forged';assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session})).status,400,'Saved selection must replay from its captured parent.');
 }finally{await mf.dispose();}
});

test('selections reject uncaptured cells, invalid ranges, excess columns, quote limits and ranking expansion without truncation',async()=>{
 const parent={version:'captured-table-v1',key:'t',title:'Test',name:'Test',source_rows:2,source_columns:3,columns:[{index:0,label:'Name'},{index:1,label:'Count'},{index:2,label:'Note'}],rows:[{index:1,cells:['Alpha','12',null]},{index:2,cells:['Beta','13','Okay']}]};
 await assert.rejects(selectCapturedTable(parent,{columns:[0,2],first_row:1,last_row:2}),/not captured/);
 await assert.rejects(selectCapturedTable(parent,{columns:[1],first_row:1,last_row:2}),/2–8/);
 await assert.rejects(selectCapturedTable(parent,{columns:[0,1],first_row:2,last_row:1}),/valid source row/);
 await assert.rejects(selectCapturedTable({...parent,rows:[parent.rows[1]]},{columns:[0,1],first_row:1,last_row:2}),/not captured/);
 const ranked={version:'captured-table-v1',key:'r',title:'Most viewed articles',name:'Ranks',source_rows:26,source_columns:3,columns:[{index:0,label:'Year'},{index:1,label:'#1'},{index:2,label:'#2'}],rows:Array.from({length:26},(_,i)=>({index:i+1,cells:[String(2000+i),'Alpha','Beta']}))};
 await assert.rejects(selectCapturedTable(ranked,{columns:[0,1,2],first_row:1,last_row:26}),/50 ranked items/);
 const subset=await selectCapturedTable(ranked,{columns:[0,2],first_row:1,last_row:2});assert.equal(subset.record_count,2);assert.match(subset.text,/Year\t#2/);
 const unsafe=structuredClone(parent);unsafe.rows[0].cells[0]='A'.repeat(2048);await assert.rejects(selectCapturedTable(unsafe,{columns:[0,1],first_row:1,last_row:1}),/evidence size/);
});

test('capture pieces join only by source ordinals, preserve empty cells and reject inconsistent overlaps',()=>{
 const a={table_key:'same',table_title:'Test',table_name:'Test',total_rows:1,total_columns:3,column_indices:[0,1],row_start:1,grid:{headers:['Name','Count'],rows:[['Same name','12']]}};
 const b={...a,column_indices:[0,2],grid:{headers:['Name','Note'],rows:[['Same name','']]}};
 const p=capturedTableCatalog([a,b])[0];assert.deepEqual(p.rows[0].cells,['Same name','12','']);
 b.grid.rows[0][0]='Different';assert.throws(()=>capturedTableCatalog([a,b]),/disagree/);
});
