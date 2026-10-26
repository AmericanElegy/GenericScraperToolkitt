import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {rankingPlan} from '../src/interpretation/ranking-rules.js';
import {hasTextRelations,assertTextFactConsistency} from '../src/interpretation/text-facts.js';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const post=(mf,path,body)=>mf.dispatchFetch('https://toolkit.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const start=(mf,text)=>post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text}});
const act=(mf,job,action,rest={})=>post(mf,'/api/interpretation/action',{job,action,...rest});
const setup=(html='')=>new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{headers:{'content-type':'text/html'}})}));

test('rankings become period/rank/item records with snapshot-grounded context, review and portable exports',async()=>{
 const text='Table context: Most viewed articles of each year\n\nYear\t#1\t#2\n2024\tSolar eclipse\tFootball\n2025\tMusic\tFilm';
 const mf=setup();try{
  let response=await start(mf,text);assert.equal(response.status,200);let v=await response.json();assert.equal(v.job.parser_version,'semantic-ranking-v1');assert.equal(v.counts.candidates,4);assert.equal(v.meaning.metric,'Most viewed');assert.equal(v.meaning.category,'articles');assert.equal(v.meaning.source_rows,2);
  const rows=v.validation.records;assert.deepEqual(rows.map(r=>[r.fields.year.value,r.fields.rank.value,r.fields.item.value]),[['2024',1,'Solar eclipse'],['2024',2,'Football'],['2025',1,'Music'],['2025',2,'Film']]);
  for(const r of rows)for(const f of Object.values(r.fields))for(const e of f.evidence)assert.equal(text.slice(e.source_start,e.source_end),e.quote);
  assert.equal(v.review_queue.eligible_ids.length,4);
  v=await (await act(mf,v.job,'review_batch',{record_ids:v.review_queue.eligible_ids,reviewer:'Test',note:'Checked titles against explicit ranks and caption.',confirmed_mapping:true})).json();assert.equal(v.counts.approved,4);
  const csv=await (await act(mf,v.job,'export',{format:'csv'})).text();assert.match(csv,/"year","rank","item","metric","category"/);assert.match(csv,/"2024","1","Solar eclipse","Most viewed","articles"/);
  const exported=await (await act(mf,v.job,'export',{format:'json'})).json();assert.equal(exported.interpretation_context.context,'Most viewed articles of each year');
  const session=await (await act(mf,v.job,'save')).json();response=await post(mf,'/api/interpretation/action',{action:'restore',session});assert.equal(response.status,200);assert.equal((await response.json()).counts.approved,4);
  const noContext=await (await start(mf,'Year\t#1\t#2\n2024\tAlpha\tBeta')).json();assert.equal(noContext.meaning.metric,null);assert.ok(!noContext.job.packet.schema.fields.some(f=>f.name==='metric'));
 }finally{await mf.dispose();}
});

test('noun answers stay text and coexist with numeric facts without inventing associations',async()=>{
 const text='The most popular article in 2025 was Solar eclipse. The capital of France is Paris. Widgets reached 12.6 percent.';
 const mf=setup();try{
  const response=await start(mf,text);assert.equal(response.status,200);const v=await response.json();assert.equal(v.job.parser_version,'text-relations-v1');assert.equal(v.counts.candidates,3);
  const [popular,capital,numeric]=v.validation.records;
  assert.equal(popular.fields.answer.value,'Solar eclipse');assert.equal(popular.fields.time_context.value,'2025');assert.equal(popular.fields.subject.value,'article');assert.equal(popular.fields.numeric_value.value,null);
  assert.equal(capital.fields.answer.value,'Paris');assert.equal(capital.fields.subject.value,'France');assert.equal(numeric.fields.numeric_value.value,12.6);assert.equal(numeric.fields.answer.value,'12.6');assert.equal(numeric.fields.unit.value,'percent');assert.equal(v.review_queue.eligible_ids.length,0);
  for(const r of v.validation.records)for(const f of Object.values(r.fields))for(const e of f.evidence)assert.equal(text.slice(e.source_start,e.source_end),e.quote);
  const approved=await (await act(mf,v.job,'review',{decision:{record_id:'row-1',decision:'approved',reviewer:'Test',note:'Compared named answer and year.',confirmed_association:true}})).json();assert.equal(approved.counts.approved,1);
  const csv=await (await act(mf,approved.job,'export',{format:'csv'})).text();assert.match(csv,/"article","most popular","Solar eclipse"/);
  const session=await (await act(mf,approved.job,'save')).json();assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session})).status,200);
  const plain=await (await start(mf,'Widgets reached 12.6 percent.')).json();assert.notEqual(plain.job.parser_version,'text-relations-v1');assert.equal(plain.validation.records[0].fields.value.value,12.6);
 }finally{await mf.dispose();}
});

test('unsupported, negated and revised statements do not become noun claims; numeric answer disagreement is rejected',()=>{
 for(const text of ['The most popular article was not Football.','The capital of France was Paris, but this was corrected.','Many people like Football.'])assert.equal(hasTextRelations(text),false,text);
 assert.equal(hasTextRelations('Paris is the capital of France.'),true);
 assert.equal(hasTextRelations('The category of Football is sport.'),true);
 assert.throws(()=>assertTextFactConsistency({records:[{fields:{numeric_value:{value:12.6},answer:{value:'99'}}}]}),/disagree/);
 assert.equal(rankingPlan('Name\tScore\nAlpha\t98.6'),null);
 assert.throws(()=>rankingPlan('Year\t#1\t#2\n'+Array.from({length:26},(_,i)=>`${2000+i}\tAlpha\tBeta`).join('\n')),/50 ranked items/);
});

test('URL ranking batches respect expanded fact limits instead of silently truncating names',async()=>{
 const html='<table><caption>Most viewed articles by year</caption><tr><th>Year</th>'+[1,2,3,4,5].map(i=>`<th>#${i}</th>`).join('')+'</tr>'+Array.from({length:11},(_,i)=>`<tr><td>${2000+i}</td>`+[1,2,3,4,5].map(n=>`<td>Item ${i}-${n}</td>`).join('')+'</tr>').join('')+'</table>';
 const mf=setup(html);try{
  const response=await post(mf,'/api/interpretation/fetch',{url:'https://en.wikipedia.org/test'});assert.equal(response.status,200);const f=await response.json();const tables=f.datasets.filter(d=>d.kind==='table');assert.equal(tables.length,2);assert.deepEqual(tables.map(d=>d.row_count),[10,1]);
  let total=0;for(const d of tables){const r=await start(mf,d.text);assert.equal(r.status,200);total+=(await r.json()).counts.candidates;}assert.equal(total,55);
 }finally{await mf.dispose();}
});
