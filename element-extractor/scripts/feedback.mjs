// Offline, explicit regression feedback. Sources are snapshots, never fetched here.
import {readFile,writeFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {canonical} from '../src/interpretation/pipeline.js';
import {COLLECTION_FORMAT,FEEDBACK_FORMAT,compareFeedback} from '../src/interpretation/feedback.js';
const [command,...args]=process.argv.slice(2);
const usage='Usage: npm run feedback -- collect <new-collection.json> <case-or-collection.json> [...]\n       npm run feedback -- check <case-or-collection.json> [...]';
let mf;
try{
 if(!['collect','check'].includes(command)||args.length<(command==='collect'?2:1))throw Error(usage);
 const output=command==='collect'?args.shift():null,cases=[];
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',outboundService:()=>{throw Error('Feedback checks cannot fetch external sources.')}}));
 const post=async(path,body)=>{const r=await mf.dispatchFetch('https://feedback.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||'Feedback validation failed.');return v;};
 for(const path of args){
  const bytes=await readFile(path);if(bytes.length>5000000)throw Error('Feedback input exceeds 5 MB.');
  const file=JSON.parse(bytes),items=file.format===COLLECTION_FORMAT?file.cases:file.format===FEEDBACK_FORMAT?[file]:null;
  if(!Array.isArray(items)||!items.length||items.length>20)throw Error('Choose a feedback case or a collection with 1–20 cases.');
  for(const item of items){
   const actual=await post('/api/interpretation/action',{action:'feedback',job:item.job});
   if(canonical(actual)!==canonical(item))throw Error('Feedback differs from validated source, corrections or review history.');
   if(!cases.some(c=>c.id===actual.id))cases.push(actual);
  }
 }
 if(cases.length>20)throw Error('A feedback collection supports up to 20 cases.');
 if(command==='collect'){
  const content=JSON.stringify({format:COLLECTION_FORMAT,cases},null,2)+'\n';if(Buffer.byteLength(content)>5000000)throw Error('Combined collection exceeds 5 MB.');
  await writeFile(output,content,{flag:'wx'});console.log('Saved '+cases.length+' distinct reviewed examples to '+output+'. Existing files are never overwritten.');
 }else{
  const results=[];
  for(const item of cases){
   try{
    const job=item.job,body=job.example_id==='custom-text'?{example_id:'custom-text',source:job.document?.source||job.packet.source,mode:job.parser_version==='name-number-v1'?'pair':'auto'}:{example_id:job.example_id};
    if(body.source)body.source={text:body.source.text,url:body.source.url};
    if(job.parser_version==='name-number-v1')body.schema=job.packet.schema;
    if(job.mapping)body.mapping=job.mapping;
    if(job.document)body.dataset_id=job.document.dataset_id;
    if(job.retrieval)body.retrieval=job.retrieval;
    const current=await post('/api/interpretation/start',body);
    if(current.job.packet.source.text_hash!==job.packet.source.text_hash)throw Error('Selected source section changed; compare section boundaries before accepting the new result.');
    const comparison=compareFeedback(item.expectations,current,item.baseline);
    results.push({id:item.id,source:job.packet.source.url||null,previous_parser:job.parser_version||'scripted',current_parser:current.job.parser_version||'scripted',...comparison});
   }catch(error){results.push({id:item.id,status:'check_failed',error:error.message});}
  }
  const report={format:'toolkit-feedback-report-v1',checked_at:new Date().toISOString(),cases:results,summary:{cases:results.length,regressions:results.filter(r=>r.status==='regression'||r.status==='check_failed').length,known_issue_cases:results.filter(r=>r.status==='known_issues').length},notice:'Partial reviewed examples only. This is not a representative accuracy estimate, completeness guarantee or automatic learning. Current rules are run without replaying human corrections.'};
  console.log(JSON.stringify(report,null,2));
  if(results.some(r=>r.status!=='reviewed_checks_passed'))process.exitCode=1;
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{await mf?.dispose();}
