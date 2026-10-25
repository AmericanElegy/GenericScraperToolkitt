import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderPage } from './render-page.mjs';
import { launchBrowser } from './browser-cdp.mjs';
import { startRenderServer } from './browser-render-server.mjs';
if(process.platform==='linux')process.env.TOOLKIT_BROWSER_NO_SANDBOX='1'; // Disposable CI container only; desktop defaults retain sandboxing.
const html='<!doctype html><div id="app">Loading…</div><script src="/app.js"></script>';
const script=`setTimeout(async()=>{
 const response=await fetch('/scores.json');const rows=await response.json();
 const table=document.createElement('table');table.innerHTML='<caption>Late scores</caption><tr><th>Name</th><th>Score</th></tr>';
 for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td)}table.append(tr)}
 document.getElementById('app').replaceChildren(table);
 fetch('https://127.0.0.1/secret').catch(()=>{});
 fetch('/write',{method:'POST',body:'disabled'}).catch(()=>{});
},300);`;
const calls=[];
const loadResource=async input=>{
 const url=new URL(input);calls.push(input);
 assert.equal(url.hostname,'dynamic.example.org');
 const [body,type]=url.pathname==='/app.js'?[script,'text/javascript']:url.pathname==='/scores.json'?[JSON.stringify([['Alpha','98.6'],['<img src=x onerror=alert(1)>','=1+1']]),'application/json']:[html,'text/html'];
 return {status:200,headers:new Headers({'content-type':type}),body:Buffer.from(body)};
};
const renderer=url=>renderPage(url,{loadResource,timeoutMs:6000});
const server=await startRenderServer({port:0,renderer});
const base='http://127.0.0.1:'+server.address().port;
const dir=await mkdtemp(join(tmpdir(),'renderer-check-'));
let browser;
async function waitFor(fn){for(let i=0;i<140;i++){try{const value=await fn();if(value)return value}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Browser test timed out');}
try{
 assert.equal(html.includes('<table'),false,'Fixture must require JavaScript.');
 const post=(body,headers={})=>fetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post({url:'https://127.0.0.1/private'})).status,400);
 assert.equal((await post({url:'https://dynamic.example.org/'},{Origin:'https://evil.example.org'})).status,403);
 assert.equal((await post({url:'https://dynamic.example.org/',cookies:'secret'})).status,400);
 assert.equal(calls.length,0);
 browser=await launchBrowser({guardNetwork:false});
 await browser.send('Page.enable');await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
 await browser.send('Page.navigate',{url:base+'/'});
 await waitFor(()=>browser.evaluate('typeof document.getElementById("render")?.onsubmit === "function"'));
 await browser.evaluate('document.getElementById("url").value="https://dynamic.example.org/";document.getElementById("render").requestSubmit()');
 try { await waitFor(()=>browser.evaluate('!document.getElementById("go").disabled && !document.getElementById("results").hidden')); } catch(e) { throw Error(e.message+': '+await browser.evaluate('document.getElementById("status").textContent')); }
 assert.equal(await browser.evaluate('document.querySelectorAll("#rows tr").length'),2);
 assert.equal(await browser.evaluate('document.querySelectorAll("#rows img").length'),0);
 assert.match(await browser.evaluate('document.getElementById("details").textContent'),/127\.0\.0\.1/);
 assert.equal(calls.some(u=>u.includes('/write')),false,'POST requests must never reach the transport.');
 assert.match(await browser.evaluate('document.getElementById("details").textContent'),/read-only GET/);
 assert.equal(calls.some(u=>u.includes('127.0.0.1')),false,'A private request must never reach the transport.');
 await browser.evaluate('document.getElementById("search").value="Alpha";document.getElementById("search").dispatchEvent(new Event("input"))');
 assert.equal(await browser.evaluate('document.querySelectorAll("#rows tr").length'),1);
 await browser.evaluate('document.getElementById("csv").click();document.getElementById("json").click();document.getElementById("tsv").click()');
 await waitFor(async()=> (await readdir(dir)).filter(n=>/\.(csv|json|tsv)$/.test(n)).length===3);
 const csv=await readFile(join(dir,'rendered-table.csv'),'utf8');assert.match(csv,/'=1\+1/);assert.equal(csv.split('\r\n').filter(Boolean).length,3);
 const saved=JSON.parse(await readFile(join(dir,'rendered-table.json'),'utf8'));assert.equal(saved.tables[0].rows.length,2);assert.equal(saved.method,'local-chromium-v1');assert.equal(saved.final_url,'https://dynamic.example.org/');
 assert.match(await readFile(join(dir,'rendered-table.tsv'),'utf8'),/Name\tScore/);
 if(process.env.RENDER_SCREENSHOT){const shot=await browser.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(process.env.RENDER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 console.log('PASS: JavaScript-only table rendered through intercepted read-only requests; private requests blocked; real browser search and safe CSV/JSON/TSV downloads verified. No external service used.');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
