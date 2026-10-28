import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const setup=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:()=>{throw Error('No network allowed.');}}));
const post=(mf,path,body)=>mf.dispatchFetch('https://toolkit.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const start=async(mf,text)=>{const r=await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text}});assert.equal(r.status,200,await r.clone().text());return r.json();};

test('paragraph dollar lists, grouped counts and numeric rates preserve literal subjects, amounts and units',async()=>{const mf=setup();try{
 const text='The average hourly wage was $31.59. Higher paying groups included management ($65.97), legal ($54.16), and computer and mathematical ($51.30). Acme employs 1,234 workers. Participation reached 66.2 percent.';
 const v=await start(mf,text);assert.equal(v.job.parser_version,'quantitative-prose-v1');const rows=v.validation.records;assert.equal(rows.length,6);for(const row of rows)for(const f of Object.values(row.fields)){assert.equal(f.issues.length,0);for(const e of f.evidence)assert.equal(text.slice(e.source_start,e.source_end),e.quote);}
 assert.deepEqual(rows.filter(r=>r.fields.unit.value==='$').map(r=>[r.fields.measure.value,r.fields.value.value]),[['The average hourly wage',31.59],['management',65.97],['legal',54.16],['computer and mathematical',51.3]]);
 const workers=rows.find(r=>r.fields.unit.value==='workers');assert.equal(workers.fields.measure.value,'Acme');assert.equal(workers.fields.value.value,1234);assert.equal(v.review_queue.eligible_ids.length,0);
 const session=await (await post(mf,'/api/interpretation/action',{action:'save',job:v.job})).json();assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session})).status,200);
}finally{await mf.dispose();}});

test('mixed noun answers retain grouped currency as typed numeric values and old text sessions stay pinned',async()=>{const mf=setup();try{
 const text='The capital of France is Paris. Revenue was $1,234.50. Widgets reached 12.6 percent.';const v=await start(mf,text);assert.equal(v.job.parser_version,'text-relations-v2');assert.equal(v.counts.candidates,3);const dollar=v.validation.records.find(r=>r.fields.unit.value==='$');assert.equal(dollar.fields.answer.value,'1,234.50');assert.equal(dollar.fields.numeric_value.value,1234.5);for(const f of Object.values(dollar.fields))assert.equal(f.issues.length,0);
 const old=await start(mf,'The capital of France is Paris. Widgets reached 12.6 percent.');assert.equal(old.job.parser_version,'text-relations-v1');assert.equal(old.counts.candidates,2);
 const v2numeric=await start(mf,'Widgets reached 12.6 percent.');assert.equal(v2numeric.job.parser_version,'prose-facts-v2');
}finally{await mf.dispose();}});

test('negation and corrections stay blocked; malformed groupings, scale guesses and URL amounts are not accepted',async()=>{const mf=setup();try{
 let v=await start(mf,'The revised revenue was $1,234.50.');assert.equal(v.counts.candidates,1);assert.ok(v.validation.records[0].issues.some(i=>i.code==='interpreter_flag'));assert.equal(v.review_queue.exception_ids.length,1);
 for(const text of ['Revenue was $12,34.','Revenue was $1.2 million.','See https://example.org/$1234/2026.']){v=await start(mf,text);assert.equal(v.counts.candidates,0,text);}
 v=await start(mf,'Workers in Jacksonville had an average (mean) hourly wage of $31.59, compared to the nationwide average of $33.54.');assert.equal(v.counts.candidates,2);assert.deepEqual(v.validation.records.map(r=>r.fields.value.value),[31.59,33.54]);
}finally{await mf.dispose();}});

test('full-page enhanced quantities retain original-page offsets and unsafe integers stay blocked',async()=>{const mf=setup();try{
 const text='The capital of France is Paris. Revenue was $1,234.50.\n\n'+Array.from({length:40},(_,i)=>'Retained paragraph '+i+' without a supported quantitative statement.').join('\n\n');
 const v=await start(mf,text);assert.equal(v.job.parser_version,'text-relations-v2');assert.ok(v.document);for(const row of v.validation.records)for(const field of Object.values(row.fields))for(const e of field.evidence)assert.equal(text.slice(e.document_start,e.document_end),e.quote);
 const session=await (await post(mf,'/api/interpretation/action',{action:'save',job:v.job})).json();assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session})).status,200);
 const huge=await start(mf,'Revenue was $9,999,999,999,999,999.');assert.ok(huge.validation.records[0].issues.some(i=>i.code==='interpreter_flag'));
}finally{await mf.dispose();}});
