// Explicit rank positions only. Captions supply context; no popularity score is inferred.
import {ContractError, LIMITS, canonical} from './pipeline.js';
export const RANKING_VERSION='semantic-ranking-v1';
const fail=message=>{throw new ContractError('ranking_limit',message)};
export function rankShape(headers){
 const period=headers.findIndex(h=>/^(?:year|date|period|season)$/i.test(h.trim()));
 const ranks=headers.map((h,i)=>{const m=h.trim().match(/^(?:#\s*|rank\s+)(\d{1,3})$/i);return m?{index:i,rank:Number(m[1]),label:h.trim()}:null}).filter(Boolean);
 if(period>=0&&ranks.length===headers.length-1&&ranks.every(r=>r.rank>0)&&new Set(ranks.map(r=>r.rank)).size===ranks.length)return{period,ranks,wide:true,periodLabel:headers[period].trim()};
 const rank=headers.findIndex(h=>/^(?:rank|position|place)$/i.test(h.trim()));
 const item=headers.findIndex(h=>/^(?:item|title|name|article|topic|entry)$/i.test(h.trim()));
 if(rank>=0&&item>=0&&headers.length===(period<0?2:3))return{period,rank,item,wide:false,periodLabel:period>=0?headers[period].trim():null};
 return null;
}
export function rankingPlan(text){
 if(typeof text!=='string'||text.length>LIMITS.text)return null;
 const lines=[];let start=0;for(const raw of text.split('\n')){if(raw.trim())lines.push({quote:raw.trim(),start:start+raw.length-raw.trimStart().length});start+=raw.length+1;}
 let header,shape,delimiter,headerIndex;
 for(let i=0;i<Math.min(5,lines.length);i++){
  const value=lines[i].quote;if(value.startsWith('Table context: '))continue;
  const split=value.includes('\t')?'\t':value.includes('|')?'|':',';
  if(split===','&&value.includes('"'))continue;
  let cells=value.split(split).map(v=>v.trim());if(split==='|'){if(!cells[0])cells.shift();if(!cells.at(-1))cells.pop();}
  const found=rankShape(cells);if(found){header={...lines[i],cells};shape=found;delimiter=split;headerIndex=i;break;}
 }
 if(!shape)return null;
 const rows=[],unrecognized=[];
 for(const line of lines.slice(headerIndex+1)){
  if(delimiter==='|'&&/^\|?[\s:|-]+\|?$/.test(line.quote))continue;
  if(delimiter===','&&line.quote.includes('"')){unrecognized.push(line);continue;}
  let cells=line.quote.split(delimiter).map(v=>v.trim());if(delimiter==='|'){if(!cells[0])cells.shift();if(!cells.at(-1))cells.pop();}
  if(cells.every((c,i)=>c===header.cells[i]))continue;
  if(cells.length!==header.cells.length){unrecognized.push(line);continue;}
  rows.push({...line,cells});
 }
 if(!rows.length)return null;
 const factCount=rows.length*(shape.wide?shape.ranks.length:1);if(factCount>LIMITS.records)fail('This ranking produces more than 50 ranked items. Paste fewer source rows or fetch a bounded ranking selection.');
 const context=lines.slice(0,headerIndex).find(l=>l.quote.startsWith('Table context: '));
 const caption=context?.quote.slice('Table context: '.length)||null;
 const metricMatch=caption?.match(/\b(most\s+(?:viewed|popular|visited|read|watched|downloaded)|best[- ]selling|highest[- ]rated|top[- ]ranked)\b(?:\s+(.+?))?(?=\s+(?:of|on|in|by|for)\b|\[\d|$)/i);
 const metric=metricMatch?.[1]||null,category=metricMatch?.[2]?.trim()||null;
 const periodKey=shape.periodLabel?shape.periodLabel.toLowerCase():'period';
 const fields=[...(shape.period>=0?[{name:periodKey,type:'string',required:true}]:[]),{name:'rank',type:'number',required:true,min:1,max:999},{name:'item',type:'string',required:true},...(metric?[{name:'metric',type:'string',required:true}]:[]),...(category?[{name:'category',type:'string',required:true}]:[])];
 return {header,shape,rows,context,caption,metric,category,periodKey,schema:{fields},factCount,unrecognized};
}
export function sourceSpan(packet,line){
 const quote=line.quote.trim(),start=line.start+line.quote.length-line.quote.trimStart().length;
 const p=packet.passages.find(p=>start>=p.start&&start+quote.length<=p.end);
 if(!p||quote.length>LIMITS.quote)fail('Ranking evidence is outside a retained passage or exceeds the evidence limit.');
 let occurrence=0,at=p.text.indexOf(quote);while(at>=0&&p.start+at<start){occurrence++;at=p.text.indexOf(quote,at+1);}
 return {passage_id:p.id,quote,occurrence};
}
export function extractRanking(packet){
 const plan=rankingPlan(packet.source.text);if(!plan||canonical(plan.schema)!==canonical(packet.schema))fail('Ranking columns do not match the explicit source header.');
 const header=sourceSpan(packet,plan.header),context=plan.context?sourceSpan(packet,plan.context):null,records=[];
 for(const row of plan.rows){
  const rowSpan=sourceSpan(packet,row);
  const positions=plan.shape.wide?plan.shape.ranks:[{index:plan.shape.item,rank:/^[1-9]\d{0,2}$/.test(row.cells[plan.shape.rank])?Number(row.cells[plan.shape.rank]):null}];
  for(const position of positions){
   const field=(value,evidence)=>({value:value||value===0?value:null,evidence:value||value===0?evidence:[]});
   const fields={...(plan.shape.period>=0?{[plan.periodKey]:field(row.cells[plan.shape.period],[rowSpan,header])}:{}),rank:field(position.rank,[header,rowSpan]),item:field(row.cells[position.index],[rowSpan,header]),...(plan.metric?{metric:field(plan.metric,[context])}:{}),...(plan.category?{category:field(plan.category,[context])}:{})};
   records.push({id:'row-'+(records.length+1),fields});
  }
 }
 return {version:'candidates-v1',records,outcomes:packet.passages.map(p=>{const ids=records.filter(r=>Object.values(r.fields).some(f=>f.evidence.some(e=>e.passage_id===p.id))).map(r=>r.id);return{passage_id:p.id,status:ids.length?'records':'no_result',record_ids:ids,reason:ids.length?'Explicit source rank positions, item names and period/caption context retained. No numeric popularity score was inferred.':'Text outside the supported ranking remains retained and unprocessed.'};})};
}
export function rankingMeaning(packet){
 const p=rankingPlan(packet.source.text);return {kind:'ranking',title:'Ranked items',context:p.caption,metric:p.metric,category:p.category,source_rows:p.rows.length,record_count:p.factCount,
 explanation:p.metric?'Ranks come from the explicit headers; the ranking measure and category come from the quoted caption. Item names remain text.':'Ranks come from explicit headers. No ranking measure was supplied in the snapshot; popularity, views or scores were not inferred.',
 context_evidence:p.context?sourceSpan(packet,p.context):null,unsupported_items:p.unrecognized.length};
}
