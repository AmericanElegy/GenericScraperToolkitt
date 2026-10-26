import {digest} from './pipeline.js';
export const SNAPSHOT_FORMAT='toolkit-feedback-snapshot-v1';
// Append-only review lineage also records withdrawals and correction resets.
export async function makeFeedbackSnapshot(job,example){
 const history=[];
 for(const revision of job.revisions||[]){
  for(const event of revision.prior_events)history.push(await digest(event));
  const {prior_events,...change}=revision;history.push(await digest(change));
 }
 for(const event of job.events)history.push(await digest(event));
 const data={format:SNAPSHOT_FORMAT,session:job.packet.hash,history,example, ...(example?{}:{job})};
 return {...data,id:await digest(data)};
}
export async function checkSnapshotHash(snapshot){
 const {id,...data}=snapshot;
 if(snapshot.format!==SNAPSHOT_FORMAT||!/^[a-f0-9]{64}$/.test(id)||await digest(data)!==id)throw Error('Saved feedback checksum does not match.');
 if(!Array.isArray(snapshot.history)||snapshot.history.some(h=>!/^[a-f0-9]{64}$/.test(h))||!/^[a-f0-9]{64}$/.test(snapshot.session))throw Error('Saved feedback lineage is invalid.');
 return snapshot;
}
export function activeSnapshots(snapshots){
 const groups=new Map();for(const s of snapshots){if(!groups.has(s.session))groups.set(s.session,[]);groups.get(s.session).push(s);}
 const active=[],headsFound=[],conflicts=[];
 for(const [session,items]of groups){
  const heads=items.filter(a=>!items.some(b=>a.history.length<b.history.length&&a.history.every((h,i)=>b.history[i]===h)));
  if(heads.length!==1){conflicts.push(session);continue;}
  headsFound.push(heads[0]);if(heads[0].example)active.push(heads[0]);
 }
 return {active,heads:headsFound,conflicts};
}
