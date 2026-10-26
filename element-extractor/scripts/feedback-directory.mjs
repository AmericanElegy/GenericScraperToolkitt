// Local-only persistence. Drive for desktop owns synchronization and authentication.
import {readFile,mkdir,stat,lstat,readdir,rename,unlink,open,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {canonical} from '../src/interpretation/pipeline.js';
import {checkSnapshotHash,activeSnapshots} from '../src/interpretation/feedback-snapshots.js';
const FOLDER=join('Web Table Toolkit','feedback');
const MAX_FILES=250,MAX_BYTES=100000000;
export async function discoverDriveRoots(platform=process.platform){
 if(platform!=='win32')return [];
 const roots=[];
 for(const letter of 'DEFGHIJKLMNOPQRSTUVWXYZABC'){
  const path=letter+':\\My Drive';try{if((await stat(path)).isDirectory())roots.push(path);}catch{}
 }
 for(const path of [join(homedir(),'Google Drive','My Drive'),join(homedir(),'Google Drive')]){try{if((await stat(path)).isDirectory())roots.push(path);}catch{}}
 const distinct=new Map();for(const root of roots)distinct.set((await realpath(root)).toLowerCase(),root);return [...distinct.values()];
}
async function atomicWrite(path,value){
 const temp=path+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temp,'wx',0o600);await handle.writeFile(value);await handle.sync();await handle.close();handle=null;await rename(temp,path);}finally{await handle?.close();await unlink(temp).catch(()=>{});}
}
export async function createFeedbackDirectory(options={}){
 const configFile=options.configFile||join(process.env.TOOLKIT_CONFIG_DIR||join(process.env.LOCALAPPDATA||join(homedir(),'.config'),'WebTableToolkit'),'feedback-storage.json');
 let root=options.driveRoot||process.env.TOOLKIT_DRIVE_ROOT||null,configurationProblem=null;
 if(!root){try{const cfg=JSON.parse(await readFile(configFile,'utf8'));if(typeof cfg.drive_root==='string'&&isAbsolute(cfg.drive_root))root=cfg.drive_root;}catch(e){if(e.code!=='ENOENT')configurationProblem='Feedback settings could not be read. Reconnect the Drive folder to repair local settings.';}}
 async function configure(path){
  if(typeof path!=='string'||!isAbsolute(path)||!(await stat(path)).isDirectory())throw Error('Select an existing absolute Google Drive folder path.');
  const resolved=await realpath(path);
  await mkdir(join(configFile,'..'),{recursive:true});
  await atomicWrite(configFile,JSON.stringify({format:'toolkit-feedback-directory-v1',drive_root:resolved},null,2)+'\n');root=resolved;configurationProblem=null;return status();
 }
 if(root&&!isAbsolute(root)){root=null;configurationProblem='TOOLKIT_DRIVE_ROOT must be an absolute existing Drive folder path.';}
 if(!root&&!configurationProblem){try{const candidates=await (options.discover||discoverDriveRoots)();if(candidates.length===1)await configure(candidates[0]);}catch(e){configurationProblem='Automatic Drive setup failed: '+e.message;}}
 async function status(){
  if(!root)return {enabled:false,message:configurationProblem||'Choose your Google Drive folder once to enable automatic feedback saving.'};
  try{if(!(await stat(root)).isDirectory())throw Error();return {enabled:true,directory:join(root,FOLDER),message:'Feedback will save to this folder. Google Drive synchronization is not verified by this app.'};}
  catch{return {enabled:false,configured:true,directory:join(root,FOLDER),message:'The configured Drive folder is unavailable. Reconnect Drive; portable downloads still work.'};}
 }
 async function directory(create=false){
  if(!(await status()).enabled)throw Error('Google Drive folder is unavailable or has not been configured. Feedback has not been saved to disk.');
  const path=join(root,FOLDER);
  for(const part of [join(root,'Web Table Toolkit'),path]){
   try{const info=await lstat(part);if(!info.isDirectory()||info.isSymbolicLink())throw Error('The dedicated feedback folder must be a direct directory, not a linked or redirected path.');}
   catch(e){if(e.code!=='ENOENT')throw e;if(create){try{await mkdir(part);}catch(created){if(created.code!=='EEXIST')throw created;}const info=await lstat(part);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Feedback folder changed during creation.');}}
  }
  return path;
 }
 async function read(id){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid saved feedback ID.');
  const path=join(await directory(),id+'.json'),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>1000000)throw Error('Saved feedback is not a bounded regular file.');
  const snapshot=JSON.parse(await readFile(path,'utf8'));await checkSnapshotHash(snapshot);
  if(snapshot.id!==id)throw Error('Feedback filename and checksum disagree.');return snapshot;
 }
 async function inventory(){
  const path=await directory();let files;
  try{files=(await readdir(path)).filter(f=>f.endsWith('.json'));}catch(e){if(e.code==='ENOENT')return {snapshots:[],bytes:0};throw e;}
  if(files.length>MAX_FILES)throw Error('Saved feedback exceeds 250 snapshots. Archive older files to a separate folder before continuing.');
  const snapshots=[];let bytes=0;
  for(const file of files){if(!/^[a-f0-9]{64}\.json$/.test(file))throw Error('An unexpected JSON file is in the feedback folder. Move unrelated files elsewhere; loading paused.');
   const info=await lstat(join(path,file));bytes+=info.size;if(bytes>MAX_BYTES)throw Error('Feedback folder exceeds 100 MB. Archive older files before continuing.');
   try{snapshots.push(await read(file.slice(0,-5)));}catch(e){throw Error('Saved feedback needs attention ('+file.slice(0,12)+'): '+e.message+' Loading paused to avoid restoring stale review decisions.');}
  }
  return {snapshots,bytes};
 }
 async function list(){
  const {snapshots}=await inventory(),selection=activeSnapshots(snapshots);
  const order=(a,b)=>{const aj=a.example?.job||a.job,bj=b.example?.job||b.job;return (bj.events.at(-1)?.at||bj.packet.source.received_at).localeCompare(aj.events.at(-1)?.at||aj.packet.source.received_at);};
  const active=selection.active.sort(order),reviews=selection.heads.sort(order);
  return {reviews:reviews.map(s=>({id:s.id,session:s.session})),review_count:reviews.length,active:active.map(s=>({id:s.id,session:s.session})),conflicts:selection.conflicts,snapshot_count:snapshots.length,active_count:active.length};
 }
 async function save(snapshot){
  await checkSnapshotHash(snapshot);const value=canonical(snapshot)+'\n';if(Buffer.byteLength(value)>1000000)throw Error('Saved snapshot exceeds 1 MB.');
  const path=await directory(true),existing=await inventory();
  const found=existing.snapshots.find(s=>s.id===snapshot.id);
  if(!found){if(existing.snapshots.length>=MAX_FILES||existing.bytes+Buffer.byteLength(value)>MAX_BYTES)throw Error('Feedback storage capacity reached. Download or archive older snapshots before continuing.');await atomicWrite(join(path,snapshot.id+'.json'),value);}
  return {saved:true,id:snapshot.id,...await list(),message:'Saved locally in the configured Drive folder. Cloud synchronization is not verified.'};
 }
 async function fetch(request){
  try{const body=await request.json();let data;
   if(body.action==='status')data=await status();else if(body.action==='configure')data=await configure(body.drive_root);else if(body.action==='list')data=await list();else if(body.action==='read')data={snapshot:await read(body.id)};else if(body.action==='save')data=await save(body.snapshot);else throw Error('Unknown local feedback action.');
   return Response.json(data);
  }catch(e){return Response.json({error:e.message},{status:422});}
 }
 return {fetch,status,configure,list,read,save};
}
