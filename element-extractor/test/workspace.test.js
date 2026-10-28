import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,rm,rename} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {matchRecipe,makeWorkspaceSnapshot} from '../src/interpretation/workspace-core.js';import {createFeedbackDirectory} from '../scripts/feedback-directory.mjs';import {createWorkspaceDirectory} from '../scripts/workspace-directory.mjs';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const post=(mf,path,body,origin)=>mf.dispatchFetch('http://127.0.0.1'+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});
const api=(mf,b)=>post(mf,'/api/workspace',b);
const fresh=()=>({format:'toolkit-workspace-v1',id:'workspace-test',name:'Reviewed sources',history:[],recipes:[],entries:[]});
async function source(mf,url,text='Name\tCount\nAlpha\t12\nBeta\t13'){
 const r=await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text,url}});assert.equal(r.status,200);return r.json();
}
async function approve(mf,job,decision='approved',note='Compared the source values and association.'){
 const r=await post(mf,'/api/interpretation/action',{action:'review',job,decision:{record_id:'row-1',decision,reviewer:'Workspace test',note,confirmed_association:true}});assert.equal(r.status,200);return r.json();
}
test('combined exports use only approved compatible prepared sources and retain every source identity without joins',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01'}));try{
  const w=fresh();for(const [i,url]of ['https://one.example.org/','https://two.example.org/'].entries()){const v=await approve(mf,(await source(mf,url)).job);w.entries.push({id:'source-'+i,url,status:'ready',message:'Prepared',job:v.job});}
  const extra=await source(mf,'https://third.example.org/','Name\tCount\n001\t14');w.entries.push({id:'third',url:'https://third.example.org/',status:'ready',message:'Prepared',job:extra.job});
  const different=await approve(mf,(await source(mf,'https://pay.example.org/','Name\tPay ($)\nOther\t$99.00')).job);w.entries.push({id:'pay',url:'https://pay.example.org/',status:'ready',message:'Prepared',job:different.job});
  const checked=await (await api(mf,{action:'check_job',job:w.entries[0].job})).json();const response=await api(mf,{action:'export',workspace:w,schema_key:checked.schema_key,format:'csv'});assert.equal(response.status,200);const csv=await response.text();assert.equal(csv.trim().split('\r\n').length,3);assert.match(csv,/_toolkit_source_url/);assert.match(csv,/one.example.org/);assert.match(csv,/two.example.org/);assert.doesNotMatch(csv,/third.example.org/);
  let json=await (await api(mf,{action:'export',workspace:w,schema_key:checked.schema_key,format:'json'})).json();assert.equal(json.records.length,2);assert.equal(json.sources.length,3,'A compatible unapproved source retains attribution but contributes no approved records.');assert.equal(json.records[0].fields.name.value,'Alpha');
  w.entries[1].status='failed';json=await (await api(mf,{action:'export',workspace:w,schema_key:checked.schema_key,format:'json'})).json();assert.equal(json.records.length,1,'A failed refresh does not silently export its old review.');
  const tampered=structuredClone(w);tampered.entries[0].job.events[0].note='Forged';assert.equal((await api(mf,{action:'export',workspace:tampered,schema_key:checked.schema_key,format:'json'})).status,422);
  assert.equal((await post(mf,'/api/workspace',{action:'list'},'https://bad.example')).status,403);
  assert.equal((await api(mf,{action:'urls',urls:['https://127.0.0.1/']})).status,422);
 }finally{await mf.dispose();}
});
test('Drive workspaces survive recreation, retain revisions and flag divergent workspace histories',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'toolkit-workspace-')),feedback=await createFeedbackDirectory({driveRoot:dir,configFile:join(dir,'profile.json')}),store=createWorkspaceDirectory(feedback);
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',serviceBindings:{LOCAL_WORKSPACE:r=>store.fetch(r)}}));try{
  const w=fresh();const v=await source(mf,'https://one.example.org/');w.entries.push({id:'one',url:'https://one.example.org/',status:'ready',message:'Prepared',job:v.job});
  let r=await api(mf,{action:'save',workspace:w});assert.equal(r.status,200);const first=await r.json();assert.equal(first.saved,true);
  w.history.push(first.snapshot.id);w.name='Renamed';const second=await (await api(mf,{action:'save',workspace:w})).json();assert.equal(second.saved,true);
  const reopened=createWorkspaceDirectory(feedback);const list=await reopened.list();assert.equal(list.heads.length,1);assert.equal(list.heads[0].name,'Renamed');
  const loaded=await (await api(mf,{action:'read',id:second.snapshot.id})).json();assert.equal(loaded.snapshot.workspace.entries[0].job.packet.source.url,'https://one.example.org/');
  const branch=structuredClone(first.snapshot.workspace);branch.history.push(first.snapshot.id);branch.name='Other machine';await store.save(await makeWorkspaceSnapshot(branch));const conflict=await store.list();assert.equal(conflict.heads.length,0);assert.equal(conflict.conflicts.length,1);
  await rename(dir,dir+'-offline');
  assert.equal((await api(mf,{action:'save',workspace:w})).status,422,'Unavailable Drive does not claim a successful save.');
  const backup=await api(mf,{action:'snapshot',workspace:w});assert.equal(backup.status,200,'Portable backup does not depend on a successful Drive write.');await rename(dir+'-offline',dir);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});await rm(dir+'-offline',{recursive:true,force:true});}
});
test('saved settings require exact unique headings and review updates reject divergent histories',async()=>{
 const recipe={version:'table-recipe-v1',id:'recipe',name:'Counts',host:'data.example.org',headers:['Name','Count'],title:null,columns:[0,1],first_row:1,last_row:2};const table={source_columns:2,columns:[{index:0,label:'Name'},{index:1,label:'Count'}],title:'Table 1'};
 assert.equal(matchRecipe(recipe,[table],'https://data.example.org/a').status,'matched');assert.equal(matchRecipe(recipe,[table,table],'https://data.example.org/a').status,'ambiguous');assert.equal(matchRecipe(recipe,[table],'https://other.example.org/a').status,'no_match');assert.equal(matchRecipe(recipe,[{...table,columns:[{index:0,label:'Name'},{index:1,label:'New Count'}]}],'https://data.example.org/a').status,'no_match');
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01'}));try{const base=await source(mf,'https://data.example.org/'),a=await approve(mf,base.job),b=await approve(mf,base.job,'rejected','Another tab disagrees.');assert.equal((await api(mf,{action:'update_job',current:base.job,job:a.job})).status,200);assert.equal((await api(mf,{action:'update_job',current:a.job,job:b.job})).status,422);const stale=await (await api(mf,{action:'update_job',current:a.job,job:base.job})).json();assert.equal(stale.stale,true);}finally{await mf.dispose();}
});

test('explicit column remapping starts a new unapproved workspace review and cannot replace it with another source',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01'}));try{
  const initial=await approve(mf,(await source(mf,'https://data.example.org/')).job);
  const changed=await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:initial.job.packet.source.text,url:initial.job.packet.source.url},mapping:[{name:'entity',kind:'text'},{name:'amount',kind:'number'}]});assert.equal(changed.status,200);const next=await changed.json();
  let r=await api(mf,{action:'replace_job',current:initial.job,job:next.job});assert.equal(r.status,200);assert.equal((await r.json()).counts.approved,0);
  const other=await source(mf,'https://other.example.org/');r=await api(mf,{action:'replace_job',current:initial.job,job:other.job});assert.equal(r.status,422);
  const reviewed=await approve(mf,next.job);r=await api(mf,{action:'replace_job',current:initial.job,job:reviewed.job});assert.equal(r.status,422,'Replacement cannot smuggle prior approvals.');
 }finally{await mf.dispose();}
});
