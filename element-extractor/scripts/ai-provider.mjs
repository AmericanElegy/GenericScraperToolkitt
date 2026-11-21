import {providerRequest}from '../src/interpretation/provider-contract.js';import {budgetedCall}from './ai-budget.mjs';
export async function extractWithProvider({provider,key,packet,task,directory='.wrangler/ai-evaluation',fetchImpl=fetch}){
 if(!key)throw Error('Provider credential is not configured. No call was sent.');
 const {body,reserved,config}=providerRequest(provider,packet,task);
 return budgetedCall(directory,reserved,{provider,model:config.model,source_hash:packet.source.text_hash},async()=>{
  const started=Date.now();const url=provider==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages';
  const headers=provider==='openai'?{'content-type':'application/json',authorization:'Bearer '+key}:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'};
  const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const raw=await response.text();if(raw.length>500000)throw Error('Provider response exceeds the bounded response size.');
  if(!response.ok){let detail;try{detail=JSON.parse(raw).error?.message;}catch{}const safe=typeof detail==='string'?detail.replaceAll(key,'[redacted]').slice(0,800):'';throw Error('Provider request failed with HTTP '+response.status+'. '+safe+' No automatic retry was made.');}
  let result;try{result=JSON.parse(raw);}catch{throw Error('Provider returned invalid JSON.');}
  if(provider==='openai'&&result.status!=='completed'||provider==='anthropic'&&result.stop_reason!=='end_turn')throw Error('Provider did not complete the response. Partial output was not imported.');
  const content=provider==='openai'?result.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join(''):result.content?.filter(c=>c.type==='text').map(c=>c.text).join('');
  let candidates;try{candidates=JSON.parse(content);}catch{throw Error('Provider did not return a complete candidate JSON object.');}
  const rawCandidates=structuredClone(candidates);
  if(provider==='anthropic')for(const record of candidates.records||[])if(Array.isArray(record.fields)){
    const fields={};for(const f of record.fields){const column=packet.schema.fields.find(c=>c.name===f.name);if(!column||Object.hasOwn(fields,f.name)||f.value_text!==null&&f.value_number!==null)throw Error('Provider returned ambiguous or duplicate field slots.');fields[f.name]={value:column.type==='string'?f.value_text:f.value_number,evidence:f.evidence};}record.fields=fields;
  }
  const usage=provider==='openai'?{input:result.usage?.input_tokens,output:result.usage?.output_tokens}:{input:result.usage?.input_tokens,output:result.usage?.output_tokens};
  if(!Number.isFinite(usage.input)||!Number.isFinite(usage.output))throw Error('Provider usage was missing. The conservative reservation remains charged.');
  return {provider,model:result.model||config.model,candidates,raw_candidates:rawCandidates,usage,usage_cost_usd:(usage.input*config.input+usage.output*config.output)/1000000,latency_ms:Date.now()-started};
 });
}
