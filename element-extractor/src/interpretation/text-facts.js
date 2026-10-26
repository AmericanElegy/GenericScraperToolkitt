// Bounded noun-answer relations; this is not general prose understanding.
import {ContractError,LIMITS,canonical} from './pipeline.js';
import {PROSE_SCHEMA,extractProseRules} from './prose-rules.js';
export const TEXT_FACTS_VERSION='text-relations-v1';
export const TEXT_FACTS_SCHEMA={fields:[
 {name:'subject',type:'string',required:true},{name:'relationship',type:'string',required:false},{name:'answer',type:'string',required:true},
 {name:'numeric_value',type:'number',required:false},{name:'unit',type:'string',required:false},{name:'qualifier',type:'string',required:false},{name:'time_context',type:'string',required:false},
]};
const measure='most (?:popular|viewed|visited|read|watched|downloaded)|best[- ]selling|highest[- ]rated|top[- ]ranked';
function relation(raw){
 const text=raw.trim().replace(/[.!?]$/,'').trim();let m;
 if((m=text.match(new RegExp('^(?:The )?('+measure+') (.{1,120}?)(?: (?:in|of|for) (\\d{4}))? (?:is|was|are|were) (.{1,300})$','i'))))return {subject:m[2],relationship:m[1],answer:m[4],time_context:m[3]||null};
 if((m=text.match(/^(?:The )?(capital|winner|category) of (.{1,120}?) (?:is|was|are|were) (.{1,300})$/i)))return {subject:m[2],relationship:m[1],answer:m[3],time_context:null};
 if((m=text.match(/^(.{1,120}?) (belongs to) (.{1,300})$/i)))return {subject:m[1],relationship:m[2],answer:m[3],time_context:null};
 if((m=text.match(/^(.{1,300}?) (?:is|was) the (capital|winner) of (.{1,120})$/i)))return {subject:m[3],relationship:m[2],answer:m[1],time_context:null};
 return null;
}
function sentences(text){return [...text.matchAll(/[^.!?\n]*(?:\.(?!\s|$)[^.!?\n]*)*(?:[.!?](?=\s|$)|$)/g)].filter(m=>m[0].trim());}
function accepted(raw){const value=relation(raw);if(!value||/^(?:not|never)\b/i.test(value.answer)||/\b(?:but|while|whereas|instead|however|corrected|revised|forecast|projected|estimated)\b/i.test(raw))return null;return value;}
export function hasTextRelations(text){return typeof text==='string'&&text.length<=16000&&sentences(text.replace(/https?:\/\/[^\s)"<>]+/g,s=>' '.repeat(s.length))).some(m=>accepted(m[0]));}
export function assertTextFactConsistency(response){for(const r of response.records){const n=r.fields.numeric_value?.value,answer=r.fields.answer?.value;if(n!==null&&n!==undefined&&(!/^[+-]?\d+(?:\.\d+)?$/.test(answer)||Number(answer)!==n))throw new ContractError('fact_value_mismatch','The literal answer and numeric value disagree. Correct both fields or retain the answer as text.');}}
export function extractTextFacts(packet){
 if(canonical(packet.schema)!==canonical(TEXT_FACTS_SCHEMA))throw new ContractError('text_fact_schema','Text relationship columns do not match their schema.');
 const records=[];
 const push=fields=>{if(records.length>=LIMITS.records)throw new ContractError('record_limit','More than 50 recognized facts. Use a smaller source section; nothing was truncated.');const r={id:'row-'+(records.length+1),fields};records.push(r);return r;};
 for(const p of packet.passages){
  const masked=p.text.replace(/https?:\/\/[^\s)"<>]+/g,s=>' '.repeat(s.length));
  for(const m of sentences(masked)){
   const raw=p.text.slice(m.index,m.index+m[0].length).trim(),value=accepted(raw);if(!value)continue;
   if(raw.length>LIMITS.quote)throw new ContractError('quote_limit','A recognized statement exceeds the evidence limit.');
   const local=p.text.indexOf(raw,m.index);let occurrence=0,at=p.text.indexOf(raw);while(at>=0&&at<local){occurrence++;at=p.text.indexOf(raw,at+1);}
   const evidence=[{passage_id:p.id,quote:raw,occurrence}];
   const field=value=>({value,evidence:value===null?[]:evidence});
   push({subject:field(value.subject),relationship:field(value.relationship),answer:field(value.answer),numeric_value:field(null),unit:field(null),qualifier:field(null),time_context:field(value.time_context)});
  }
 }
 // Preserve existing numerical facts alongside noun answers instead of dropping them.
 const numeric=extractProseRules({...packet,schema:PROSE_SCHEMA});
 for(const r of numeric.records){
  const f=r.fields,value=f.value.value;let literal;
  for(const e of f.value.evidence){literal=[...e.quote.matchAll(/[+-]?\d+(?:\.\d+)?/g)].find(m=>Number(m[0])===value)?.[0];if(literal)break;}
  if(!literal)throw new ContractError('fact_literal','Numeric fact has no supported literal representation.');
  const empty={value:null,evidence:[]};
  const next=push({subject:f.measure,relationship:empty,answer:{value:literal,evidence:f.value.evidence},numeric_value:f.value,unit:f.unit,qualifier:f.qualifier,time_context:empty});
  if(r.issues)next.issues=r.issues;
 }
 const response={version:'candidates-v1',records,outcomes:packet.passages.map(p=>{const ids=records.filter(r=>Object.values(r.fields).some(f=>f.evidence.some(e=>e.passage_id===p.id))).map(r=>r.id);return{passage_id:p.id,status:ids.length?'records':'no_result',record_ids:ids,reason:ids.length?'Recognized explicit text relationships and/or quantitative facts. Noun answers remain text; unrecognized relationships may still be present.':'No supported noun relationship or quantitative fact recognized. Text is retained, not fully interpreted.'};})};
 assertTextFactConsistency(response);return response;
}
export function textFactMeaning(){return{kind:'text_relationships',title:'Recognized facts',context:null,explanation:'Explicit subject–relationship–answer statements are recognized. Answers may be names or nouns. Numerical facts are retained separately with their units. Unsupported prose is not interpreted, and every relationship still needs source review.'};}
