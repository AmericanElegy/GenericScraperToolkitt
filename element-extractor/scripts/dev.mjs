import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const run=promisify(execFile);
// Use curl for outbound HTTP so this managed environment's proxy and CA trust
// are honored. This bridge is local tooling only; deployment uses native fetch.
const mf=new Miniflare(convertV4MiniflareOptions({
 modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),
 compatibilityDate:'2026-10-01',host:'127.0.0.1',port:8787,
 outboundService:async request=>{
  if(new URL(request.url).protocol!=='https:') return new Response('HTTPS only',{status:403});
  const {stdout}=await run('curl',['--silent','--show-error','--suppress-connect-headers','--include','--globoff','--compressed','--max-filesize','2097152','--proto','=https','--max-time','15','--user-agent',request.headers.get('user-agent')||'ElementExtractorDemo/0.1','--header','Accept: '+(request.headers.get('accept')||'text/html'),request.url],{maxBuffer:5*1024*1024});
  const split=stdout.indexOf('\r\n\r\n');if(split<0)throw Error('Invalid upstream response');
  const headers=stdout.slice(0,split);const status=Number(headers.match(/^HTTP\/\S+ (\d+)/)?.[1]);
  const contentType=headers.match(/^content-type:\s*(.+)$/im)?.[1].trim()||'application/octet-stream';
  return new Response(stdout.slice(split+4),{status,headers:{'content-type':contentType,...(headers.match(/^location:\s*(.+)$/im)?{location:headers.match(/^location:\s*(.+)$/im)[1].trim()}: {})}});
 }
}));
await mf.ready;
console.log('Web Table Toolkit running on port 8787 (local workerd, live HTTPS upstream).');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await mf.dispose();process.exit(0)});
