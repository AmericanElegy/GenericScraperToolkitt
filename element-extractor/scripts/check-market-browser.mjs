import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,readdir,rm,writeFile}from 'node:fs/promises';
import {tmpdir}from 'node:os';import {join}from 'node:path';
import {launchBrowser}from './browser-cdp.mjs';
import {summarizeMarket}from '../src/market-capture.js';
import {Miniflare,convertV4MiniflareOptions}from 'miniflare';
const row=(id,price='123')=>`<tr data-saleid="${id}" data-id="42" data-price="${price}" data-quantity="2" data-level="3" data-state="" data-serial="0"><td><button onclick="window.purchases++">Buy</button></td><td>x2</td><td>${price}</td><td><img alt="Special edition"></td><td>stars</td><td>6</td><td>4</td><td>Ability</td><td><a>=Seller</a></td><td>2 days</td></tr>`;
const html=`<main><input id="market-search" value="Card test"><button id="balance">PRIVATE ACCOUNT VALUE</button><div id="row-42"><a href="/game/characters/?id_perso=42">Test card</a><a>View all 3 offers</a><table><tbody>${row('1')}${row('2')}</tbody></table></div></main>`;
const dir=await mkdtemp(join(tmpdir(),'market-browser-'));let browser;let requests=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('worker-code.txt','utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0}));
const base=(await mf.ready).origin;
try{
 browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
 browser.on(async m=>{if(m.method==='Fetch.requestPaused'){requests++;await browser.send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(html).toString('base64')});}});
 await browser.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await browser.send('Page.navigate',{url:'https://www.urban-rivals.com/market/'});
 const wait=async expression=>{for(let i=0;i<100;i++){if(await browser.evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);};
 await wait('!!document.getElementById("row-42")');
 await browser.evaluate('window.purchases=0');
 const page=await (await mf.dispatchFetch(base+'/market-capture')).text(),href=/class="install" href="([^"]+)"/.exec(page)[1],script=decodeURIComponent(href.slice('javascript:'.length));
 assert.ok(!script.includes('__name('),'Bookmarklet must not depend on bundler closure helpers');
 await browser.evaluate(script);await browser.evaluate(`Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent==='Capture loaded offers').click()`);
 const before=requests;
 await browser.evaluate(`document.querySelector('tbody').insertAdjacentHTML('beforeend',${JSON.stringify(row('3'))})`);
 await browser.evaluate(`Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent==='Capture loaded offers').click()`);
 for(const label of ['Download evidence JSON','Download offers CSV','Download card coverage CSV'])await browser.evaluate(`Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
 for(let i=0;i<100;i++){const files=await readdir(dir);if(['market-capture.json','market-offers.csv','market-card-coverage.csv'].every(f=>files.includes(f)))break;await new Promise(r=>setTimeout(r,50));}
 const result=JSON.parse(await readFile(join(dir,'market-capture.json'),'utf8'));
 assert.equal(result.unique_cards,1);assert.equal(result.offers[0].card_name,'Test card');assert.equal(result.unique_observed_listings,3);assert.equal(result.observed_quantity_total,6);assert.equal(result.observations.length,2);assert.equal(result.cards[0].coverage_status,'count_matches_only');assert.ok(!JSON.stringify(result).includes('PRIVATE ACCOUNT VALUE'));
 assert.match(await readFile(join(dir,'market-offers.csv'),'utf8'),/'=Seller/);assert.equal(await browser.evaluate('window.purchases'),0);assert.equal(requests,before);
 await browser.send('Runtime.evaluate',{expression:`Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent==='Review in workbench').click()`,userGesture:true});
 let target;
 for(let i=0;i<100;i++){target=(await browser.send('Target.getTargets')).targetInfos.find(t=>t.url.startsWith(base+'/?market_capture='));if(target)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(target,'Direct review opens a new workbench tab');
 const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 const review=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 for(let i=0;i<200;i++){if((await review('document.getElementById("counts")?.textContent'))?.includes('3 candidates'))break;await new Promise(r=>setTimeout(r,50));}
 assert.match(await review('document.getElementById("counts").textContent'),/3 candidates.*0 approved/,await review('document.getElementById("status").textContent'));
 assert.match(await review('document.getElementById("file-issues").textContent'),/3 observed \/ 3 advertised/);
 assert.equal(await review('document.querySelector("#mapping-columns select").value'),'text');
 assert.ok(await review('document.getElementById("candidate-rows").textContent.includes("=Seller")'));
 assert.equal(await review('location.search'),'');
 assert.match(await browser.evaluate('document.querySelector("#toolkit-market-capture p").textContent'),/Capture opened in the workbench/);
 // A replay or unrelated message cannot replace a review already received.
 await review(`window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',data:{channel:'toolkit-market-bridge-v1',action:'capture',capture:{}}}))`);
 assert.match(await review('document.getElementById("counts").textContent'),/3 candidates.*0 approved/);
 await review('document.getElementById("download-capture").click()');
 for(let i=0;i<100&&!(await readdir(dir)).includes('captured-source.json');i++)await new Promise(r=>setTimeout(r,50));
 const evidence=JSON.parse(await readFile(join(dir,'captured-source.json'),'utf8'));assert.equal(evidence.market_capture.observations.length,2);assert.equal(evidence.market_capture.offers.length,3);
 await review(`document.getElementById('select-eligible').click();document.getElementById('batch-reviewer').value='Synthetic test';document.getElementById('batch-note').value='Compared intercepted fixture';document.getElementById('batch-confirm').checked=true;document.getElementById('batch-confirm').dispatchEvent(new Event('change'));document.getElementById('approve-batch').click()`);
 for(let i=0;i<100;i++){if((await review('document.getElementById("counts").textContent')).includes('3 approved'))break;await new Promise(r=>setTimeout(r,50));}
 assert.match(await review('document.getElementById("counts").textContent'),/3 approved/);
 await review('document.getElementById("approved-csv").click()');
 for(let i=0;i<100&&!(await readdir(dir)).includes('interpretation-approved.csv');i++)await new Promise(r=>setTimeout(r,50));
 assert.match(await readFile(join(dir,'interpretation-approved.csv'),'utf8'),/'=Seller/);
 await review('document.getElementById("save-workbench").click()');
 let backupName;
 for(let i=0;i<100;i++){backupName=(await readdir(dir)).find(f=>f.includes('workbench')&&f.endsWith('.json'));if(backupName)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(backupName,'Source and all reviews backup downloaded');
 const backup=JSON.parse(await readFile(join(dir,backupName),'utf8'));
 assert.equal(backup.source.captured_source.market_capture.observations.length,2);
 await review(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(backup))}],'workbench.json'));document.getElementById('workbench-backup').files=dt.files;document.getElementById('restore-workbench').click();})()`);
 for(let i=0;i<100;i++){if((await review('document.getElementById("status").textContent')).includes('Restored source coverage'))break;await new Promise(r=>setTimeout(r,50));}
 assert.match(await review('document.getElementById("status").textContent'),/Restored source coverage/);
 assert.match(await review('document.getElementById("counts").textContent'),/3 approved/);
 const fallback=await review(`(async()=>{const capture=${JSON.stringify(result)};const v=await ToolkitFiles.importFile(new File([JSON.stringify(capture)],'market-capture.json'));let rejected=false;try{await ToolkitFiles.importMarketCapture({...capture,observations:[{...capture.observations[0],source_url:'https://evil.example/market/'}]})}catch{rejected=true}return {rows:v.captured_source.market_capture.offers.length,rejected};})()`);assert.equal(fallback.rows,3);assert.equal(fallback.rejected,true);
 await writeFile('.wrangler/market-direct-review.png',Buffer.from((await browser.send('Page.captureScreenshot',{captureBeyondViewport:true},sessionId)).data,'base64'));
 console.log('PASS real cross-origin popup handoff, pending review, text sale IDs, coverage, retained evidence, hostile-message guard and JSON fallback.');
 await browser.evaluate(`document.body.insertAdjacentHTML('beforeend','<div class="js-offers-modal show"><a class="js-offers-modal-page" href="/market/character/?id=42"></a></div>');Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent==='Capture loaded offers').click()`);
 assert.match(await browser.evaluate('document.querySelector("#toolkit-market-capture p").textContent'),/still loading/);
 await browser.evaluate(`document.querySelector('.js-offers-modal').remove();document.getElementById('market-search').value='changed';Array.from(document.querySelectorAll('#toolkit-market-capture button')).find(b=>b.textContent==='Capture loaded offers').click()`);
 assert.match(await browser.evaluate('document.querySelector("#toolkit-market-capture p").textContent'),/settings changed/);
 const partial=summarizeMarket(result.observations.slice(0,1));assert.equal(partial.cards[0].advertised_minus_observed,1);assert.equal(partial.cards[0].coverage_status,'partial');
 await mkdir('.wrangler',{recursive:true});await writeFile('.wrangler/market-helper-test.png',Buffer.from((await browser.send('Page.captureScreenshot')).data,'base64'));
 console.log('PASS market bookmarklet, distinct sale IDs, repeat-capture deduplication, coverage, no requests/purchases/account data, loading/filter guards and actual CSV/JSON downloads.');
}finally{await browser?.close();await mf.dispose();await rm(dir,{recursive:true,force:true});}
