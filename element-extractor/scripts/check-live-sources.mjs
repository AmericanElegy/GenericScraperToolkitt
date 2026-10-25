// Explicit opt-in live smoke check; the offline release gate does not contact these sites.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchBrowser} from './browser-cdp.mjs';
const urls=process.argv.slice(2);if(!urls.length)urls.push('https://www.w3schools.com/html/html_tables.asp','https://www.dci.org/scores/final-scores/2026-dci-all-age-world-championship-finals/');
if(process.platform==='linux')process.env.TOOLKIT_BROWSER_NO_SANDBOX='1';
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const child=spawn(process.execPath,['scripts/dev.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
const base='http://127.0.0.1:'+port;const results=[];let browser;
async function waitFor(fn,attempts=450){for(let i=0;i<attempts;i++){try{const result=await fn();if(result)return result}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Live check timed out.');}
try{
 await waitFor(async()=> (await fetch(base+'/interpretation')).ok,100);
 browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Page.navigate',{url:base+'/interpretation'});
 await waitFor(()=>browser.evaluate('typeof document.getElementById("fetch-source")?.onclick === "function"'));
 for(const [i,url]of urls.entries()){
  await browser.evaluate('document.getElementById("source-url").value='+JSON.stringify(url)+';document.getElementById("fetch-source").click()');
  await waitFor(()=>browser.evaluate('!document.getElementById("fetch-source").disabled'));
  const result=await browser.evaluate(`({method:document.getElementById('retrieved-method').textContent,summary:document.getElementById('retrieved-summary').textContent,status:document.getElementById('status').textContent,counts:document.getElementById('counts').textContent,selection:document.getElementById('retrieved-current').textContent,samples:[...document.querySelectorAll('#candidate-rows tr')].slice(0,3).map(tr=>[...tr.querySelectorAll('button.value')].map(b=>b.textContent))})`);
  const success=!result.method.includes('stopped')&&Number(result.counts.match(/^\d+/)?.[0])>0;
  results.push({url,success,...result});
  if(process.env.LIVE_SOURCE_OUTPUT_DIR){await mkdir(process.env.LIVE_SOURCE_OUTPUT_DIR,{recursive:true});await browser.evaluate('window.scrollTo(0,0)');const shot=await browser.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(join(process.env.LIVE_SOURCE_OUTPUT_DIR,'live-source-'+(i+1)+'.png'),Buffer.from(shot.data,'base64'));}
  console.log(JSON.stringify({url,success,method:result.method,counts:result.counts}));
 }
 if(process.env.LIVE_SOURCE_OUTPUT_DIR)await writeFile(join(process.env.LIVE_SOURCE_OUTPUT_DIR,'live-source-results.json'),JSON.stringify({retrieved_at:new Date().toISOString(),results},null,2)+'\n');
 if(results.some(r=>!r.success))process.exitCode=1;
}finally{await browser?.close();const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
