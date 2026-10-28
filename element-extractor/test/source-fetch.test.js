import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const host='https://toolkit.example.org';
function setup({html='<main><p>Widgets reached 12.6 percent.</p><table><tr><th>Name</th><th>Score</th></tr><tr><td>Alpha</td><td>98.6</td></tr></table></main>',status=200,type='text/html',render,privateDNS=false}={}){
 let rendered=0,sourceCalls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',
  ...(render?{serviceBindings:{LOCAL_RENDERER:async request=>{rendered++;return render(await request.json());}}}:{}),
  outboundService:request=>{if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:new URL(request.url).searchParams.get('type')==='A'?[{type:1,data:privateDNS?'127.0.0.1':'8.8.8.8'}]:[]});sourceCalls++;return new Response(html,{status,headers:{'content-type':type}});}
 }));return {mf,rendered:()=>rendered,sourceCalls:()=>sourceCalls};
}
const post=(mf,path,body,extra={})=>mf.dispatchFetch(host+path,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
const get=(mf)=>post(mf,'/api/interpretation/fetch',{url:'https://data.example.org/'});
const shell='<div id="app"></div><script src="/rows.js"></script>';
test('source URL fetch imports static tables and prose without rendering and preserves checked snapshot metadata',async()=>{
 const {mf,rendered}=setup({render:()=>{throw Error('Static content must not render');}});
 try{
  const response=await get(mf);assert.equal(response.status,200);const fetched=await response.json();
  assert.equal(fetched.method,'static-html');assert.equal(fetched.datasets.length,2);assert.equal(rendered(),0);
  const d=fetched.datasets[0];
  let v=await (await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:fetched.source},retrieval:{method:fetched.method,source:fetched.source,retrieved_at:fetched.retrieved_at,snapshot_hash:d.snapshot_hash,label:d.label}})).json();
  assert.equal(v.counts.candidates,1);assert.equal(v.validation.records[0].fields.score.value,98.6);
  v=await (await post(mf,'/api/interpretation/action',{action:'review',job:v.job,decision:{record_id:'row-1',decision:'approved',reviewer:'Test',note:'Compared row and header.',confirmed_association:true}})).json();
  const exported=await (await post(mf,'/api/interpretation/action',{action:'export',job:v.job,format:'json'})).json();
  assert.equal(exported.source_retrieval.method,'static-html');assert.equal(exported.source_retrieval.snapshot_hash,d.snapshot_hash);assert.equal(exported.validation.records.length,1);
  const saved=await (await post(mf,'/api/interpretation/action',{action:'save',job:v.job})).json();
  assert.equal((await post(mf,'/api/interpretation/action',{action:'restore',session:saved})).status,200);
  v.job.retrieval.snapshot_hash='changed';assert.equal((await post(mf,'/api/interpretation/action',{action:'revalidate',job:v.job})).status,400);
 }finally{await mf.dispose();}
});
test('source fallback runs only for an unproductive JavaScript shell, and records both methods',async()=>{
 const s=setup({html:shell,render:()=>Response.json({tables:[{caption:'Scores',headers:['Name','Score'],rows:[['Alpha','98.6']],supported:true}],diagnostics:{message:'Timed rendered snapshot.',blocked_resources:[]}})});
 try{const r=await get(s.mf);assert.equal(r.status,200);const v=await r.json();assert.equal(v.method,'local-chromium');assert.equal(s.rendered(),1);assert.ok(v.checks.some(c=>c.method==='static-html'&&c.status==='no_supported_records'));assert.ok(v.checks.some(c=>c.method==='local-chromium'&&c.status==='passed'));}finally{await s.mf.dispose();}
 for(const options of [{html:shell},{html:shell,render:()=>Response.json({error:'Browser unavailable'},{status:422})},{html:shell,render:()=>Response.json({tables:[],diagnostics:{message:'No tables.',blocked_resources:[]}})}]){
  const s=setup(options);try{const r=await get(s.mf);assert.equal(r.status,422);const v=await r.json();assert.ok(['renderer_unavailable','render_failed','both_methods_no_data'].includes(v.code));assert.ok(v.checks.length>=2);}finally{await s.mf.dispose();}
 }
});
test('access barriers, private DNS, images, unsupported tables and request failures never trigger rendering',async()=>{
 for(const options of [{status:403},{privateDNS:true},{type:'image/png'},{html:'<title>Sign in</title><input type="password">'+shell},{html:'<table><tr><th colspan="2">Ambiguous</th></tr><tr><td>A</td><td>1</td></tr></table>'+shell}]){
  const s=setup({...options,render:()=>{throw Error('Must not render');}});
  try{const r=await get(s.mf);assert.equal(r.status,options.privateDNS?400:422);assert.equal(s.rendered(),0);}finally{await s.mf.dispose();}
 }
 const s=setup();try{
  assert.equal((await post(s.mf,'/api/interpretation/fetch',{url:'https://data.example.org/'},{Origin:'https://other.example.org'})).status,403);
  assert.equal((await post(s.mf,'/api/interpretation/fetch',{url:'https://127.0.0.1/'})).status,400);
  assert.equal((await post(s.mf,'/api/interpretation/fetch',{url:'https://data.example.org/',cookie:'secret'})).status,400);
  assert.equal(s.sourceCalls(),0);
 }finally{await s.mf.dispose();}
});
test('known grouped wage headings use the existing bounded schema instead of guessing arbitrary merged columns',async()=>{
 const html='<table><tr><th rowspan="2">Major occupational group</th><th colspan="2">Percent of total employment</th><th colspan="2">Mean hourly wage ($)</th></tr><tr><th>United States</th><th>Jacksonville</th><th>United States</th><th>Jacksonville</th></tr><tr><td>Management</td><td>7.2</td><td>7.4</td><td>69.84</td><td>65.97</td></tr></table><table><tr><th rowspan="2">Occupation(1)</th><th colspan="2">Employment</th><th colspan="2">Mean wages ($)</th></tr><tr><th>Level(2)</th><th>Location quotient(3)</th><th>Hourly</th><th>Annual(4)</th></tr><tr><td>Office workers</td><td>96,850</td><td>1.11</td><td>23.89</td><td>49,690</td></tr></table>';
 const s=setup({html});try{
  const fetched=await (await get(s.mf)).json();assert.equal(fetched.datasets.length,2);
  for(const [i,d]of fetched.datasets.entries()){
   const r=await post(s.mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text:d.text,url:fetched.source}});assert.equal(r.status,200);const v=await r.json();assert.equal(v.counts.candidates,1);
   if(i===0)assert.equal(v.validation.records[0].fields.hourly_wage_local_dollars.value,65.97);else assert.equal(v.validation.records[0].fields.annual_wage_dollars.value,49690);
  }
 }finally{await s.mf.dispose();}
});

test('incidental unsupported price text does not suppress the JavaScript fallback, but a supported monetary statement does',async()=>{
 const rendered=()=>Response.json({tables:[{caption:'Scores',headers:['Name','Score'],rows:[['Alpha','98.6']],supported:true}],diagnostics:{message:'Timed rendered snapshot.',blocked_resources:[]}});
 let s=setup({html:shell+'<p>Buy now for $19.99.</p>',render:rendered});try{const r=await get(s.mf);assert.equal(r.status,200);assert.equal((await r.json()).method,'local-chromium');assert.equal(s.rendered(),1);}finally{await s.mf.dispose();}
 s=setup({html:shell+'<p>Revenue was $1,234.50.</p>',render:()=>{throw Error('Recognized static facts do not require rendering.');}});try{const r=await get(s.mf);assert.equal(r.status,200);assert.equal((await r.json()).method,'static-html');assert.equal(s.rendered(),0);}finally{await s.mf.dispose();}
});
