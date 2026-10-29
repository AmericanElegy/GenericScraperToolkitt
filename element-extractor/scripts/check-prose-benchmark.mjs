import {readFile,writeFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {candidateClaims,compareProse} from '../src/interpretation/prose-benchmark.js';
const key=JSON.parse(await readFile(new URL('../test/fixtures/prose-benchmark/starter.json',import.meta.url),'utf8'));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',outboundService:()=>{throw Error('Benchmark cannot fetch sources.');}}));
try{
 const cases=[];
 for(const c of key.cases){
  for(const e of c.expected)if(!c.text.includes(e.evidence))throw Error('Answer-key evidence is absent: '+c.id);
  const r=await mf.dispatchFetch('https://benchmark.example.org/api/interpretation/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({example_id:'custom-text',mode:'auto',source:{text:c.text,url:null}})});
  const v=await r.json();if(!r.ok)throw Error(c.id+': '+v.error);
  const actual=candidateClaims(v);cases.push({id:c.id,origin:c.origin,text:c.text,parser:v.job.parser_version,...compareProse(c.expected,actual),unresolved:c.unresolved});
 }
 const sum=k=>cases.reduce((n,c)=>n+c[k],0),expected=sum('expected'),proposed=sum('proposed'),matches=sum('strict_matches');
 const report={format:'toolkit-prose-benchmark-report-v1',answer_key_status:key.status,cases:cases.length,expected_claims:expected,proposed_claims:proposed,strict_matches:matches,strict_draft_precision:proposed?matches/proposed:null,strict_draft_recall:expected?matches/expected:null,notice:'Draft mixed-source benchmark, not independently verified or representative accuracy. Field names are adapted but meanings, dates and units are not inferred or normalized. Wording differences count as mismatches. A match does not override blocking findings or approve a record. Expected claims require human spot-checking. No network, AI calls or automatic learning.',results:cases};
 const output=process.argv[2];if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await mf.dispose();}
