// Opt-in deployed-workbench availability check. No approvals or AI calls.
import {mkdir,readFile,writeFile}from 'node:fs/promises';
import {scoreTable}from '../src/interpretation/extraction-benchmark.js';
const manifest=JSON.parse(await readFile('test/fixtures/extraction-benchmark/expected.json','utf8'));
const base=process.env.BENCHMARK_BASE_URL||'https://genericscrapertoolkit.jamesjustice95.workers.dev';
await mkdir('.wrangler/benchmarks/live',{recursive:true});const results=[];
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return {status:r.status,ok:r.ok,value:await r.json()};}
for(const c of manifest.cases){
 try{
  const response=await post('/api/interpretation/fetch',{url:c.url});await writeFile('.wrangler/benchmarks/live/'+c.id+'.json',JSON.stringify(response,null,2)+'\n');
  if(!response.ok){results.push({id:c.id,status:'fetch_failed',http_status:response.status,message:response.value.error,code:response.value.code});continue;}
  const f=response.value,parts=f.datasets.filter(d=>d.kind==='table'&&(c.id==='bls'?d.text.includes('Major occupational group'):JSON.stringify(d.table_preview?.headers)===JSON.stringify(c.headers)));
  if(!parts.length){results.push({id:c.id,status:'target_not_imported',issues:f.issues});continue;}
  const records=[];
  for(const d of parts){const r=await post('/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:f.source},retrieval:{method:f.method,source:f.source,retrieved_at:f.retrieved_at,snapshot_hash:d.snapshot_hash,label:d.label,content_kind:d.kind}});if(!r.ok)throw Error(r.value.error);records.push(...r.value.validation.records.map(row=>Object.fromEntries(Object.entries(row.fields).map(([k,v])=>[k,v.value]))));}
  // Wikipedia is mutable. A live mismatch is source drift or parser change to investigate,
  // never permission to overwrite the frozen expected values automatically.
  const score=scoreTable(c,records);results.push({id:c.id,status:score.pass?'matched_frozen_reference':'reference_mismatch',method:f.method,...score});
 }catch(e){results.push({id:c.id,status:'request_failed',message:e.message});}
}
const report={checked_at:new Date().toISOString(),base,results,ai_calls:0,notice:'Live fetch/interpretation requests only. No records approved. Mutable-source mismatches require source inspection.'};
await writeFile('.wrangler/benchmarks/live-results.json',JSON.stringify(report,null,2)+'\n');for(const r of results)console.log(r.id+': '+r.status+(r.message?' — '+r.message:''));if(results.some(r=>r.status!=='matched_frozen_reference'))process.exitCode=2;
