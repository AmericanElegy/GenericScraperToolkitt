import { detectColumns, MAPPING_VERSION } from './column-mapping.js';
import { publicURL } from '../public-network.js';
import { planPage } from './page-intake.js';
import { decodeHTML } from 'entities';
import { createPacket, digest, ContractError } from './pipeline.js';
import { PROSE_SCHEMA, extractProseRules } from './prose-rules.js';
const error=(code,message)=>{throw new ContractError(code,message)};
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
async function articleBlocks(page) {
 const blocks=[],stack=[];let ignored=0,primary=0,size=0;
 await new HTMLRewriter()
  .on('script,style,template,noscript,nav,footer,header,form,table',{element(el){ignored++;el.onEndTag(()=>ignored--);}})
  .on('main,article',{element(el){primary++;el.onEndTag(()=>primary--);}})
  .on('p,h1,h2,h3,li',{element(el){const block={text:'',primary:primary>0,ignored:ignored>0};stack.push(block);el.onEndTag(()=>{if(stack.at(-1)===block)stack.pop();if(block.ignored)return;const text=decodeHTML(block.text).replace(/\s+/g,' ').trim();if(!text)return;size+=text.length;if(size>64000||blocks.length>=512)error('source_limit','Article text exceeds the 64,000-character / 512-block limit; use a smaller source.');blocks.push({...block,text});});}})
  .onDocument({text(chunk){if(stack.length&&!ignored)stack.at(-1).text+=chunk.text;}})
  .transform(new Response(page)).arrayBuffer();
 return (blocks.some(b=>b.primary)?blocks.filter(b=>b.primary):blocks).map(b=>b.text);
}
function tableDatasets(tables,issues) {
 const datasets=[];
 for(const [index,t] of tables.entries()) {
  const title=t.title||t.caption||'Table '+(index+1),table_key='source-table-'+(index+1);
  try {
   for(const note of t.capture_notes||[])issues.push(title+': '+note);
   if(t.unsupported&&!/nested/i.test(t.unsupported)&&/^(?:Major occupational group Percent of total employment Mean hourly wage|Occupation(?:\(1\))? Employment Mean wages)/i.test(t.headers.join(' '))){
    const flat=t.headers.join(' ')+' '+(t.rows[0]||[]).join(' ')+'\n\n'+t.rows.slice(1).map(row=>row.join(' ')).join('\n\n');
    const plan=planPage({text:flat});
    if(plan.datasets.some(d=>d.kind!=='prose')){
     let start=1;const total=plan.datasets.reduce((n,d)=>n+(d.row_count||0),0);
     for(const d of plan.datasets){datasets.push({kind:d.kind==='prose'?'prose':'table',label:title+' · '+d.label,text:d.text,row_count:d.row_count,column_count:d.kind==='prose'?null:d.schema.fields.length,table_key,row_start:start,total_columns:d.schema.fields.length});start+=d.row_count||0;}
     continue;
    }
   }
   if(t.unsupported||t.supported===false){issues.push(title+': '+(t.unsupported||t.issues?.join(' ')||'Unsupported table structure.'));continue;}
   if(!t.rows.length)continue;
   if(t.headers.length<2||t.headers.length>100){issues.push(title+': Import requires 2–100 source columns.');continue;}
   const groups=t.headers.length<=8?[t.headers.map((_,i)=>i)]:Array.from({length:Math.ceil((t.headers.length-1)/7)},(_,part)=>[0,...Array.from({length:Math.min(7,t.headers.length-1-part*7)},(_,i)=>1+part*7+i)]);
   const line=cells=>cells.map(c=>String(c).replace(/\s+/g,' ').trim()).join('\t');
   const local=[];
   for(const columns of groups){
    const header=line(columns.map(i=>t.headers[i]));
    if(header.length>2048)error('source_limit','A table header exceeds the evidence limit.');
    let batch=[],length=header.length,start=1;
    const range=columns.slice(1);const columnLabel=groups.length===1?'': ' · '+(columns.at(-1)<8?'columns 1–'+columns.length:'shared column 1 + columns '+(range[0]+1)+(range.length>1?'–'+(range.at(-1)+1):''))+' of '+t.headers.length;
    const flush=()=>{if(!batch.length)return;const text=header+'\n'+batch.join('\n');
     const mapping=detectColumns(text,MAPPING_VERSION,true);
     if(!mapping)error('table_mapping','Source column headings cannot be mapped; no zero-record table was reported as imported.');
     local.push({kind:'table',label:title+' · rows '+start+'–'+(start+batch.length-1)+' of '+t.rows.length+columnLabel,text,row_count:batch.length,column_count:columns.length,table_key,row_start:start,total_columns:t.headers.length,column_indices:columns});start+=batch.length;batch=[];length=header.length;};
    for(const row of t.rows){const value=line(columns.map(i=>row[i]??''));if(value.length>2048)error('source_limit','A table row exceeds the 2,048-character evidence limit.');if(batch.length===24||length+value.length+1>12000)flush();batch.push(value);length+=value.length+1;}
    flush();
   }
   if(groups.length>1)issues.push(title+': '+t.headers.length+' source columns are split into '+groups.length+' column groups of up to eight. The shared first column supplies context, not a proven unique join key.');
   datasets.push(...local);
  }catch(e){issues.push(title+': Not imported — '+e.message);}
 }
 return datasets;
}
function proseDatasets(blocks) {
 const datasets=[];let batch=[],length=0;
 const flush=()=>{if(batch.length)datasets.push({kind:'prose',label:'Article text · part '+(datasets.length+1),text:batch.join('\n\n'),row_count:null});batch=[];length=0;};
 for(const block of blocks){if(block.length>12000)error('source_limit','One article block exceeds 12,000 characters; use a smaller source.');if(batch.length===24||length+block.length+2>12000)flush();batch.push(block);length+=block.length+2;}flush();return datasets;
}
export async function sourceFetch(request,url,env,{fetchPage,analyze}) {
 const checks=[],issues=[];
 if(request.method!=='POST')return reply({error:'POST required'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'Cross-origin fetching is blocked.'},403);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return reply({error:'JSON required'},415);
 try {
  const reader=request.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
  if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();return reply({error:'Fetch request exceeds 4 KiB.'},413);}text+=decoder.decode(value,{stream:true});}}finally{reader.releaseLock();}
  text+=decoder.decode();
  let body;try{body=JSON.parse(text)}catch{return reply({error:'Invalid JSON'},400);}
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='url')||typeof body.url!=='string')return reply({error:'Provide one public HTTPS URL.'},400);
  const {source:fetchedSource,page}=await fetchPage(body.url,url.hostname);let source=fetchedSource;
  checks.push({method:'static-html',status:'passed',message:'Public HTTPS page fetched within network and size checks.'});
  const analysis=await analyze(page,source,[],{sourceImport:true});
  for(const item of analysis.discovery?.inventory||[])if(item.status==='omitted')issues.push(item.title+': Not imported — '+item.reason);
  if(analysis.code==='possible_access_barrier')error('access_barrier',analysis.message);
  let datasets=tableDatasets(analysis.tables,issues),method='static-html';
  let prose=[];try{prose=proseDatasets(await articleBlocks(page));}catch(e){issues.push('Article text not imported: '+e.message);}
  let supportedProse=false;
  if(!datasets.length)for(const part of prose){const packet=await createPacket({source:{text:part.text,url:source},schema:PROSE_SCHEMA});if(extractProseRules(packet).records.length){supportedProse=true;break;}}
  const jsNeeded=!datasets.length&&!supportedProse&&analysis.tables.every(t=>!t.rows.length&&!t.unsupported)&&analysis.signals.app_roots>0&&analysis.signals.linked_scripts>0;
  if(jsNeeded){
   checks.push({method:'static-html',status:'no_supported_records',message:'No usable table or recognized prose facts; application container and linked scripts indicate possible client rendering.'});
   if(!env?.LOCAL_RENDERER){return reply({error:'This page may need JavaScript. Automatic rendering is available through the local npm run dev server with an installed Chrome, Edge or Chromium browser.',code:'renderer_unavailable',source,checks,issues},422);}
   try {
    const response=await env.LOCAL_RENDERER.fetch(new Request('https://local-renderer/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:source})}));
    const rendered=await response.json();if(!response.ok)throw Error(rendered.error||'Local renderer failed.');
    source=publicURL(rendered.final_url||source).href;
    method='local-chromium';datasets=tableDatasets(rendered.tables,issues);
    if(!datasets.length&&rendered.article_blocks?.length)datasets=proseDatasets(rendered.article_blocks);
    checks.push({method,status:datasets.length?'passed':'no_supported_records',message:rendered.diagnostics.message});
    for(const blocked of rendered.diagnostics.blocked_resources||[])issues.push('Blocked resource: '+blocked.reason);
    if(!datasets.length){return reply({error:'Ordinary fetching and JavaScript rendering found no importable tables. Images, canvas, login barriers, pagination and unsupported layouts are not interpreted.',code:'both_methods_no_data',source,checks,issues},422);}
   }catch(e){return reply({error:'Ordinary fetching found no supported records. Local JavaScript rendering failed: '+e.message,code:'render_failed',source,checks:[...checks,{method:'local-chromium',status:'failed',message:e.message}],issues},422);}
  } else datasets.push(...prose);
  if(!datasets.length)return reply({error:issues.length?'No importable selections: '+issues.join(' '):analysis.message||'No supported tables or article text found.',code:'no_importable_content',source,checks,issues,discovery:analysis.discovery},422);
  let size=0,omitted=0,selectedCount=0;datasets=datasets.filter(d=>{if(selectedCount>=32||size+d.text.length>128000){omitted++;return false;}size+=d.text.length;selectedCount++;return true;});
  if(omitted)issues.push(omitted+' selections were not imported because the 32-selection / 128,000-character budget was reached. Use a narrower source or paste a selected section.');
  const retrieved_at=new Date().toISOString();
  for(const [i,d] of datasets.entries()){d.id='retrieved-'+(i+1);d.snapshot_hash=await digest(d.text);}
  return reply({source,method,retrieved_at,datasets,checks,issues,discovery:analysis.discovery,notice:'Normalized text snapshots, not raw HTML or authenticated source proofs. Choose content to start a new unapproved review; saved reviews retain their source snapshot. Rendering is a timed snapshot and may omit later updates.'});
 }catch(e){return reply({error:e.message,code:e.code||'fetch_stopped',checks:[...checks,{method:'static-html',status:'failed',message:e.message}],issues},e.status||422);}
}
