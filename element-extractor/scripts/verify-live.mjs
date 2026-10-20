import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// curl honors the cloud environment's proxy and trusted CA configuration.
const html=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://en.wikipedia.org/wiki/List_of_chemical_elements'],{maxBuffer:5*1024*1024}).toString();
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:()=>new Response(html,{headers:{'content-type':'text/html'}})}));
try {
 const r=await mf.dispatchFetch('https://demo.test/api/elements');const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.count,118);assert.equal(d.elements[0].name,'Hydrogen');assert.equal(d.elements[117].name,'Oganesson');
 const csv=await mf.dispatchFetch('https://demo.test/elements.csv');assert.equal(csv.status,200);assert.equal((await csv.text()).trim().split('\r\n').length,119);
 console.log('PASS: freshly downloaded Wikipedia HTML extracted in workerd; 118 elements, Hydrogen through Oganesson; 119 CSV lines.');
} finally {await mf.dispose()}
