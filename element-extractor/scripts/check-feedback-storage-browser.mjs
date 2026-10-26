import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,rename,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createFeedbackDirectory} from './feedback-directory.mjs';
import {launchBrowser} from './browser-cdp.mjs';
if(process.platform==='linux')process.env.TOOLKIT_BROWSER_NO_SANDBOX='1';
const dir=await mkdtemp(join(tmpdir(),'toolkit-drive-browser-')),drive=join(dir,'Drive');await mkdir(drive);
const store=await createFeedbackDirectory({configFile:join(dir,'profile','feedback.json'),discover:async()=>[]});
let outbound=0,browser;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0,serviceBindings:{LOCAL_FEEDBACK:r=>store.fetch(r)},outboundService:()=>{outbound++;throw Error('Unexpected network request');}}));
const base=(await mf.ready).origin;
async function reloadBrowser(){const loaded=new Promise(resolve=>browser.on(e=>{if(e.method==="Page.loadEventFired")resolve();}));await browser.send("Page.reload");await loaded;}
async function waitFor(fn){for(let i=0;i<150;i++){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Feedback browser check timed out');}
try{
 browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Runtime.enable');
 const errors=[];browser.on(e=>{if(e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails);});
 await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
 await browser.send('Page.navigate',{url:base+'/interpretation'});
 await waitFor(()=>browser.evaluate('document.getElementById("storage-status")?.textContent.includes("Choose your Google Drive folder")'));
 await browser.evaluate('document.getElementById("drive-root").value='+JSON.stringify(drive)+';document.getElementById("connect-storage").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("storage-status").textContent.includes("Connected:")&&!document.getElementById("load").disabled'));
 await browser.evaluate('document.getElementById("load").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("2 candidates")&&!document.getElementById("load").disabled'));
 await browser.evaluate('document.getElementById("reviewer").value="Drive browser test";document.getElementById("note").value="Checked the literal association.";document.getElementById("confirm").checked=true;document.getElementById("confirm").dispatchEvent(new Event("change"));document.getElementById("approve").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("1 approved")&&document.getElementById("storage-status").textContent.includes("Saved locally")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("storage-status").textContent'),/synchronization is not verified/);
 assert.equal((await readdir(join(drive,'Web Table Toolkit','feedback'))).filter(f=>f.endsWith('.json')).length,1);
 await reloadBrowser();
 await waitFor(()=>browser.evaluate('document.getElementById("feedback-summary")?.textContent.startsWith("1 reviewed examples")&&!document.getElementById("open-feedback-review").disabled'));
 await browser.evaluate('document.getElementById("open-feedback-review").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("1 approved")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("status").textContent'),/reopened and independently revalidated/);
 // A second review appends history but replaces the active example.
 await browser.evaluate('document.getElementById("reviewer").value="Drive browser test";document.getElementById("note").value="Withdraw approval pending another look.";document.getElementById("pending").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("0 approved")&&document.getElementById("storage-count").textContent.includes("2 saved review snapshots")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("feedback-summary").textContent'),/^0 reviewed examples/);
 await reloadBrowser();
 await waitFor(()=>browser.evaluate('document.getElementById("storage-count")?.textContent.includes("0 active examples")'));
 assert.equal(await browser.evaluate('document.getElementById("open-feedback-review").disabled'),false,'Pending review can resume without restoring an approval.');
 await browser.evaluate('document.getElementById("open-feedback-review").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("0 approved")&&!document.getElementById("load").disabled')); 
 // The mounted-folder simulation becomes unavailable; retain the human decision and show failure.
 await rename(drive,drive+'-offline');
 await browser.evaluate('document.getElementById("load").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("counts").textContent.includes("2 candidates")&&!document.getElementById("load").disabled'));
 await browser.evaluate('document.getElementById("reviewer").value="Drive browser test";document.getElementById("note").value="Decision retained if storage fails.";document.getElementById("confirm").checked=true;document.getElementById("confirm").dispatchEvent(new Event("change"));document.getElementById("approve").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("storage-status").textContent.includes("Feedback not saved:")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("counts").textContent'),/1 approved/);
 assert.ok(!(await readdir(dir)).includes('Drive'));
 // Reconnect, retry and reload: the failed save is recovered without another review.
 await rename(drive+'-offline',drive);await browser.evaluate('document.getElementById("reload-storage").click()');
 await waitFor(()=>browser.evaluate('document.getElementById("storage-status").textContent.includes("Saved locally")&&!document.getElementById("load").disabled'));
 assert.match(await browser.evaluate('document.getElementById("storage-count").textContent'),/3 saved review snapshots · 1 active examples/);
 if(process.env.FEEDBACK_STORAGE_SCREENSHOT){await browser.evaluate('window.scrollTo(0,0)');const shot=await browser.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(process.env.FEEDBACK_STORAGE_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 assert.equal(outbound,0);assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: browser configures dedicated Drive folder, auto-saves review decisions, reopens validated feedback after reload, retains withdrawals, and recovers a failed save without a second review. Cloud synchronization is never claimed.');
}catch(error){if(browser)console.error(await browser.evaluate('JSON.stringify({status:document.getElementById("status")?.textContent,storage:document.getElementById("storage-status")?.textContent,counts:document.getElementById("counts")?.textContent,selection:document.getElementById("saved-feedback")?.value,options:[...document.getElementById("saved-feedback").options].map(o=>o.value)})'));throw error;}finally{await browser?.close();await mf.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
