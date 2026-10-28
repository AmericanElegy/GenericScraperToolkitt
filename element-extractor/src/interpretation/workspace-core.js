// Batch work retains independent source reviews. No merging by guessed entity identity.
import {canonical,digest,ContractError} from './pipeline.js';
import {publicURL} from '../public-network.js';
const fail=message=>{throw new ContractError('workspace',message);};
const safeText=(s,max)=>typeof s==='string'&&s.trim()&&s.length<=max;
export const WORKSPACE_FORMAT='toolkit-workspace-v1';
export function validateRecipe(r){
 if(!r||r.version!=='table-recipe-v1'||!safeText(r.id,64)||!safeText(r.name,100)||!safeText(r.host,253)||!Array.isArray(r.headers)||r.headers.length<2||r.headers.length>100||r.headers.some(h=>!safeText(h,2048))||!Array.isArray(r.columns)||r.columns.length<2||r.columns.length>8||new Set(r.columns).size!==r.columns.length||r.columns.some(i=>!Number.isInteger(i)||i<0||i>=r.headers.length)||!Number.isInteger(r.first_row)||!Number.isInteger(r.last_row)||r.first_row<1||r.last_row<r.first_row||r.last_row-r.first_row>=50||r.title!==null&&(!safeText(r.title,2048)))fail('Saved table settings are invalid.');
 return r;
}
export function matchRecipe(recipe,tables,url){
 validateRecipe(recipe);if(new URL(publicURL(url)).hostname!==recipe.host)return {status:'no_match',reason:'The saved settings belong to a different hostname.'};
 const matches=tables.filter(t=>t.source_columns===recipe.headers.length&&t.columns.length===recipe.headers.length&&t.columns.every((c,i)=>c.index===i&&c.label===recipe.headers[i])&&(recipe.title===null||t.title===recipe.title));
 if(matches.length!==1)return {status:matches.length?'ambiguous':'no_match',reason:matches.length?'More than one table has these headings. Choose a table manually.':'The source headings or caption changed. Choose a table manually.'};
 return {status:'matched',table:matches[0],options:{columns:recipe.columns,first_row:recipe.first_row,last_row:recipe.last_row}};
}
export function workspaceShape(w){
 if(!w||w.format!==WORKSPACE_FORMAT||!/^[-a-zA-Z0-9]{8,64}$/.test(w.id)||!safeText(w.name,100)||!Array.isArray(w.recipes)||w.recipes.length>20||!Array.isArray(w.entries)||w.entries.length>10||!Array.isArray(w.history)||w.history.length>200||w.history.some(h=>!/^[a-f0-9]{64}$/.test(h)))fail('Workspace supports ten sources, twenty saved settings and 200 saved revisions.');
 if(w.modified_at!==undefined&&(typeof w.modified_at!=='string'||!Number.isFinite(Date.parse(w.modified_at))))fail('Workspace modification time is invalid.');
 if(new Set(w.recipes.map(r=>r.id)).size!==w.recipes.length)fail('Saved setting IDs must be distinct.');w.recipes.forEach(validateRecipe);
 const ids=new Set();for(const entry of w.entries){if(!entry||!safeText(entry.id,64)||ids.has(entry.id)||!['queued','fetching','select','ready','failed'].includes(entry.status)||typeof entry.message!=='string'||entry.message.length>1000)fail('Workspace source entries are invalid.');ids.add(entry.id);publicURL(entry.url);if(entry.job)publicURL(entry.job.packet.source.url);}
 if(new TextEncoder().encode(canonical(w)).byteLength>3500000)fail('Workspace exceeds 3.5 MB. Keep fewer source snapshots or export separate workspaces.');
 return w;
}
export async function makeWorkspaceSnapshot(w){workspaceShape(w);const workspace=structuredClone(w);const id=await digest(workspace);return {format:'toolkit-workspace-snapshot-v1',id,workspace};}
export async function verifyWorkspaceSnapshot(s){if(!s||s.format!=='toolkit-workspace-snapshot-v1'||s.id!==await digest(s.workspace))fail('Saved workspace checksum differs.');workspaceShape(s.workspace);return s;}
export function workspaceHeads(snapshots){
 const groups=new Map();for(const s of snapshots){const key=s.workspace.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
 const heads=[],conflicts=[];for(const [id,items]of groups){
  const tips=items.filter(a=>!items.some(b=>b.workspace.history.includes(a.id)));
  if(tips.length!==1){conflicts.push({id,name:items[0].workspace.name,versions:tips.map(s=>s.id)});continue;}
  heads.push({id:tips[0].id,workspace_id:id,name:tips[0].workspace.name,sources:tips[0].workspace.entries.length,modified_at:tips[0].workspace.modified_at||null});
 }return {heads:heads.sort((a,b)=>(b.modified_at||'').localeCompare(a.modified_at||'')),conflicts};
}
export const quoteWorkspaceCSV=value=>{let s=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export async function schemaKey(job){return digest(job.packet.schema);}
