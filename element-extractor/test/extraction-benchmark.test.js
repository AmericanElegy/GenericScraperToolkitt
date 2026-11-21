import {test}from 'node:test';import assert from 'node:assert/strict';
import {scoreTable}from '../src/interpretation/extraction-benchmark.js';
import {evaluateExtraction}from '../scripts/evaluate-extraction.mjs';
import {readFile}from 'node:fs/promises';import {Miniflare,convertV4MiniflareOptions}from 'miniflare';
test('frozen extraction reference cases retain all rows, values and exact evidence without automatic approvals',async()=>{
 const report=await evaluateExtraction();assert.equal(report.structured_cases_passed,true,JSON.stringify(report.results));assert.deepEqual(report.results.map(r=>r.expected_rows),[6,18,23]);
});
test('access-denied responses remain fetch failures without parsing or renderer fallback',async()=>{
 let renders=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile(new URL('../worker-code.txt',import.meta.url),'utf8'),compatibilityDate:'2026-10-01',serviceBindings:{LOCAL_RENDERER:()=>{renders++;return Response.json({});}},outboundService:r=>new URL(r.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(r.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response('<html>Access denied</html>',{status:403,headers:{'content-type':'text/html'}})}));
 try{const r=await mf.dispatchFetch('https://toolkit.example.org/api/interpretation/fetch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://www.bls.gov/regions/southeast/news-release/occupationalemploymentandwages_jacksonville.htm'})});assert.equal(r.status,422);const v=await r.json();assert.equal(v.datasets,undefined);assert.equal(renders,0);}finally{await mf.dispose();}
});
test('benchmark scoring detects missing rows, extras, swapped units, duplicate identities and changed values',()=>{
 const expected={columns:['name','percent','dollars'],rows:[['A',5,20],['B',10,30]]};
 const result=scoreTable(expected,[{name:'A',percent:20,dollars:5},{name:'A',percent:5,dollars:20},{name:'C',percent:0,dollars:0}]);
 assert.equal(result.pass,false);assert.deepEqual(result.missing_rows,['B']);assert.deepEqual(result.extra_rows,['A','C']);assert.equal(result.mismatches.length,2);
});
