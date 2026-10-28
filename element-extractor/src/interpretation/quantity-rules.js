// Explicit monetary facts and grouped counts. Existing prose-v2 remains replayable unchanged.
import {canonical,ContractError,LIMITS} from './pipeline.js';
import {PROSE_SCHEMA,extractProseRules} from './prose-rules.js';
export const QUANTITY_VERSION='quantitative-prose-v1';
export const QUANTITY_SCHEMA={fields:PROSE_SCHEMA.fields.map(f=>f.name==='value'?{...f,number_format:'en-US-grouped',min:-Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER}:{...f})};
const amount='[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const flag=/\b(?:not|never|no|correction|corrected|revised|instead|however|previously|disputed|forecast|projected|estimated)\b/i;
const mask=text=>text.replace(/https?:\/\/[^\s)"<>]+/g,s=>' '.repeat(s.length));
export function hasRichQuantities(text){return typeof text==='string'&&text.length<=16000&&(/\$\s*[+-]?\d/.test(mask(text))||/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\s+(?:workers|employees|users|articles|pages|people|households|companies|students|patients)\b/i.test(mask(text)));}
export function extractQuantities(packet){
 if(canonical(packet.schema)!==canonical(QUANTITY_SCHEMA))throw new ContractError('quantity_schema','Quantitative prose columns do not match their schema.');
 const records=[],seen=new Set();
 const add=(p,quote,measure,value,unit,qualifier=null,uncertain=false)=>{
  measure=measure.trim().replace(/[\s,;:.]+$/,'');if(!measure||!/[\p{L}]/u.test(measure))return;
  if(quote.length>LIMITS.quote)throw new ContractError('quote_limit','A quantitative statement exceeds the evidence limit.');
  const local=p.text.indexOf(quote);if(local<0)throw new ContractError('quantity_evidence','Quantitative quote is not in its passage.');
  const key=canonical([p.id,quote,measure,value,unit]);if(seen.has(key))return;seen.add(key);
  if(records.length>=LIMITS.records)throw new ContractError('record_limit','More than fifty quantitative records. Use a smaller section; nothing was truncated.');
  const evidence=[{passage_id:p.id,quote,occurrence:0}],field=v=>({value:v,evidence:v===null?[]:evidence});
  const r={id:'row-'+(records.length+1),fields:{measure:field(measure),value:field(value),unit:field(unit),qualifier:field(qualifier)}};
  if(uncertain)r.issues=['This quantitative statement contains correction, uncertainty or negation. Correct the candidate and revalidate before approval.'];records.push(r);
 };
 // Keep rates, ungrouped counts and existing subject associations from the pinned parser.
 const old=extractProseRules({...packet,schema:PROSE_SCHEMA},'prose-facts-v2');for(const r of old.records){r.id='row-'+(records.length+1);records.push(r);}
 for(const p of packet.passages){
  const searchable=mask(p.text),sentences=[...searchable.matchAll(/[^.!?\n]*(?:\.(?!\s|$)[^.!?\n]*)*(?:[.!?](?=\s|$)|$)/g)].filter(m=>m[0].trim());
  for(const sentence of sentences){
   const raw=p.text.slice(sentence.index,sentence.index+sentence[0].length).trim(),s=sentence[0].trim(),uncertain=flag.test(s);
   const basis=s.match(/\b(hourly|annually|annual|per hour|per year)\b/i)?.[0]||null;
   // Parenthetical amounts bind only to their immediately preceding list label.
   let end=0;for(const m of s.matchAll(new RegExp('\\(\\s*\\$\\s*('+amount+')\\s*\\)','g'))){
    let label=s.slice(end,m.index).trim();end=m.index+m[0].length;const intro=[...label.matchAll(/\b(?:included|include|including|followed by)\s+/gi)].at(-1);if(intro)label=label.slice(intro.index+intro[0].length);else if(label.includes(':'))label=label.slice(label.lastIndexOf(':')+1);label=label.replace(/^[\s,;]+/,'').replace(/^(?:and|or)\s+/i,'').trim();if(label.length>180||/[\d.!?]/.test(label))continue;
    // Keep the full sentence if it supplies an explicit hourly/annual basis.
    const start=s.lastIndexOf(label,m.index),quote=basis?raw:raw.slice(start,m.index+m[0].length);
    add(p,quote,label,Number(m[1].replaceAll(',','')),'$',basis,uncertain);
   }
   let m=s.match(new RegExp('^(.{1,180}?)\\s+(?:was|were|is|are|reached|totaled|costs?|earned|reported revenue of|had revenue of)\\s+(?:(about|approximately|roughly|over|at least)\\s+)?\\$\\s*('+amount+')(?:\\s+(?:per hour|per year|hourly|annually))?[.!?]?$','i'));
   if(m)add(p,raw,m[1],Number(m[3].replaceAll(',','')),'$',m[2]||basis,uncertain);
   const wage=s.match(new RegExp('^(.{1,180}?)\\s+had\\s+(?:an?|the)\\s+(?:average\\s+)?(?:\\(mean\\)\\s+)?hourly wage of\\s+\\$\\s*('+amount+')(?=\\s|[,.!?]|$)','i'));
   if(wage){add(p,raw,wage[1],Number(wage[2].replaceAll(',','')),'$',s.match(/hourly/i)[0],uncertain);const other=s.match(new RegExp('compared (?:to|with) (?:the )?(nationwide average) of\\s+\\$\\s*('+amount+')','i'));if(other)add(p,raw,other[1],Number(other[2].replaceAll(',','')),'$',s.match(/hourly/i)[0],uncertain);}
   for(const count of s.matchAll(/(?<![\w.,-])((?:\d{1,3})(?:,\d{3})+(?:\.\d+)?)\s+(workers|employees|users|articles|pages|people|households|companies|students|patients)\b/gi)){
    const subject=s.match(new RegExp('^(.{1,150}?)\\s+(?:has|had|employs|employed|reported)\\s+'+count[1].replaceAll(',','[,]')+'\\s+'+count[2]+'[.!?]?$','i'))?.[1];
    add(p,raw,subject||count[2],Number(count[1].replaceAll(',','')),count[2],null,uncertain);
   }
  }
 }
 for(const r of records)if(Number.isInteger(r.fields.value.value)&&!Number.isSafeInteger(r.fields.value.value))r.issues=[...(r.issues||[]),'This integer exceeds safe numeric precision. Retain its exact source text; do not approve a rounded numeric value.'];
 return {version:'candidates-v1',records,outcomes:packet.passages.map(p=>{const ids=records.filter(r=>Object.values(r.fields).some(f=>f.evidence.some(e=>e.passage_id===p.id))).map(r=>r.id);return {passage_id:p.id,status:ids.length?'records':'no_result',record_ids:ids,reason:ids.length?'Explicit quantities recognized, including supported dollar amounts and grouped counts. Coverage may be incomplete.':'No supported quantitative relationship recognized. Text is retained; numbers alone are not interpreted.'};})};
}
