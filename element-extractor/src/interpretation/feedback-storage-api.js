import {validatedFeedbackSnapshot} from './lab-api.js';
import {canonical} from './pipeline.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function feedbackStorage(request,env){
 const url=new URL(request.url),origin=request.headers.get('origin');
 if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Feedback storage is available only to the same-origin local app.'},403);
 if(request.method!=='POST'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Use a same-origin JSON POST.'},405);
 if(!env?.LOCAL_FEEDBACK)return reply({enabled:false,message:'Automatic feedback storage requires the normal local launcher. Portable downloads still work.'});
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return reply({error:'Feedback storage requires a loopback host.'},403);
 try{
  const reader=request.body?.getReader();if(!reader)throw Error('A JSON request body is required.');
  const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1000000){await reader.cancel();return reply({error:'Feedback request exceeds 1 MB.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!['status','configure','list','read','save'].includes(body.action))return reply({error:'Unknown feedback storage action.'},400);
  if(body.action==='save'){
   const snapshot=await validatedFeedbackSnapshot(body.job);
   const response=await env.LOCAL_FEEDBACK.fetch(new Request('http://feedback/save',{method:'POST',body:JSON.stringify({action:'save',snapshot})}));
   const stored=await response.json();return reply({...stored,...(response.ok?{snapshot}:{})},response.status);
  }
  const response=await env.LOCAL_FEEDBACK.fetch(new Request('http://feedback/'+body.action,{method:'POST',body:JSON.stringify(body)}));
  const data=await response.json();if(!response.ok)return reply(data,response.status);
  if(body.action==='read'){
   const snapshot=data.snapshot,job=snapshot?.example?.job||snapshot?.job;
   if(canonical(await validatedFeedbackSnapshot(job))!==canonical(snapshot))throw Error('Stored feedback differs from its validated review history.');
  }
  return reply(data);
 }catch(e){return reply({error:e.message||'Feedback storage failed.'},422);}
}
