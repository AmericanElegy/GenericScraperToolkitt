import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rename,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createFeedbackDirectory} from '../scripts/feedback-directory.mjs';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const post=(mf,path,body,headers={})=>mf.dispatchFetch('http://127.0.0.1'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const action=(mf,job,action,extra={})=>post(mf,'/api/interpretation/action',{job,action,...extra});
const storage=(mf,body,headers)=>post(mf,'/api/interpretation/storage',body,headers);
const setup=store=>new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',...(store?{serviceBindings:{LOCAL_FEEDBACK:r=>store.fetch(r)}}:{})}));
const start=async mf=>(await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:'Name\tScore\nAlpha\t98.6\nBeta\t95.1'}})).json();
async function review(mf,job,decision='approved',note='Compared the literal fields and association.'){
 const r=await action(mf,job,'review',{decision:{record_id:'row-1',decision,reviewer:'Storage test',note,confirmed_association:true}});assert.equal(r.status,200);return r.json();
}

test('Drive feedback survives server replacement, selects latest review, and retains withdrawal history without stale approvals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-storage-')),configFile=join(dir,'profile','feedback.json');let mf;
 try{
  let store=await createFeedbackDirectory({driveRoot:dir,configFile});mf=setup(store);
  let v=await review(mf,(await start(mf)).job);let response=await storage(mf,{action:'save',job:v.job});assert.equal(response.status,200);const first=await response.json();assert.equal(first.saved,true);assert.equal(first.active_count,1);
  await storage(mf,{action:'save',job:v.job});assert.equal((await store.list()).snapshot_count,1,'Repeated saves are idempotent.');
  await mf.dispose();store=await createFeedbackDirectory({driveRoot:dir,configFile});mf=setup(store);
  const listed=await (await storage(mf,{action:'list'})).json();assert.equal(listed.active.length,1);
  const loaded=await (await storage(mf,{action:'read',id:listed.active[0].id})).json();assert.equal(loaded.snapshot.example.expectations.approved[0].values.score,98.6);
  v=await review(mf,loaded.snapshot.example.job,'needs_review','Withdraw this approval for another look.');response=await storage(mf,{action:'save',job:v.job});assert.equal(response.status,200);const withdrawn=await response.json();assert.equal(withdrawn.snapshot.example,null);assert.equal(withdrawn.active_count,0);assert.equal(withdrawn.snapshot_count,2);
  assert.equal((await storage(mf,{action:'read',id:first.id})).status,200,'Old review retained as history, not active truth.');
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('divergent machine edits stay immutable and are excluded rather than silently choosing a winner',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-conflicts-'));const store=await createFeedbackDirectory({driveRoot:dir,configFile:join(dir,'profile.json')}),mf=setup(store);
 try{
  const base=await start(mf),a=await review(mf,base.job),b=await review(mf,base.job,'rejected','Different machine disagrees with the association.');
  await storage(mf,{action:'save',job:a.job});const saved=await (await storage(mf,{action:'save',job:b.job})).json();assert.equal(saved.snapshot_count,2);assert.equal(saved.active_count,0);assert.deepEqual(saved.conflicts,[base.job.packet.hash]);
  const files=await readdir(join(dir,'Web Table Toolkit','feedback'));assert.equal(files.filter(f=>f.endsWith('.json')).length,2);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

test('one-time configuration is stable outside checkouts; unavailable mounts, corrupt files and invalid requests do not claim successful saves',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-config-')),drive=join(dir,'drive'),configFile=join(dir,'profile','feedback.json');await mkdir(drive);
 let mf;try{
  let store=await createFeedbackDirectory({configFile,discover:async()=>[]});assert.equal((await store.status()).enabled,false);
  mf=setup(store);let response=await storage(mf,{action:'configure',drive_root:drive});assert.equal(response.status,200);assert.equal((await response.json()).enabled,true);
  const v=await review(mf,(await start(mf)).job);const first=await (await storage(mf,{action:'save',job:v.job})).json();
  assert.equal((await storage(mf,{action:'save',job:v.job},{origin:'https://untrusted.example'})).status,403);
  assert.equal((await storage(mf,{action:'read',id:'../../private'})).status,422);
  const bad=structuredClone(v.job);bad.events[0].note='Edited journal';assert.equal((await storage(mf,{action:'save',job:bad})).status,422);
  await mf.dispose();store=await createFeedbackDirectory({configFile,discover:async()=>[]});mf=setup(store);assert.equal((await store.status()).enabled,true);
  const path=join(drive,'Web Table Toolkit','feedback',first.id+'.json');await writeFile(path,'broken JSON');assert.equal((await storage(mf,{action:'list'})).status,422);assert.equal((await storage(mf,{action:'save',job:v.job})).status,422);
  await rename(drive,drive+'-offline');assert.equal((await store.status()).enabled,false);assert.equal((await storage(mf,{action:'save',job:v.job})).status,422);
  assert.ok(!(await readdir(dir)).includes('drive'),'An unavailable mount is never recreated as an ordinary local folder.');
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('published Worker exposes no filesystem storage and bound storage rejects non-loopback hosts',async()=>{
 let mf=setup();try{const r=await storage(mf,{action:'status'});assert.equal(r.status,200);assert.equal((await r.json()).enabled,false);}finally{await mf.dispose();}
 mf=setup({fetch:()=>Response.json({enabled:true})});try{const r=await mf.dispatchFetch('https://toolkit.example.org/api/interpretation/storage',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"status"}'});assert.equal(r.status,403);}finally{await mf.dispose();}
});

test('single Drive discovery is remembered, ambiguous discovery asks for a folder instead of guessing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-discovery-')),a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b);
 try{
  let store=await createFeedbackDirectory({configFile:join(dir,'ambiguous','settings.json'),discover:async()=>[a,b]});assert.equal((await store.status()).enabled,false);
  const configFile=join(dir,'single','settings.json');store=await createFeedbackDirectory({configFile,discover:async()=>[a]});assert.equal((await store.status()).enabled,true);assert.equal((await store.status()).directory,join(a,'Web Table Toolkit','feedback'));
  store=await createFeedbackDirectory({configFile,discover:async()=>{throw Error('Already configured; do not rediscover.');}});assert.equal((await store.status()).enabled,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('damaged local settings disable saving without preventing the lab from starting and can be repaired explicitly',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-settings-')),configFile=join(dir,'settings.json');
 try{await writeFile(configFile,'broken');const store=await createFeedbackDirectory({configFile,discover:async()=>{throw Error('Do not replace broken settings by guessing.');}});assert.equal((await store.status()).enabled,false);assert.match((await store.status()).message,/settings could not be read/);await store.configure(dir);assert.equal((await store.status()).enabled,true);}finally{await rm(dir,{recursive:true,force:true});}
});

test('two local servers can create the same dedicated folder and idempotently save a snapshot concurrently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-concurrent-'));
 const a=await createFeedbackDirectory({driveRoot:dir,configFile:join(dir,'a.json')}),b=await createFeedbackDirectory({driveRoot:dir,configFile:join(dir,'b.json')}),mf=setup(a);
 try{
  const v=await review(mf,(await start(mf)).job);const snapshot=(await (await storage(mf,{action:'save',job:v.job})).json()).snapshot;
  await rm(join(dir,'Web Table Toolkit'),{recursive:true});
  await Promise.all([a.save(snapshot),b.save(snapshot)]);assert.equal((await a.list()).snapshot_count,1);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
