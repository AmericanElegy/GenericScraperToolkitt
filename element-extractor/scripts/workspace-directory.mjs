import {mkdir,lstat,readdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyWorkspaceSnapshot,workspaceHeads} from '../src/interpretation/workspace-core.js';
import {canonical} from '../src/interpretation/pipeline.js';
export function createWorkspaceDirectory(feedback){
 async function directory(create=false){
  const status=await feedback.status();if(!status.enabled)throw Error('Connect your Google Drive folder in Interpretation Lab first.');
  const root=dirname(status.directory),path=join(root,'workspaces');
  for(const part of [root,path]){try{const s=await lstat(part);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Workspace folders cannot be linked or redirected.');}catch(e){if(e.code!=='ENOENT')throw e;if(create){await mkdir(part).catch(e=>{if(e.code!=='EEXIST')throw e;});const s=await lstat(part);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Workspace folder changed during creation.');}}}return path;
 }
 async function read(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid workspace snapshot ID.');const path=join(await directory(),id+'.json'),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>4000000)throw Error('Invalid workspace file.');const snapshot=JSON.parse(await readFile(path,'utf8'));await verifyWorkspaceSnapshot(snapshot);if(snapshot.id!==id)throw Error('Workspace filename differs from checksum.');return snapshot;}
 async function list(){
  const status=await feedback.status();if(!status.enabled)return {enabled:false,heads:[],conflicts:[],message:status.message};
  let files;try{files=(await readdir(await directory())).filter(f=>f.endsWith('.json'));}catch(e){if(e.code==='ENOENT')return {enabled:true,heads:[],conflicts:[]};throw e;}
  if(files.length>200)throw Error('Workspace store exceeds 200 snapshots. Archive older histories before continuing.');
  const snapshots=[];let bytes=0;for(const f of files){if(!/^[a-f0-9]{64}\.json$/.test(f))throw Error('Unexpected JSON in workspace folder. Loading paused.');const s=await lstat(join(await directory(),f));bytes+=s.size;if(bytes>100000000)throw Error('Workspace history exceeds 100 MB. Archive older workspaces.');snapshots.push(await read(f.slice(0,-5)));}
  return {enabled:true,...workspaceHeads(snapshots),snapshot_count:snapshots.length,bytes};
 }
 async function save(snapshot){
  await verifyWorkspaceSnapshot(snapshot);const path=await directory(true),value=canonical(snapshot)+'\n';if(Buffer.byteLength(value)>4000000)throw Error('Workspace snapshot exceeds 4 MB.');
  const existing=await list();try{await read(snapshot.id);return {saved:true,...existing,message:'Workspace saved locally. Drive synchronization is not verified.'};}catch(e){if(e.code!=='ENOENT')throw e;}
  if(existing.snapshot_count>=200||existing.bytes+Buffer.byteLength(value)>100000000)throw Error('Workspace storage capacity reached. Archive older snapshots.');
  const temp=join(path,snapshot.id+'.'+randomUUID()+'.tmp');let handle;
  try{handle=await open(temp,'wx',0o600);await handle.writeFile(value);await handle.sync();await handle.close();handle=null;await rename(temp,join(path,snapshot.id+'.json'));}finally{await handle?.close();await unlink(temp).catch(()=>{});}
  return {saved:true,...await list(),message:'Workspace saved locally. Drive synchronization is not verified.'};
 }
 return {read,list,save,async fetch(request){try{const b=await request.json();return Response.json(b.action==='list'?await list():b.action==='read'?{snapshot:await read(b.id)}:b.action==='save'?await save(b.snapshot):(()=>{throw Error('Unknown workspace action.');})());}catch(e){return Response.json({error:e.message},{status:422});}}};
}
