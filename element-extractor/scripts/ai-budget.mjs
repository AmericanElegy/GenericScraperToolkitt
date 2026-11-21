import {mkdir,open,readFile,writeFile,unlink}from 'node:fs/promises';import {join}from 'node:path';import {randomUUID}from 'node:crypto';
export async function budgetedCall(directory,reserved,metadata,operation){
 if(!Number.isFinite(reserved)||reserved<=0||reserved>5)throw Error('Invalid cost reservation.');
 await mkdir(directory,{recursive:true});const lock=join(directory,'budget.lock');let handle;
 try{handle=await open(lock,'wx',0o600);}catch{throw Error('AI evaluation ledger is locked. Another request may be running; no call was sent.');}
 const path=join(directory,'budget.json');
 try{
  let ledger;try{ledger=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('AI budget ledger is unreadable. No call was sent.');ledger={authorization:'James approved a maximum of US $5 total on November 21, 2026 for the personal workbench comparison only.',cap_usd:5,attempts:[]};}
  if(ledger.cap_usd!==5||!Array.isArray(ledger.attempts)||ledger.attempts.some(a=>!Number.isFinite(a.charged_usd)||a.charged_usd<0))throw Error('Invalid budget ledger. No call was sent.');
  const used=ledger.attempts.reduce((n,a)=>n+a.charged_usd,0);
  if(used+reserved>ledger.cap_usd)throw Error('The shared $5 AI evaluation budget would be exceeded. No call was sent.');
  const attempt={id:randomUUID(),...metadata,started_at:new Date().toISOString(),reserved_usd:reserved,charged_usd:reserved,status:'reserved'};ledger.attempts.push(attempt);await writeFile(path,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});
  try{const result=await operation();const cost=result.usage_cost_usd;if(!Number.isFinite(cost)||cost<0||cost>reserved)throw Error('Provider usage could not be reconciled within the reservation.');attempt.status='completed';attempt.charged_usd=cost;attempt.usage=result.usage;await writeFile(path,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});return {...result,reserved_usd:reserved};}
  catch(error){attempt.status='failed_or_uncertain';attempt.finished_at=new Date().toISOString();await writeFile(path,JSON.stringify(ledger,null,2)+'\n',{mode:0o600});throw error;}
 }finally{await handle.close();await unlink(lock);}
}
