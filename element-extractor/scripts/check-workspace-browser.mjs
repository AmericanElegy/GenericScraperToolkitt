import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {launchBrowser} from './browser-cdp.mjs';import {createFeedbackDirectory} from './feedback-directory.mjs';import {createWorkspaceDirectory} from './workspace-directory.mjs';
if(process.platform==='linux')process.env.TOOLKIT_BROWSER_NO_SANDBOX='1';
const dir=await mkdtemp(join(tmpdir(),'toolkit-batch-browser-')),feedback=await createFeedbackDirectory({driveRoot:dir,configFile:join(dir,'profile.json')}),store=createWorkspaceDirectory(feedback);
let activeRequests=0,maxRequests=0;const calls=[];
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0,serviceBindings:{LOCAL_FEEDBACK:r=>feedback.fetch(r),LOCAL_WORKSPACE:r=>store.fetch(r)},outboundService:async r=>{
 const u=new URL(r.url);if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
 calls.push(u.pathname);activeRequests++;maxRequests=Math.max(maxRequests,activeRequests);try{if(u.pathname==='/slow')await new Promise(r=>setTimeout(r,900));if(u.pathname==='/paragraph')return new Response('<main><p>The average hourly wage was $31.59. Acme employs 1,234 workers.</p></main>',{headers:{'content-type':'text/html'}});if(u.pathname==='/blocked')return new Response('Forbidden',{status:403});const changed=u.pathname==='/changed',base=u.pathname==='/b'?20:10;return new Response('<table><tr><th>Name</th><th>'+(changed?'New Count':'Count')+'</th></tr><tr><td>Alpha</td><td>'+base+'</td></tr><tr><td>Beta</td><td>'+(base+1)+'</td></tr></table>',{headers:{'content-type':'text/html'}});}finally{activeRequests--;}
}}));const base=(await mf.ready).origin;let browser;
async function waitFor(fn){for(let i=0;i<200;i++){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,75));}throw Error('Workspace browser check timed out');}
try{
 browser=await launchBrowser({guardNetwork:false});const errors=[];browser.on(e=>{if(e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});await browser.send('Runtime.enable');await browser.send('Page.enable');await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});await browser.send('Page.navigate',{url:base+'/workspace'});
 await waitFor(()=>browser.evaluate('document.getElementById("save-state")?.textContent.includes("Drive connected")'));
 await browser.evaluate('document.getElementById("workspace-name").value="Batch demonstration";document.getElementById("workspace-name").dispatchEvent(new Event("change"));document.getElementById("batch-urls").value="https://data.example.org/a\\nhttps://data.example.org/b\\nhttps://data.example.org/a#duplicate";document.getElementById("add-urls").click()');
 await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===2'));
 await browser.evaluate('document.getElementById("run-batch").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Batch finished")'));
 assert.equal(maxRequests,1);assert.deepEqual(calls,['/a','/b']);assert.match(await browser.evaluate('document.getElementById("sources").textContent'),/Prepared/);
 assert.match(await browser.evaluate('document.getElementById("source-table").textContent'),/2 columns: Name \/ Count/);
 assert.match(await browser.evaluate('document.getElementById("source-preview").textContent'),/first 2 of 2 selected source rows/);
 // Save and apply a strict reusable recipe; changed headings must need a manual selection.
 await browser.evaluate('document.getElementById("recipe-name").value="Shared counts";document.getElementById("save-recipe").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Settings saved")'));
 await browser.evaluate('document.getElementById("batch-urls").value="https://data.example.org/changed\\nhttps://data.example.org/blocked";document.getElementById("add-urls").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===4'));await browser.evaluate('document.getElementById("run-batch").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Batch finished")'));
 assert.match(await browser.evaluate('document.querySelectorAll("#sources tr")[2].textContent'),/Choose content/);assert.match(await browser.evaluate('document.querySelectorAll("#sources tr")[3].textContent'),/Needs attention/);assert.equal(calls.filter(p=>p==='/blocked').length,1);
 // Queue filters change visibility only, retain selected editor, and make empty results clear.
 await browser.evaluate('document.getElementById("source-filter").value="attention";document.getElementById("source-filter").dispatchEvent(new Event("change"))');
 assert.equal(await browser.evaluate('document.querySelectorAll("#sources tr").length'),2);
 await browser.evaluate('document.getElementById("source-search").value="BLOCKED";document.getElementById("source-search").dispatchEvent(new Event("input"))');
 assert.equal(await browser.evaluate('document.querySelectorAll("#sources tr").length'),1);
 assert.match(await browser.evaluate('document.getElementById("sources").textContent'),/blocked/);
 await browser.evaluate('document.getElementById("source-search").value="no-such-source";document.getElementById("source-search").dispatchEvent(new Event("input"))');
 assert.match(await browser.evaluate('document.getElementById("source-results").textContent'),/No matches/);
 assert.equal(await browser.evaluate('document.getElementById("editor").hidden'),false);
 await browser.evaluate('document.getElementById("clear-source-filters").click()');
 assert.equal(await browser.evaluate('document.querySelectorAll("#sources tr").length'),4);
 // Open the real lab popup and review there; its source-locked message returns to the parent workspace.
 await browser.evaluate('window.originalOpen=window.open;window.open=(...args)=>(window.reviewWindow=window.originalOpen(...args));document.querySelector("#sources tr button").click()');
 await browser.send('Runtime.evaluate',{expression:'document.getElementById("review-source").click()',userGesture:true});
 await waitFor(()=>browser.evaluate('window.reviewWindow?.document.getElementById("counts")?.textContent.includes("2 candidates")'));
 await browser.evaluate('(()=>{const d=window.reviewWindow.document;d.getElementById("select-eligible").click();d.getElementById("batch-reviewer").value="Workspace browser test";d.getElementById("batch-note").value="Compared both fictional table rows.";d.getElementById("batch-confirm").checked=true;d.getElementById("batch-confirm").dispatchEvent(new window.reviewWindow.Event("change"));d.getElementById("approve-batch").click();})()');
 await waitFor(()=>browser.evaluate('document.querySelector("#sources tr").textContent.includes("2 approved")'));
 assert.match(await browser.evaluate('document.getElementById("export-summary").textContent'),/2 approved records/);
 await browser.evaluate('document.getElementById("source-filter").value="approved";document.getElementById("source-filter").dispatchEvent(new Event("change"))');
 assert.equal(await browser.evaluate('document.querySelectorAll("#sources tr").length'),1);
 await browser.evaluate('document.getElementById("source-filter").value="pending";document.getElementById("source-filter").dispatchEvent(new Event("change"))');
 assert.equal(await browser.evaluate('document.querySelectorAll("#sources tr").length'),1);
 assert.match(await browser.evaluate('document.getElementById("sources").textContent'),/data.example.org\/b/);
 assert.match(await browser.evaluate('document.getElementById("export-summary").textContent'),/2 approved records/);
 await browser.evaluate('document.getElementById("clear-source-filters").click()');

 await browser.evaluate('document.getElementById("export-csv").click()');await waitFor(async()=> (await readdir(dir)).includes('workspace-approved.csv'));
 const csv=await readFile(join(dir,'workspace-approved.csv'),'utf8');assert.equal(csv.trim().split('\r\n').length,3);assert.match(csv,/data.example.org\/a/);assert.doesNotMatch(csv,/data.example.org\/b/);
 await browser.evaluate('document.getElementById("download-workspace").click()');await waitFor(async()=> (await readdir(dir)).includes('toolkit-workspace.json'));
 const backup=JSON.parse(await readFile(join(dir,'toolkit-workspace.json'),'utf8'));assert.equal(backup.workspace.entries.length,4);assert.equal(backup.workspace.recipes.length,1);assert.equal(backup.workspace.entries[0].job.events.length,2);
 await waitFor(()=>browser.evaluate('document.getElementById("save-state").textContent.includes("saved locally")'));
 await browser.evaluate('window.reviewWindow.close();document.getElementById("new-workspace").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===0'));
 await browser.evaluate('document.getElementById("open-workspace").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===4&&document.getElementById("message").textContent.includes("reopened")'));
 assert.match(await browser.evaluate('document.querySelector("#sources tr").textContent'),/2 approved/);
 assert.equal(await browser.evaluate('document.getElementById("another-part").disabled'),false,'A prepared saved table can supply another part without a fresh fetch.');
 // A third URL with unchanged headings uses the recipe but receives no transferred approvals.
 await browser.evaluate('document.getElementById("batch-urls").value="https://data.example.org/c";document.getElementById("add-urls").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===5'));await browser.evaluate('document.getElementById("run-batch").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Batch finished")'));
 assert.match(await browser.evaluate('document.querySelectorAll("#sources tr")[4].textContent'),/Prepared.*0 approved/);
 await browser.evaluate('document.querySelectorAll("#sources tr")[4].querySelector("button").click()');assert.match(await browser.evaluate('document.getElementById("source-state").textContent'),/Saved settings applied/);
 // Rich prose is prepared explicitly and retains grouped numeric values and dollar formatting.
 await browser.evaluate('document.getElementById("batch-urls").value="https://data.example.org/paragraph";document.getElementById("add-urls").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===6'));await browser.evaluate('document.getElementById("run-batch").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Batch finished")'));
 await browser.evaluate('document.querySelectorAll("#sources tr")[5].querySelector("button").click();document.getElementById("prepare-source").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Prepared a fresh")'));
 await browser.send('Runtime.evaluate',{expression:'document.getElementById("review-source").click()',userGesture:true});await waitFor(()=>browser.evaluate('window.reviewWindow?.document.getElementById("counts")?.textContent.includes("2 candidates")'));
 assert.equal(await browser.evaluate('window.reviewWindow.document.querySelector("button[data-record=row-1][data-field=value]").textContent'),'$31.59');
 assert.match(await browser.evaluate('window.reviewWindow.document.getElementById("evidence").textContent'),/Surrounding text/);
 assert.match(await browser.evaluate('window.reviewWindow.document.getElementById("evidence").textContent'),/Acme employs 1,234 workers/);
 assert.equal(await browser.evaluate('[...window.reviewWindow.document.querySelectorAll("#evidence details")].find(d=>d.querySelector("summary")?.textContent.startsWith("Surrounding text")).open'),false);

 assert.equal(await browser.evaluate('window.reviewWindow.document.querySelector("button[data-record=row-2][data-field=value]").textContent'),'1,234');
 await browser.evaluate('window.reviewWindow.close()');
 // Remapping a linked review explicitly replaces its workspace snapshot and clears approvals.
 await browser.evaluate('document.querySelector("#sources tr button").click()');await browser.send('Runtime.evaluate',{expression:'document.getElementById("review-source").click()',userGesture:true});await waitFor(()=>browser.evaluate('window.reviewWindow?.document.getElementById("counts")?.textContent.includes("2 approved")'));
 await browser.evaluate('(()=>{const d=window.reviewWindow.document;d.getElementById("mapping-panel").open=true;d.querySelectorAll("#mapping-columns input")[0].value="entity";d.querySelectorAll("#mapping-columns input")[1].value="amount";d.getElementById("apply-mapping").click();})()');
 await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.includes("Column mapping returned")'));
 assert.match(await browser.evaluate('document.querySelector("#sources tr").textContent'),/0 approved/);
 assert.match(await browser.evaluate('document.getElementById("export-group").textContent'),/entity.*amount/);
 await browser.evaluate('(()=>{const d=window.reviewWindow.document;d.getElementById("select-eligible").click();d.getElementById("batch-reviewer").value="Workspace browser test";d.getElementById("batch-note").value="Rechecked the renamed fields.";d.getElementById("batch-confirm").checked=true;d.getElementById("batch-confirm").dispatchEvent(new window.reviewWindow.Event("change"));d.getElementById("approve-batch").click();})()');
 await waitFor(()=>browser.evaluate('document.querySelector("#sources tr").textContent.includes("2 approved")'));
 await browser.evaluate('(()=>{const select=document.getElementById("export-group");select.value=[...select.options].find(o=>o.textContent.startsWith("entity")).value;select.dispatchEvent(new Event("change"));})()');

 await browser.evaluate('window.reviewWindow.close()');
 // Multiple parts of one capture do not cause another source request or inherit approvals.
 await browser.evaluate('document.querySelectorAll("#sources tr")[4].querySelector("button").click()');const requestsBeforePart=calls.length;
 await browser.evaluate('document.getElementById("another-part").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===7'));
 await browser.evaluate('document.getElementById("row-first").value="2";document.getElementById("row-last").value="2";document.getElementById("row-first").dispatchEvent(new Event("input"));document.getElementById("prepare-source").click()');
 await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr")[6].textContent.includes("Prepared")'));
 await waitFor(()=>browser.evaluate('!document.getElementById("another-part").disabled'));assert.equal(calls.length,requestsBeforePart);assert.match(await browser.evaluate('document.querySelectorAll("#sources tr")[6].textContent'),/0 approved.*1 pending/);
 await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true);
 if(process.env.WORKSPACE_SCREENSHOT){await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});const shot=await browser.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(process.env.WORKSPACE_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 await browser.evaluate('document.getElementById("new-workspace").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===0'));
 await browser.evaluate('document.getElementById("batch-urls").value="https://data.example.org/slow\\nhttps://data.example.org/after-stop";document.getElementById("add-urls").click()');await waitFor(()=>browser.evaluate('document.querySelectorAll("#sources tr").length===2'));
 await browser.evaluate('document.getElementById("run-batch").click()');await waitFor(()=>calls.includes('/slow'));await browser.evaluate('document.getElementById("stop-batch").click()');await waitFor(()=>browser.evaluate('document.getElementById("message").textContent.startsWith("Stopped after")'));
 assert.equal(calls.includes('/after-stop'),false,'Stop retains later sources without fetching them.');assert.match(await browser.evaluate('document.querySelectorAll("#sources tr")[1].textContent'),/Queued/);
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS: serial batch fetching, URL deduplication, strict recipes, changed-heading hold, access failure accounting, real lab-tab review bridge, source-attributed approved CSV, portable backup, Drive reopening, and mobile layout.');
}catch(e){if(browser)console.error(await browser.evaluate('JSON.stringify({message:document.getElementById("message")?.textContent,save:document.getElementById("save-state")?.textContent,sources:document.getElementById("sources")?.textContent})'));throw e;}finally{await browser?.close();await mf.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
