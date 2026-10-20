import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const simple='<table><caption>Prices &amp; stock</caption><tr><th>Product</th><th>Price</th></tr><tr><td><a>Widget</a></td><td>$12</td></tr><tr><td>Gadget</td><td>$20</td></tr></table>';
const response=html=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
function dns(r,ips=['8.8.8.8']){const type=new URL(r.url).searchParams.get('type');return Response.json({Status:0,Answer:ips.filter(ip=>ip.includes(':')===(type==='AAAA')).map(data=>({type:type==='A'?1:28,data}))})}
const post=(mf,url,extra={})=>mf.dispatchFetch('https://toolkit.example.org/api/tables',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),...extra});
test('Stage 1 discovery, URL safeguards, redirects and bounded extraction in workerd',async()=>{
 let html=simple,status=200,content='text/html',ips=['8.8.8.8'],location=null,calls=0,dnsDown=false;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:r=>{const u=new URL(r.url);if(u.hostname==='cloudflare-dns.com')return dnsDown?new Response('down',{status:503}):dns(r,ips);calls++;if(location&&u.pathname!='/final')return new Response(null,{status:302,headers:{location}});return new Response(html,{status,headers:{'content-type':content}})}}));
 try{
  html=simple+'<table><tr><td>First</td><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr></table>';
  let r=await post(mf,'https://tables.example.org/prices#section'),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.source,'https://tables.example.org/prices');assert.equal(d.tables.length,2);assert.equal(d.tables[0].title,'Prices & stock');assert.deepEqual(d.tables[0].headers,['Product','Price']);assert.deepEqual(d.tables[0].rows,[['Widget','$12'],['Gadget','$20']]);assert.equal(d.tables[0].unsupported,null);assert.deepEqual(d.tables[1].headers,['Column 1','Column 2']);assert.equal(d.tables[1].rows[0][1],'<script>alert(1)</script>');
  calls=0;
  for(const url of ['http://public.org/','https://localhost/','https://127.1/','https://0x7f000001/','https://[::1]/','https://user:pass@public.org/','https://public.org:8443/','https://machine.local/','https://toolkit.example.org/','https://public.org./','file:///etc/passwd'])assert.equal((await post(mf,url)).status,400,url);
  assert.equal(calls,0);
  for(ips of [['10.1.1.1'],['8.8.8.8','192.168.1.1'],['::ffff:127.0.0.1'],['169.254.169.254'],['2001:db8::1']])assert.equal((await post(mf,'https://tables.example.org/')).status,400);
  assert.equal(calls,0);ips=['8.8.8.8'];dnsDown=true;assert.equal((await post(mf,'https://tables.example.org/')).status,502);dnsDown=false;
  html=simple;location='/final';r=await post(mf,'https://tables.example.org/start');d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.source,'https://tables.example.org/final');
  location='https://127.0.0.1/';calls=0;assert.equal((await post(mf,'https://tables.example.org/start')).status,400);assert.equal(calls,1);
  location='/loop';calls=0;assert.equal((await post(mf,'https://tables.example.org/start')).status,422);assert.equal(calls,4);location=null;
  for(html of ['<html>No tables<script>render()</script></html>','x'.repeat(2*1024*1024+1),Array(21).fill('<table><tr><td>one</td></tr></table>').join('')]){r=await post(mf,'https://tables.example.org/');assert.equal(r.status,422,JSON.stringify(await r.json()))}
  for(html of ['<table><tr><td colspan="2">merged</td></tr></table>','<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>','<table><tr><th>Header</th></tr><tr><td>one</td><td>two</td></tr></table>']){r=await post(mf,'https://tables.example.org/');d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.ok(d.tables.every(t=>t.unsupported))}
  html='{}';content='application/json';assert.equal((await post(mf,'https://tables.example.org/')).status,422);content='text/html';status=403;assert.equal((await post(mf,'https://tables.example.org/')).status,422);
  calls=0;assert.equal((await mf.dispatchFetch('https://toolkit.example.org/api/tables')).status,405);assert.equal((await post(mf,'https://tables.example.org/',{headers:{origin:'https://other.org','content-type':'application/json'}})).status,403);assert.equal((await post(mf,'https://tables.example.org/',{headers:{'content-type':'text/plain'}})).status,415);
  for(const body of ['{','null','{}'])assert.equal((await post(mf,'unused',{body})).status,400);assert.equal(calls,0);
  const page=await (await mf.dispatchFetch('https://toolkit.example.org/')).text();assert.match(page,/Choose a table/);assert.match(page,/textContent=value/);assert.match(page,/\/example/);
 }finally{await mf.dispose()}
});
