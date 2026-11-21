import {execFile}from 'node:child_process';import {promisify}from 'node:util';import {readFile,writeFile,mkdir}from 'node:fs/promises';import {resolve,join,dirname,sep}from 'node:path';import {unzipSync}from 'fflate';import {createHash}from 'node:crypto';
const run=promisify(execFile),app=resolve('.'),repo=resolve('..');
const revision=(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim();
const status=(await run('git',['status','--porcelain'],{cwd:repo})).stdout.trim();if(status)throw Error('Commit the intended release before verifying its tracked source artifact.');
const dir=join(app,'.wrangler','release-verification',revision+'-'+Date.now()),source=join(dir,'source'),archive=join(dir,'source.zip');await mkdir(source,{recursive:true});
await run('git',['archive','--format=zip','--output='+archive,revision],{cwd:repo});
for(const [name,bytes]of Object.entries(unzipSync(await readFile(archive)))){
 const destination=resolve(source,name);if(!destination.startsWith(source+sep))throw Error('Archive path escaped the verification directory.');
 if(/(?:^|\/)(?:\.dev\.vars[^/]*|\.env[^/]*|node_modules|\.wrangler)(?:\/|$)/.test(name))throw Error('Private or generated runtime state was present in the tracked archive.');
 if(name.endsWith('/')){await mkdir(destination,{recursive:true});continue;}await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
}
const fresh=join(source,'element-extractor'),environment={...process.env};for(const key of Object.keys(environment))if(/OPENAI|ANTHROPIC|CLAUDE|CLOUDFLARE|CF_.*TOKEN/i.test(key))delete environment[key];
async function npm(args){const result=await run(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/s','/c','npm.cmd',...args]:args,{cwd:fresh,env:environment,maxBuffer:4000000});return result.stdout;}
console.log('Installing the locked dependencies into a tracked-source archive, without credentials or another Git checkout.');await npm(['ci','--no-audit','--no-fund']);await npm(['run','build']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),expected=hash(await readFile(join(app,'worker-code.txt'))),actual=hash(await readFile(join(fresh,'worker-code.txt')));
if(expected!==actual)throw Error('The clean source artifact did not reproduce the current Worker bundle.');
console.log('Fresh source produced the exact Worker bundle. Running its regression suite.');const tests=await npm(['test']);
const report={revision,verified_at:new Date().toISOString(),worker_sha256:actual,source_directory:fresh,credentials_copied:false,status:'passed',test_summary:tests.split('\n').filter(l=>/tests |pass |fail /i.test(l)).slice(-5)};await writeFile(join(dir,'verification.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(app,'.wrangler','source-verification.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: locked install, byte-identical build and regression tests from tracked source only.');
