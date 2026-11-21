// Explicit live capture, separate from offline parsing and expected outputs.
import {execFile}from 'node:child_process';import {promisify}from 'node:util';
import {mkdir,readFile,writeFile}from 'node:fs/promises';import {createHash}from 'node:crypto';import {join}from 'node:path';
const run=promisify(execFile),manifest=JSON.parse(await readFile('test/fixtures/extraction-benchmark/expected.json','utf8'));
const directory=join('.wrangler','benchmarks','captures',new Date().toISOString().replaceAll(':','-'));await mkdir(directory,{recursive:true});const results=[];
for(const c of manifest.cases){
 const body=join(directory,c.id+'.html'),headers=join(directory,c.id+'.headers.txt');let status=null,error=null;
 try{const r=await run(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--location','--max-redirs','3','--max-time','20','--max-filesize','2097152','--proto','=https','--proto-redir','=https','--dump-header',headers,'--output',body,'--write-out','%{http_code}',c.url],{maxBuffer:3000000});status=Number(r.stdout);}catch(e){error=e.message;}
 const bytes=await readFile(body).catch(()=>null);
 results.push({id:c.id,url:c.url,http_status:status,status:status===200?'fetched_unparsed':status===401||status===403?'access_denied':'fetch_failed',error,body_path:bytes?body:null,headers_path:headers,body_sha256:bytes?createHash('sha256').update(bytes).digest('hex'):null,notice:'Raw response retained locally. No retry, access-barrier bypass, parser success claim, or expected-output update.'});
}
const report={captured_at:new Date().toISOString(),results,ai_calls:0};await writeFile(join(directory,'capture.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(results.some(r=>r.status!=='fetched_unparsed'))process.exitCode=2;
