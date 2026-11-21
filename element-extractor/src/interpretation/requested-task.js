import {ContractError}from './pipeline.js';
export const TASK_VERSION='requested-columns-v1';
export function validateTask(task){
 if(!task||Object.keys(task).some(k=>!['description','diagram_relevance','relevance_note'].includes(k))||typeof task.description!=='string'||!task.description.trim()||task.description.length>2000||!['undecided','supplementary','include','exclude'].includes(task.diagram_relevance)||typeof task.relevance_note!=='string'||task.relevance_note.length>1000||task.diagram_relevance==='exclude'&&!task.relevance_note.trim())throw new ContractError('invalid_task','Describe the requested output and record a reason before excluding diagrams.');
 return task;
}
export function emptyTaskResponse(packet){return {version:'candidates-v1',records:[],outcomes:packet.passages.map(p=>({passage_id:p.id,status:'no_result',record_ids:[],reason:'Requested columns are ready. No automatic rule or provider result has supplied records for this task; inspect the source or add a candidate manually.'}))};}
export function taskResponse(job){
 validateTask(job.task);
 if(!job.proposal)return emptyTaskResponse(job.packet);
 const p=job.proposal;
 if(Object.keys(p).some(k=>!['provider','model','source_hash','candidates'].includes(k))||!['openai','anthropic'].includes(p.provider)||typeof p.model!=='string'||p.model.length>100||p.source_hash!==job.packet.source.text_hash)throw new ContractError('invalid_proposal','The AI proposal must describe its provider and match this exact source snapshot.');
 return p.candidates;
}
