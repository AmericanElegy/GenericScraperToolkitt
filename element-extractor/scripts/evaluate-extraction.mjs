import {readFile,writeFile,mkdir}from 'node:fs/promises';
import {createHash}from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions}from 'miniflare';
import {scoreTable}from '../src/interpretation/extraction-benchmark.js';

export async function evaluateExtraction({fullWikipedia=false}={}){
 const root=new URL('../test/fixtures/extraction-benchmark/',import.meta.url),manifest=JSON.parse(await readFile(new URL('expected.json',root),'utf8'));
 const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),results=[];
 for(const c of manifest.cases){
  const useFull=fullWikipedia&&c.id==='wikipedia';
  const bytes=await readFile(useFull?'.wrangler/benchmarks/raw/wikipedia.html':new URL(c.input,root));
  const hashInput=useFull?bytes:bytes.toString('utf8').replace(/\r\n?/g,'\n');
  if(createHash('sha256').update(hashInput).digest('hex')!==(useFull?c.raw_sha256:c.input_sha256))throw Error('Frozen source changed: '+c.name+'. Review the fixture; do not regenerate expected output from the extractor.');
  let outbound=0;
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:request=>{
   outbound++;const url=new URL(request.url);
   if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:url.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
   if(url.hostname!==new URL(c.url).hostname)throw Error('Unexpected network destination in offline benchmark.');
   return new Response(bytes,{headers:{'content-type':'text/html; charset=utf-8'}});
  }}));
  const post=async(path,body)=>{const r=await mf.dispatchFetch('https://toolkit.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(c.name+': '+value.error);return value;};
  try{
   const selections=[];
   if(c.input_kind==='html'){
    const fetched=await post('/api/interpretation/fetch',{url:c.url});
    const matches=fetched.datasets.filter(d=>d.kind==='table'&&JSON.stringify(d.table_preview?.headers)===JSON.stringify(c.headers));
    if(!matches.length)throw Error(c.name+': target headings were not found.');
    for(const d of matches)selections.push(await post('/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:fetched.source},retrieval:{method:fetched.method,source:fetched.source,retrieved_at:fetched.retrieved_at,snapshot_hash:d.snapshot_hash,label:d.label,content_kind:d.kind}}));
   }else selections.push(await post('/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:bytes.toString('utf8'),url:c.url}}));
   const actual=selections.flatMap(v=>v.validation.records.map(r=>Object.fromEntries(Object.entries(r.fields).map(([k,f])=>[k,f.value]))));
   let invalidEvidence=0,autoApproved=0;
   for(const view of selections){autoApproved+=view.counts.approved;
    for(const r of view.validation.records)for(const f of Object.values(r.fields))for(const e of f.evidence)if(view.job.packet.source.text.slice(e.source_start,e.source_end)!==e.quote)invalidEvidence++;
   }
   results.push({id:c.id,name:c.name,input_kind:c.input_kind,provenance:useFull?'Full saved Wikipedia HTTP response replay, including unrelated tables and page noise.':c.provenance,...scoreTable(c,actual),invalid_evidence:invalidEvidence,auto_approved:autoApproved,simulated_fetch_calls:outbound,notice:'Offline replay. This is not a live availability result or a human approval.'});
  }finally{await mf.dispose();}
 }
 return {format:'extraction-benchmark-report-v1',checked_at:new Date().toISOString(),structured_cases_passed:results.every(r=>r.pass&&!r.invalid_evidence&&!r.auto_approved),results,mixed_case:{name:manifest.mixed_case.name,status:'requires_optional_private_fixture_run',desired_material_rows:12,desired_quantity_rows:4,notice:manifest.mixed_case.known_limit},live_fetch:'Separate capture report; HTTP failures do not count as parser failures.',ai_calls:0};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/evaluate-extraction.mjs')){
 const fullWikipedia=process.argv.includes('--full-wikipedia');
 const report=await evaluateExtraction({fullWikipedia});await mkdir('.wrangler/benchmarks',{recursive:true});await writeFile('.wrangler/benchmarks/'+(fullWikipedia?'full-page-evaluation':'evaluation')+'.json',JSON.stringify(report,null,2)+'\n');
 for(const r of report.results)console.log((r.pass?'PASS':'FAIL')+' '+r.name+': '+r.exact_rows+'/'+r.expected_rows+' exact rows, '+r.correct_cells+'/'+r.expected_cells+' exact cells.');
 console.log('Mixed document: measured separately with optional private fixture. No AI calls.');if(!report.structured_cases_passed)process.exitCode=1;
}
