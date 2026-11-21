// Bounded opt-in evaluation. Credentials are local; no hosted paid endpoint is enabled.
import {readFile,writeFile,mkdir}from 'node:fs/promises';import {createHash}from 'node:crypto';import {join}from 'node:path';
import {unzipSync,strFromU8}from 'fflate';import {DOMParser}from '@xmldom/xmldom';
import {Miniflare,convertV4MiniflareOptions}from 'miniflare';import {createPacket,validateResponse}from '../src/interpretation/pipeline.js';import {scoreTable}from '../src/interpretation/extraction-benchmark.js';import {localSecrets}from './local-secrets.mjs';import {extractWithProvider}from './ai-provider.mjs';
import {normalizeProviderMetadata}from '../src/interpretation/provider-contract.js';
if(!process.argv.includes('--approved-five-dollar-evaluation'))throw Error('This command requires the explicit evaluation authorization flag. No paid calls were sent.');
const directory='.wrangler/ai-evaluation';await mkdir(directory,{recursive:true});
const manifest=JSON.parse(await readFile('test/fixtures/extraction-benchmark/expected.json','utf8')),secrets=await localSecrets(),cases=[];
for(const c of manifest.cases){
 const bytes=await readFile('test/fixtures/extraction-benchmark/'+c.input);let text=bytes.toString('utf8');
 if(createHash('sha256').update(text.replace(/\r\n?/g,'\n')).digest('hex')!==c.input_sha256)throw Error('Source fixture changed; AI evaluation stopped before sending.');
 if(c.input_kind==='html'){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('worker-code.txt','utf8'),compatibilityDate:'2026-10-01',outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(bytes,{headers:{'content-type':'text/html'}})}));
  try{const r=await mf.dispatchFetch('https://toolkit.example.org/api/interpretation/fetch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:c.url})});const value=await r.json();if(!r.ok)throw Error(value.error);const d=value.datasets.find(d=>d.kind==='table'&&JSON.stringify(d.table_preview?.headers)===JSON.stringify(c.headers));if(!d)throw Error('Target table not captured.');text=d.text;}finally{await mf.dispose();}
 }
 cases.push({id:c.id,source:{text,url:c.url},schema:{fields:c.columns.map((name,i)=>({name,type:c.id==='simple'||i===0?'string':'number',required:true,...(c.id!=='simple'&&i>0?{number_format:'en-US-grouped'}:{})}))},task:{description:'Extract every row of the selected table into the requested columns. Keep source row order. Preserve percentages as 0–100 and dollar amounts as literal numbers; distinguish national from Jacksonville values. Do not infer or add rows.',diagram_relevance:'supplementary',relevance_note:'The task is extracting the supplied text table.'},expected:c});
}
if(process.env.TOOLKIT_DOCX_FIXTURE){
 const bytes=await readFile(process.env.TOOLKIT_DOCX_FIXTURE),zip=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(zip['word/document.xml']),'text/xml');
 const paragraphs=Array.from(xml.getElementsByTagName('w:p')).map(p=>Array.from(p.getElementsByTagName('w:t')).map(t=>t.textContent).join('')).filter(t=>t.trim());
 const start=paragraphs.findIndex(t=>t.trim()==='Materials'),end=paragraphs.findIndex((t,i)=>i>start&&t.trim()==='Procedure'),reaction=paragraphs.findIndex(t=>t.trim()==='Assemble the reaction mixture.');
 if(start<0||end<0||reaction<0)throw Error('Private document task boundaries were not found. No model call was sent for it.');
 const task=(description)=>({description,diagram_relevance:'supplementary',relevance_note:'The reaction and apparatus diagrams are supplementary for these text-only material and quantity tasks. They were not transmitted or interpreted.'});
 cases.push({id:'chemistry-materials',source:{text:paragraphs.slice(start,end).join('\n\n'),url:null},schema:{fields:[{name:'material',type:'string',required:true}]},task:task('Extract exactly the explicitly listed materials under the Materials heading, one row per listed item. Preserve the full material wording. Do not split combined items, add inferred equipment, or extract procedure instructions.'),expected:{columns:['material'],rows:manifest.mixed_case.desired_materials.map(m=>[m])}});
 cases.push({id:'chemistry-quantities',source:{text:paragraphs.slice(reaction).join('\n\n'),url:null},schema:{fields:[{name:'subject',type:'string',required:true},{name:'amount',type:'number',required:true},{name:'unit',type:'string',required:true},{name:'qualifier',type:'string',required:false}]},task:task('Extract only the three initial reagent additions and the heating-under-reflux duration. Exclude washing, drying, containers and purification quantities. Use the subject wording in the source; use heating under reflux as the duration subject. Preserve an explicit approximation in qualifier; otherwise null. Keep the source units without conversion.'),expected:{columns:['subject','amount','unit','qualifier'],rows:manifest.mixed_case.desired_facts.map(f=>[f.subject,f.value,f.unit,f.qualifier||null])}});
}
const results=[];let stopped=false;
for(const provider of ['openai','anthropic'])for(const c of cases){
 if(stopped)break;
 const packet=await createPacket({source:c.source,schema:c.schema}),hash=createHash('sha256').update(JSON.stringify({packet:packet.source.text_hash,schema:c.schema,task:c.task})).digest('hex');
 const compatibleHash=createHash('sha256').update(JSON.stringify({packet:packet.source.text_hash,schema:{fields:c.schema.fields.map(({number_format,...f})=>f)},task:c.task})).digest('hex');
 const output=join(directory,provider+'-'+c.id+'.json');let result;
 try{
  const prior=JSON.parse(await readFile(output,'utf8').catch(()=>'{"missing":true}'));
  if((prior.evaluation_hash===hash||prior.evaluation_hash===compatibleHash)&&prior.result)result=prior.result;
  else{result=await extractWithProvider({provider,key:secrets[provider],packet,task:c.task,directory});await writeFile(output,JSON.stringify({evaluation_hash:hash,result},null,2)+'\n',{mode:0o600});}
  const normalized=normalizeProviderMetadata(result.candidates);
  const validation=await validateResponse(packet,normalized.candidates),actual=validation.records.map(r=>Object.fromEntries(Object.entries(r.fields).map(([k,f])=>[k,f.value])));
  const invalid=validation.issues.length+validation.records.reduce((n,r)=>n+Object.values(r.fields).reduce((v,f)=>v+f.issues.length,0),0);
  const quality=scoreTable(c.expected,actual),proposal={format:'toolkit-ai-proposal-v1',source:{text:packet.source.text,url:packet.source.url},schema:c.schema,task:c.task,processing_notes:normalized.notes,proposal:{provider,model:result.model,source_hash:packet.source.text_hash,candidates:normalized.candidates}};
  await writeFile(join(directory,provider+'-'+c.id+'-proposal.json'),JSON.stringify(proposal,null,2)+'\n',{mode:0o600});
  results.push({provider,case:c.id,model:result.model,...quality,processing_notes:normalized.notes,invalid_evidence_or_accounting:invalid,usage:result.usage,usage_cost_usd:result.usage_cost_usd,reserved_usd:result.reserved_usd,latency_ms:result.latency_ms});
  console.log(provider+' / '+c.id+': '+quality.exact_rows+'/'+quality.expected_rows+' exact rows; '+invalid+' evidence/accounting issues.');
 }catch(e){results.push({provider,case:c.id,status:'stopped',message:e.message});stopped=true;console.log(provider+' evaluation stopped: '+e.message);}
 await writeFile(join(directory,'comparison.json'),JSON.stringify({checked_at:new Date().toISOString(),scope:'Current five-dollar comparison only',results,notice:'Token costs are estimates at the verified uncached standard rates; provider invoices remain authoritative. No automatic retry, approvals, or coverage completion.'},null,2)+'\n');
}
if(stopped)process.exitCode=1;
