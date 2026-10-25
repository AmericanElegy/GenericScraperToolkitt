import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const fixture=await readFile(new URL('./fixtures/wikipedia-shapes.html',import.meta.url),'utf8');
const setup=html=>new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{headers:{'content-type':'text/html'}})}));
const post=(mf,path,body)=>mf.dispatchFetch('https://toolkit.example.org'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const start=(mf,f,d)=>post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:f.source},retrieval:{method:f.method,source:f.source,retrieved_at:f.retrieved_at,snapshot_hash:d.snapshot_hash,label:d.label,content_kind:d.kind}});

test('Wikipedia-shaped pages recover data from wrappers, omit navigation, keep supported tables and batch all wide columns within bounds',async()=>{
 const mf=setup(fixture);
 try{
  const response=await post(mf,'/api/interpretation/fetch',{url:'https://en.wikipedia.org/wiki/Wikipedia:Statistics'});assert.equal(response.status,200);const f=await response.json();
  assert.ok(f.discovery.scanned_tables>20);assert.equal(f.discovery.ignored_tables,22);
  assert.ok(f.issues.some(i=>i.includes('Unsupported grid')&&i.includes('Merged')));
  assert.ok(f.issues.some(i=>i.includes('image-only')));
  const tables=f.datasets.filter(d=>d.kind==='table');assert.equal(tables.length,7);
  const labels=tables.map(d=>d.label);assert.ok(labels.some(l=>l.startsWith('Summary')));assert.ok(!labels.some(l=>l.includes('Unsupported grid')));
  const wide=tables.filter(d=>d.label.startsWith('Wide thresholds'));assert.equal(wide.length,2);assert.deepEqual([...new Set(wide.flatMap(d=>d.column_indices))],[0,1,2,3,4,5,6,7,8]);assert.equal(wide[0].table_key,wide[1].table_key);
  for(const d of tables){const r=await start(mf,f,d);assert.equal(r.status,200,d.label);const v=await r.json();assert.equal(v.counts.candidates,d.row_count,d.label);assert.ok(v.job.packet.schema.fields.length<=8);
   for(const row of v.validation.records)for(const field of Object.values(row.fields))for(const e of field.evidence)assert.equal(d.text.slice(e.source_start,e.source_end),e.quote);
   if(d.label.startsWith('Summary'))assert.equal(v.validation.records[0].fields.count.value,1234);
   if(d.label.startsWith('Ranked'))assert.equal(v.validation.records[0].fields.column_1.value,'Alpha');
   if(d.label.startsWith('Shares')){const fields=v.validation.records[0].fields;assert.equal(fields.share_percent.value,8);assert.equal(fields.notes.value,null);assert.equal(fields.image.value,null);assert.equal(fields.notes.issues.length,0);assert.equal(v.job.packet.schema.fields.find(f=>f.name==='notes').required,false);assert.equal(v.review_queue.eligible_ids.length,2);}
   if(d.label.startsWith('Required numbers')){assert.equal(v.validation.records[1].fields.count.value,null);assert.ok(v.validation.records[1].fields.count.issues.some(i=>i.code==='required_value_missing'));assert.equal(v.review_queue.exception_ids.length,1);}
   if(d.label.startsWith('Totals'))assert.equal(v.counts.candidates,2);
  }
  const legacy=await post(mf,'/api/tables',{url:'https://en.wikipedia.org/wiki/Wikipedia:Statistics'});assert.equal(legacy.status,422,'Strict legacy table endpoint keeps its 20-table budget.');
 }finally{await mf.dispose();}
});

test('mapped v1 portable reviews replay without adopting v2 percent types or optional blank fields',async()=>{
 const {createPacket,runInterpretation,scriptedInterpreter,appendReview}=await import('../src/interpretation/pipeline.js');
 const {detectColumns,mappedSchema,extractMappedTable,LEGACY_MAPPING_VERSION}=await import('../src/interpretation/column-mapping.js');
 const source={text:'Name\tShare\tNotes\nAlpha\t8.0 %\t\nBeta\t9.0 %\tText'};
 const plan=detectColumns(source.text,LEGACY_MAPPING_VERSION),mapping=mappedSchema(plan);
 const packet=await createPacket({source,schema:mapping.schema});const job={example_id:'custom-text',parser_version:LEGACY_MAPPING_VERSION,packet,mapping:mapping.columns,events:[],revisions:[]};
 job.cache_entry=(await runInterpretation(packet,await scriptedInterpreter(extractMappedTable(job)))).cache_entry;
 job.events=await appendReview(packet,job.cache_entry,[],{record_id:'row-1',decision:'approved',reviewer:'Legacy reviewer',note:'Confirmed the retained text values.',confirmed_association:true});
 const mf=setup('');try{
  const response=await post(mf,'/api/interpretation/action',{action:'restore',session:{format:'toolkit-review-session-v1',job}});assert.equal(response.status,200);const restored=await response.json();
  assert.equal(restored.counts.candidates,1);assert.equal(restored.counts.approved,1);assert.equal(restored.validation.records[0].fields.share.value,'9.0 %');assert.equal(restored.job.parser_version,'mapped-table-v1');
  const newer=await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source});assert.equal(newer.status,200);const v=await newer.json();assert.equal(v.counts.candidates,2);assert.equal(v.validation.records[0].fields.share_percent.value,8);assert.equal(v.validation.records[0].fields.notes.value,null);
 }finally{await mf.dispose();}
});

test('candidate scanning and selection budgets report omissions and do not relax required numeric or span checks',async()=>{
 const table='<table><tr><th>Name</th><th>Count</th></tr><tr><td>A</td><td>1</td></tr></table>';
 let mf=setup(table.repeat(21));try{const r=await post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});assert.equal(r.status,200);const f=await r.json();assert.equal(f.datasets.filter(d=>d.kind==='table').length,20);assert.equal(f.discovery.inventory.filter(t=>t.status==='omitted').length,1);assert.ok(f.issues.some(i=>i.includes('20 candidate tables')));}finally{await mf.dispose();}
 mf=setup(table.repeat(101));try{const r=await post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});assert.equal(r.status,422);assert.match((await r.json()).error,/scan limit of 100/);}finally{await mf.dispose();}
 const grid='<div role="table"><div role="row"><span role="columnheader">Name</span><span role="columnheader">Count</span></div><div role="row"><span role="cell">A</span><span role="cell">1</span></div></div>';
 mf=setup(table.repeat(10)+grid.repeat(11));try{const r=await post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});assert.equal(r.status,200);const f=await r.json();assert.equal(f.datasets.filter(d=>d.kind==='table').length,20);assert.equal(f.discovery.inventory.filter(t=>t.status==='omitted').length,1);}finally{await mf.dispose();}
 mf=setup('<table role="presentation"><tr><td>Layout</td></tr></table>'.repeat(50)+grid.repeat(51));try{const r=await post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});assert.equal(r.status,422);assert.match((await r.json()).error,/scan limit of 100/);}finally{await mf.dispose();}
 mf=setup('<table><tr><th>A</th><th>B</th></tr><tr><td>Outer</td><td>'+table+'</td></tr></table>');try{const r=await post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});assert.equal(r.status,422);assert.match((await r.json()).error,/Nested data/);}finally{await mf.dispose();}
});
