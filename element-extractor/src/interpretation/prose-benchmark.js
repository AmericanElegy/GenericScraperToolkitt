// Strict comparison of a draft answer key, not a population accuracy estimate.
export function compareProse(expected,actual){
 const fields=['subject','fact','answer','unit','time'];
 const remaining=new Set(actual.map((_,i)=>i)),matched=[],missed=[];
 for(const e of expected){const i=[...remaining].find(i=>fields.every(k=>(actual[i][k]??null)===(e[k]??null))&&actual[i].quotes?.some(q=>typeof q==='string'&&q.length>0&&e.evidence.includes(q)));
  if(i===undefined)missed.push(e);else{remaining.delete(i);matched.push({expected:e,actual:actual[i]});}}
 return {matched,missed,extra:[...remaining].map(i=>actual[i]),expected:expected.length,proposed:actual.length,strict_matches:matched.length};
}
export function candidateClaims(view){return view.validation.records.map(r=>{
 const f=r.fields,value=name=>f[name]?.value??null;
 return {id:r.id,subject:value('subject')??value('measure')??value('entity_name'),fact:value('relationship'),answer:value('numeric_value')??value('answer')??value('value')??value('score'),unit:value('unit'),time:value('time_context'),quotes:[...new Set(Object.values(f).flatMap(v=>v.evidence.map(e=>e.quote)))],issues:r.issues||[],review_status:r.review_status};
});}
