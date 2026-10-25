import { publicURL } from '../src/public-network.js';
import { launchBrowser } from './browser-cdp.mjs';
import { loadPublicResource } from './browser-public-fetch.mjs';

function readTables() {
 const roots=[...document.querySelectorAll('table,[role=table],[role=grid]')].filter(t=>t.getClientRects().length&&!t.parentElement?.closest('table,[role=table],[role=grid]'));
 if(roots.length>20)throw Error('More than 20 rendered tables; use a smaller source.');
 let totalRows=0,totalCells=0;
 return roots.map((root,index)=>{
  const issues=[];const selector='table,[role=table],[role=grid]';
  const lines=[...root.querySelectorAll('tr,[role=row]')].filter(r=>r.getClientRects().length&&r.closest(selector)===root);
  const matrix=lines.map(r=>[...r.querySelectorAll('th,td,[role=columnheader],[role=cell],[role=gridcell]')].filter(c=>c.closest('tr,[role=row]')===r));
  if(matrix.some(cells=>cells.some(c=>c.hasAttribute('rowspan')&&c.rowSpan!==1||c.hasAttribute('colspan')&&c.colSpan!==1)))issues.push('Merged cells require manual mapping; this table cannot be exported.');
  if(root.querySelector('table,[role=table],[role=grid]'))issues.push('Nested table structure is unsupported.');
  const hasHeader=matrix[0]?.length&&matrix[0].every(c=>c.tagName==='TH'||c.getAttribute('role')==='columnheader');
  const width=Math.max(0,...matrix.map(r=>r.length));
  if(width>100)throw Error('More than 100 columns.');
  const values=matrix.map(cells=>cells.map(c=>{const value=(c.innerText??c.textContent).replace(/\s+/g,' ').trim();if(value.length>10000)throw Error('A rendered cell exceeds 10,000 characters.');return value;}));
  const headers=hasHeader?values.shift():Array.from({length:width},(_,i)=>'Column '+(i+1));
  const rows=values.filter(r=>r.length);
  totalRows+=rows.length;totalCells+=matrix.reduce((n,r)=>n+r.length,0);
  if(totalRows>5000||totalCells>50000)throw Error('Rendered tables exceed 5,000 rows or 50,000 cells.');
  if(rows.some(r=>r.length!==headers.length))issues.push('Inconsistent cell counts require mapping; this table cannot be exported.');
  return {id:'rendered-'+(index+1),caption:root.querySelector('caption')?.textContent.trim()||root.getAttribute('aria-label')||'Table '+(index+1),headers,rows,issues,supported:issues.length===0};
 });
}
export async function renderPage(input,{loadResource=loadPublicResource,timeoutMs=12000}={}) {
 const source=publicURL(input).href;const browser=await launchBrowser();
 const cancellation=new AbortController();let active=0;
 const blocked=[];let requests=0,bytes=0,redirects=0,mainError=null,scriptErrors=0,finished=false;
 const note=(url,reason)=>{if(blocked.length<20)blocked.push({url,reason});};
 const deadline=Date.now()+timeoutMs;
 try {
  await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable');
  await browser.send('Network.setBypassServiceWorker',{bypass:true});
  await browser.send('Network.setBlockedURLs',{urls:['ws://*','wss://*','file://*','ftp://*']});
  await browser.send('Browser.setDownloadBehavior',{behavior:'deny'});
  const mainFrame=(await browser.send('Page.getFrameTree')).frameTree.frame.id;
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}],handleAuthRequests:true});
  browser.on(event=>{
   if(event.method==='Runtime.exceptionThrown')scriptErrors++;
   if(event.method==='Fetch.authRequired')void browser.send('Fetch.continueWithAuth',{requestId:event.params.requestId,authChallengeResponse:{response:'CancelAuth'}}).catch(()=>{});
   if(event.method!=='Fetch.requestPaused')return;
   const p=event.params;
   void (async()=>{
    try {
     if(finished||Date.now()>deadline)throw Error('Rendering deadline reached.');
     if(++requests>64)throw Error('Request limit reached (64).');
     publicURL(p.request.url);
     if(p.resourceType==='Document'&&p.frameId!==mainFrame)throw Error('Embedded frames are not rendered.');
     if(p.request.method!=='GET')throw Error('Only read-only GET requests are supported.');
     if(!['Document','Script','XHR','Fetch','Stylesheet'].includes(p.resourceType))throw Error('Images, media, fonts and other resources are disabled.');
     while(active>=4){if(finished||Date.now()>deadline)throw Error('Rendering deadline reached.');await new Promise(r=>setTimeout(r,50));}
     if(finished)throw Error('Browser job finished.');
     let response;active++;
     try{response=await loadResource(p.request.url,{signal:cancellation.signal});}finally{active--;}

     if(finished)return;
     bytes+=response.body.length;if(bytes>8*1024*1024)throw Error('Total resource limit reached (8 MiB).');
     if(response.body.length>2*1024*1024)throw Error('Resource exceeds 2 MiB.');
     if(response.status>=300&&response.status<400){if(++redirects>5)throw Error('Redirect limit reached.');const target=response.headers.get('location');if(!target)throw Error('Missing redirect destination.');publicURL(new URL(target,p.request.url).href);}
     if(p.resourceType==='Document'&&p.frameId===mainFrame&&response.status>=400)mainError='Source returned HTTP '+response.status+'. Blocked or login-protected pages are unsupported.';
     if(p.resourceType==='Document'&&response.status>=200&&response.status<300&&!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('The source must be an HTML page.');
     // No browser cookies, credentials, referer, or authorization are forwarded upstream.
     if(response.status>=400)note(p.request.url,'HTTP '+response.status+' response; some content may be missing.');
     const responseHeaders=[...response.headers].filter(([name])=>['content-type','content-security-policy','access-control-allow-origin','access-control-allow-credentials','location'].includes(name)).map(([name,value])=>({name,value}));
     await browser.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:response.status,responseHeaders,body:response.body.toString('base64')});
    }catch(e){note(p.request.url,e.message);if(p.resourceType==='Document'&&p.frameId===mainFrame)mainError=e.message;await browser.send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
   })();
  });
  const nav=browser.send('Page.navigate',{url:source}).catch(e=>{mainError=e.message;});
  let previous='',stableSince=Date.now(),tables=[];
  const started=Date.now();
  while(Date.now()<deadline){
   if(mainError)throw Error(mainError);
   try{
    tables=await browser.evaluate('('+readTables.toString()+')()');
    const signature=JSON.stringify(tables);if(signature!==previous){previous=signature;stableSince=Date.now();}
    if(tables.some(t=>t.rows.length)&&Date.now()-stableSince>=750&&Date.now()-started>=1000)break;
   }catch(e){if(e.message==='Page evaluation failed.')throw Error('Rendered table exceeds supported structure or size bounds.');}
   await new Promise(r=>setTimeout(r,100));
  }
  await nav;if(mainError)throw Error(mainError);
  const finalURL=await browser.evaluate('location.href');publicURL(finalURL);
  return {source,final_url:finalURL,retrieved_at:new Date().toISOString(),method:'local-chromium-v1',tables,
   diagnostics:{requests,resource_bytes:bytes,script_errors:scriptErrors,blocked_resources:blocked,
    message:tables.length?'Rendered table snapshot captured. Later updates, pagination, scrolling and virtualized rows may be absent; review before export.':'No supported tables appeared within the render window. Canvas, images, login barriers and non-table layouts are not interpreted.'}};
 }finally{finished=true;cancellation.abort();await browser.close();}
}
