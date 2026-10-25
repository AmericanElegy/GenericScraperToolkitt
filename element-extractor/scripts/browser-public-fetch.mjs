import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publicURL, publicAddress } from '../src/public-network.js';
const run=promisify(execFile);
async function curl(url,extra=[],signal) {
 const {stdout}=await run('curl',['--silent','--show-error','--suppress-connect-headers','--include','--globoff',
  '--compressed','--max-filesize','2097152','--proto','=https','--max-time','8',
  '--user-agent','GenericScraperToolkit/1.0 (local browser; public read-only pages)',...extra,url],{encoding:'buffer',maxBuffer:2200000,timeout:9000,signal});
 // Curl can include interim informational headers; find the final HTTP header block.
 let offset=0,split,status,head;
 do {split=stdout.indexOf('\r\n\r\n',offset);if(split<0)throw Error('Invalid upstream response.');head=stdout.subarray(offset,split).toString();status=Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]);offset=split+4;}while(status>=100&&status<200);
 const headers=new Headers();for(const line of head.split('\r\n').slice(1)){const at=line.indexOf(':');if(at>0)headers.append(line.slice(0,at),line.slice(at+1).trim());}
 return {status,headers,body:stdout.subarray(offset)};
}
export async function loadPublicResource(input,{signal}={}) {
 const url=publicURL(input);
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const query=new URL('https://cloudflare-dns.com/dns-query');query.searchParams.set('name',url.hostname);query.searchParams.set('type',type);
  const r=await curl(query.href,['--header','Accept: application/dns-json'],signal);
  if(r.status!==200)throw Error('Public DNS verification unavailable.');
  const data=JSON.parse(r.body.toString());if(data.Status!==0)throw Error('Public DNS lookup failed.');
  return (data.Answer||[]).filter(a=>a.type===1||a.type===28).map(a=>a.data);
 }));
 const ips=answers.flat();if(!ips.length||ips.some(ip=>!publicAddress(ip)))throw Error('Private, reserved and unresolved destinations are blocked.');
 // With a configured proxy, retain its routing/credential path. Direct desktop
 // connections pin the vetted address to avoid a DNS change between check and fetch.
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.ALL_PROXY||process.env.all_proxy;
 const resolve=proxy?[]:['--resolve',url.hostname+':443:'+(ips[0].includes(':')?'['+ips[0]+']':ips[0])];
 return curl(url.href,resolve,signal);
}
