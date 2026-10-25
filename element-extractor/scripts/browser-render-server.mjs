import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { publicURL } from '../src/public-network.js';
import { renderPage } from './render-page.mjs';
import { pathToFileURL } from 'node:url';
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>JavaScript Table Renderer</title><style>body{font:16px system-ui;color:#203149;background:#f5f7fa;margin:0}main{max-width:1100px;margin:auto;padding:24px}section,form,details{background:white;border:1px solid #dfe5ed;border-radius:10px;padding:18px;margin:16px 0}h1{font-size:28px}label{display:block;margin:10px 0}input,select,button{font:inherit;padding:10px;border:1px solid #bac8d9;border-radius:6px}input[type=url]{width:75%}button{background:#245a84;color:white;cursor:pointer}button:disabled{opacity:.4}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto;max-height:65vh}.hint{font-size:14px;color:#596d84}#status{line-height:1.5}input,select{max-width:100%}</style><script src="/client.js" defer></script><main><h1>JavaScript Table Renderer</h1><p>Local browser extraction for public pages that build tables with JavaScript.</p><p class="hint">A fresh browser profile per request. No login, paid service, AI, OCR or video downloads. Only public HTTPS read-only requests are allowed. Installed Chrome, Edge or Chromium is required.</p><form id="render"><label for="url">Public HTTPS webpage</label><input id="url" type="url" required placeholder="https://example.org/results"><button id="go">Render tables</button></form><p id="status" role="status">Enter a URL to begin.</p><section id="results" hidden><label for="tables">Rendered table</label><select id="tables"></select><label for="search">Search snapshot</label><input id="search" type="search"><p id="count"></p><p id="table-issues"></p><div class="scroll"><table><thead id="head"></thead><tbody id="rows"></tbody></table></div><p><button id="csv" disabled>CSV</button> <button id="json" disabled>JSON</button> <button id="tsv" disabled>TSV for column mapping</button></p><p class="hint">Exports include all rows captured for this table, independent of search. This is a timed snapshot: pagination, later updates, scrolling and virtualized rows may be missing. Review the source before using the data.</p></section><details id="diagnostics"><summary>Rendering diagnostics</summary><pre id="details"></pre></details><p class="hint">This local companion does not change the public Cloudflare Worker. Stop its terminal to stop the service.</p></main></html>`;
export async function startRenderServer({port=8791,renderer=renderPage}={}) {
 const client=await readFile(new URL('./browser-render-client.js',import.meta.url),'utf8');let busy=false;
 const server=createServer(async(req,res)=>{
  const origin='http://'+req.headers.host;
  const reply=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(body):body)};
  if(!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||'')){reply(403,{error:'Use the loopback address printed by this server.'});return;}
  if(req.method==='GET'&&req.url==='/'){reply(200,html,'text/html;charset=utf-8');return;}
  if(req.method==='GET'&&req.url==='/client.js'){reply(200,client,'text/javascript;charset=utf-8');return;}
  if(req.url!=='/api/render'){reply(404,{error:'Not found'});return;}
  if(req.method!=='POST'){reply(405,{error:'POST required'});return;}
  if(req.headers.origin&&req.headers.origin!==origin){reply(403,{error:'Cross-origin requests are blocked.'});return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(415,{error:'JSON required'});return;}
  if(busy){reply(429,{error:'One browser job is already running. Try again when it finishes.'});return;}
  busy=true;
  try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){reply(413,{error:'Request exceeds 4 KiB.'});return;}}
   let parsed;try{parsed=JSON.parse(body)}catch{reply(400,{error:'Invalid JSON'});return;}
   if(!parsed||Array.isArray(parsed)||Object.keys(parsed).some(k=>k!=='url')||typeof parsed.url!=='string'){reply(400,{error:'Provide one public HTTPS URL.'});return;}
   publicURL(parsed.url);reply(200,await renderer(parsed.url));
  }catch(e){reply(400,{error:e.message})}finally{busy=false;}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=await startRenderServer({port:Number(process.env.RENDER_PORT||8791)});console.log('Local JavaScript renderer: http://127.0.0.1:'+server.address().port);for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));}
