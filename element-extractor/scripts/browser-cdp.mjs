import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function browserExecutable() {
 if(process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
 if(process.platform==='win32') {
  for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean))
   for(const relative of ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe']) {
    const path=join(base,relative);try{await access(path);return path}catch{}
   }
  throw Error('Chrome or Edge was not found. Set CHROMIUM_PATH to an installed Chromium browser.');
 }
 return 'chromium';
}
export async function launchBrowser({guardNetwork=true}={}) {
 const dir=await mkdtemp(join(tmpdir(),'toolkit-browser-'));
 const child=spawn(await browserExecutable(),['--headless','--disable-gpu','--disable-dev-shm-usage',
  '--disable-background-networking','--disable-extensions','--disable-sync','--no-first-run','--disable-default-apps',
  ...(guardNetwork?['--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>']:[]),
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+dir,
  ...(process.env.TOOLKIT_BROWSER_NO_SANDBOX==='1'?['--no-sandbox']:[]),'about:blank'],{stdio:'ignore'});
 let error;child.on('error',e=>error=e);
 let ws,seq=0;const pending=new Map(),listeners=new Set();
 const close=async()=>{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed.'));}pending.clear();ws?.close();
  if(child.exitCode===null && !child.killed){const ended=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([ended,new Promise(r=>setTimeout(r,1500))]);if(child.exitCode===null)child.kill('SIGKILL');}
  await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});
 };
 try {
  let port;
  for(let i=0;i<100;i++) {if(error)throw error;if(child.exitCode!==null)throw Error('Browser could not start. Check Chromium installation and sandbox support.');try{port=Number((await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await new Promise(r=>setTimeout(r,50));}
  if(!port)throw Error('Browser startup timed out.');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else for(const listener of listeners)listener(m);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Page evaluation failed: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'unknown exception'));return r.result.value;};
  return {send,evaluate,on:fn=>listeners.add(fn),close};
 }catch(e){await close();throw e;}
}
