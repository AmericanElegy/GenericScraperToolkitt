import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {launchBrowser} from './browser-cdp.mjs';
import {renderPage} from './render-page.mjs';
if(process.platform==='linux')process.env.TOOLKIT_BROWSER_NO_SANDBOX='1';
const html='<main><p>Widgets reached 12.6 percent.</p><table><tr><th>Name</th><th>Score</th></tr><tr><td>Alpha</td><td>98.6</td></tr><tr><td>Beta</td><td>95.1</td></tr></table></main>';
const shell='<div id="app"></div><script src="/rows.js"></script>';
let renderCalls=0,sourceCalls=0;
const dir=await mkdtemp(join(tmpdir(),'source-browser-'));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0,
 outboundService:request=>{
  const u=new URL(request.url);
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
  sourceCalls++;return new Response(u.hostname==='dynamic.example.org'?shell:html,{status:u.hostname==='blocked.example.org'?403:200,headers:{'content-type':'text/html'}});
 },
 serviceBindings:{LOCAL_RENDERER:async request=>{
  renderCalls++;const {url}=await request.json();
  const result=await renderPage(url,{timeoutMs:5000,loadResource:async input=>{
   const u=new URL(input);assert.equal(u.hostname,'dynamic.example.org');
   const script="setTimeout(()=>{document.getElementById('app').innerHTML='<table><tr><th>Name</th><th>Score</th></tr><tr><td>Gamma</td><td>88.1</td></tr><tr><td>Delta</td><td>87.3</td></tr></table>'},200)";
   return {status:200,headers:new Headers({'content-type':u.pathname==='/rows.js'?'text/javascript':'text/html'}),body:Buffer.from(u.pathname==='/rows.js'?script:shell)};
  }});return Response.json(result);
 }}
}));
const base=(await mf.ready).origin;let browser;
async function waitFor(fn){for(let i=0;i<180;i++){try{if(await fn())return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Source browser workflow timed out');}
try{
 browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
 await browser.send('Page.navigate',{url:base+'/interpretation'});
 await waitFor(()=>browser.evaluate('typeof document.getElementById("fetch-source")?.onclick === "function"'));
 await browser.evaluate('document.getElementById("source-url").value="https://static.example.org/";document.getElementById("source-text").value="Alpha scored 12.5.";document.getElementById("extract").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("1 candidate")&&!document.getElementById("load").disabled'));
 assert.equal(sourceCalls,0,'Pasting with a URL must remain offline.');
 await browser.evaluate('document.getElementById("fetch-source").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("2 candidates")&&!document.getElementById("fetch-source").disabled'));
 assert.equal(renderCalls,0);assert.equal(sourceCalls,1);
 assert.match(await browser.evaluate('document.getElementById("retrieved-summary").textContent'),/1 table selection · 2 captured table rows · 1 article section/);
 assert.match(await browser.evaluate('document.getElementById("retrieved-source").href'),/static.example.org/);
 assert.equal(await browser.evaluate('document.getElementById("open-retrieved").disabled'),true);
 assert.match(await browser.evaluate('document.getElementById("retrieved-preview").textContent'),/Table snapshot · 2 captured rows · 2 columns · currently open/);
 assert.match(await browser.evaluate('document.getElementById("retrieved-method").textContent'),/ordinary HTML/);
 assert.equal(await browser.evaluate('document.querySelector("button[data-record=row-1][data-field=score]").textContent'),'98.6');
 await browser.evaluate('document.getElementById("select-eligible").click();document.getElementById("batch-reviewer").value="Source Browser Test";document.getElementById("batch-note").value="Checked fetched row and header.";document.getElementById("batch-confirm").checked=true;document.getElementById("batch-confirm").dispatchEvent(new Event("change"));document.getElementById("approve-batch").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("2 approved")&&!document.getElementById("load").disabled'));
 await browser.evaluate('document.getElementById("approved-json").click()');
 await waitFor(async()=> (await readdir(dir)).includes('interpretation-approved.json'));
 const exported=JSON.parse(await readFile(join(dir,'interpretation-approved.json'),'utf8'));
 assert.equal(exported.source_retrieval.method,'static-html');assert.equal(exported.source_retrieval.source,'https://static.example.org/');assert.equal(exported.validation.records.length,2);
 await waitFor(()=>browser.evaluate('!document.getElementById("load").disabled'));
 await browser.evaluate('document.getElementById("retrieved-dataset").value="retrieved-2";document.getElementById("retrieved-dataset").dispatchEvent(new Event("change"));document.getElementById("open-retrieved").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("1 candidate")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/Widgets.*12.6/);
 assert.match(await browser.evaluate('document.getElementById("retrieved-preview").textContent'),/Article snapshot.*currently open/);
 assert.match(await browser.evaluate('document.getElementById("retrieved-current").textContent'),/Article text/);
 await browser.evaluate('document.getElementById("source-url").value="https://dynamic.example.org/";document.getElementById("fetch-source").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("retrieved-method").textContent.includes("JavaScript")&&document.getElementById("counts").textContent.includes("2 candidates")&&!document.getElementById("fetch-source").disabled'));
 assert.equal(renderCalls,1);assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/Gamma.*88.1/);
 assert.match(await browser.evaluate('document.getElementById("retrieval-checks").textContent'),/no supported records/);
 if(process.env.SOURCE_SCREENSHOT){await browser.evaluate('window.scrollTo(0,0)');const shot=await browser.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(process.env.SOURCE_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 await browser.evaluate('document.getElementById("source-url").value="https://blocked.example.org/";document.getElementById("fetch-source").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("status").textContent.includes("HTTP 403")&&!document.getElementById("fetch-source").disabled'));
 assert.equal(renderCalls,1);assert.match(await browser.evaluate('document.getElementById("status").textContent'),/previous review is unchanged/);
 console.log('PASS: real lab browser fetches static tables/article, preserves snapshot metadata in approved JSON, automatically renders a JavaScript-only table, leaves manual paste offline, and never retries an access barrier with rendering.');
}finally{await browser?.close();await mf.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
