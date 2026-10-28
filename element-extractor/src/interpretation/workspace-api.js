import {workspaceShape,makeWorkspaceSnapshot,verifyWorkspaceSnapshot,schemaKey,quoteWorkspaceCSV,matchRecipe} from './workspace-core.js';
import {validatedWorkspaceJob} from './lab-api.js';
import {digest} from './pipeline.js';
import {publicURL} from '../public-network.js';
import {makeFeedbackSnapshot} from './feedback-snapshots.js';
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function workspaceAPI(request,env){
 const url=new URL(request.url),origin=request.headers.get('origin');if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Workspace requests must come from the same origin.'},403);
 if(request.method!=='POST'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Use JSON POST.'},405);
 try{
  const reader=request.body?.getReader();if(!reader)throw Error('JSON body required.');const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();return reply({error:'Workspace request exceeds 4 MB.'},413);}chunks.push(value);}
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}const body=JSON.parse(new TextDecoder().decode(buffer));
  if(body.action==='urls'){if(!Array.isArray(body.urls)||!body.urls.length||body.urls.length>10)throw Error('Add one to ten public HTTPS URLs.');return reply({urls:[...new Set(body.urls.map(value=>{const u=publicURL(value);u.hash='';return u.href;}))]});}
  if(body.action==='replace_job'){const old=await validatedWorkspaceJob(body.current),next=await validatedWorkspaceJob(body.job);if(!next.job.mapping||next.job.events.length||(next.job.revisions||[]).length||old.job.packet.source.text_hash!==next.job.packet.source.text_hash||old.job.packet.source.url!==next.job.packet.source.url)throw Error('Only an explicitly remapped, unreviewed copy of this source can replace its review.');return reply({job:next.job,counts:next.counts,schema_key:await schemaKey(next.job),columns:next.job.packet.schema.fields.map(f=>f.name)});}
  if(body.action==='update_job'){const old=await validatedWorkspaceJob(body.current),next=await validatedWorkspaceJob(body.job);if(old.job.packet.hash!==next.job.packet.hash)throw Error('This review belongs to a different source snapshot. Reopen it from the workspace.');const a=(await makeFeedbackSnapshot(old.job,null)).history,b=(await makeFeedbackSnapshot(next.job,null)).history;const prefix=(x,y)=>x.length<=y.length&&x.every((h,i)=>h===y[i]);if(prefix(b,a))return reply({stale:true});if(!prefix(a,b))throw Error('Conflicting review edits. Keep both histories and reopen the intended version; no update was applied.');return reply({job:next.job,counts:next.counts,schema_key:await schemaKey(next.job),columns:next.job.packet.schema.fields.map(f=>f.name)});}
  if(body.action==='match')return reply(matchRecipe(body.recipe,body.tables,body.url));
  if(body.action==='check_job'){const v=await validatedWorkspaceJob(body.job);return reply({job:v.job,counts:v.counts,schema_key:await schemaKey(v.job),columns:v.job.packet.schema.fields.map(f=>f.name)});}
  if(['save','snapshot','restore','export'].includes(body.action)){
   const w=body.action==='restore'?(await verifyWorkspaceSnapshot(body.snapshot)).workspace:workspaceShape(body.workspace);
   const checked=[];for(const entry of w.entries)if(entry.job)checked.push({entry,view:await validatedWorkspaceJob(entry.job),key:await schemaKey(entry.job)});
   if(body.action==='restore')return reply({workspace:w,groups:await groups(checked)});
   if(body.action==='snapshot')return reply({snapshot:await makeWorkspaceSnapshot(w)});
   if(body.action==='save'){
    const snapshot=await makeWorkspaceSnapshot(w);if(!env?.LOCAL_WORKSPACE)return reply({saved:false,snapshot,message:'Drive workspace storage is not connected. Download a portable workspace.'});
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return reply({error:'Drive workspace storage requires the local launcher.'},403);
    const response=await env.LOCAL_WORKSPACE.fetch(new Request('http://workspace/save',{method:'POST',body:JSON.stringify({action:'save',snapshot})}));const data=await response.json();return reply({...data,snapshot},response.status);
   }
   const selected=checked.filter(c=>c.key===body.schema_key&&c.entry.status==='ready');if(!selected.length)throw Error('Choose a compatible schema group first.');
   const fields=selected[0].entry.job.packet.schema.fields,rows=[];
   const reviewHashes=new Map();for(const {entry,view}of selected){const reviewHash=await digest(entry.job);reviewHashes.set(entry.id,reviewHash);for(const row of view.validation.records.filter(r=>r.review_status==='approved'))rows.push({source_id:entry.id,review_hash:reviewHash,source_url:entry.job.packet.source.url,source_label:entry.job.retrieval?.label||'Pasted source',snapshot_hash:entry.job.packet.source.text_hash,record_id:row.id,review_status:row.review_status,fields:row.fields});}
   if(body.format==='csv'){
    const header=['_toolkit_source_id','_toolkit_review_hash','_toolkit_source_url','_toolkit_source_label','_toolkit_snapshot_hash','_toolkit_record_id','_toolkit_review_status',...fields.map(f=>f.name)];
    const csv=[header,...rows.map(r=>[r.source_id,r.review_hash,r.source_url,r.source_label,r.snapshot_hash,r.record_id,r.review_status,...fields.map(f=>r.fields[f.name].value)])].map(r=>r.map(quoteWorkspaceCSV).join(',')).join('\r\n')+'\r\n';
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="workspace-approved.csv"','Cache-Control':'no-store'}});
   }
   if(body.format!=='json')throw Error('Choose CSV or JSON.');
   return reply({format:'toolkit-workspace-export-v1',name:w.name,schema:fields,records:rows,sources:selected.map(({entry})=>({source_id:entry.id,review_hash:reviewHashes.get(entry.id),requested_url:entry.url,url:entry.job.packet.source.url,packet:entry.job.packet,retrieval:entry.job.retrieval||null,review_history:entry.job.events,candidate_revision_history:entry.job.revisions||[]})),notice:'Approved records only; source packets retain full source text including unapproved content. Sources are not deduplicated or joined. Review names are self-declared.'});
  }
  if(!['list','read'].includes(body.action))throw Error('Unknown workspace action.');
  if(!env?.LOCAL_WORKSPACE)return reply({enabled:false,heads:[],conflicts:[],message:'Use the local launcher and connect Google Drive in Interpretation Lab.'});
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return reply({error:'Workspace storage requires a loopback host.'},403);
  const response=await env.LOCAL_WORKSPACE.fetch(new Request('http://workspace/'+body.action,{method:'POST',body:JSON.stringify(body)}));const data=await response.json();if(!response.ok)return reply(data,response.status);
  if(body.action==='read'){await verifyWorkspaceSnapshot(data.snapshot);for(const e of data.snapshot.workspace.entries)if(e.job)await validatedWorkspaceJob(e.job);}
  return reply(data);
 }catch(error){return reply({error:error.message},422);}
}
async function groups(checked){const result=[];for(const c of checked.filter(c=>c.entry.status==='ready')){let g=result.find(g=>g.key===c.key);if(!g){g={key:c.key,columns:c.entry.job.packet.schema.fields.map(f=>f.name),sources:0,approved:0,pending:0};result.push(g);}g.sources++;g.approved+=c.view.counts.approved;g.pending+=c.view.counts.pending;}return result;}
