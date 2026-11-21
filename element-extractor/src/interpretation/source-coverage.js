// Coverage records describe captured content, never claim the original was read completely.
export function sourceCoverage(parts,datasets) {
  return parts.map((part,i)=>{
    const matches=datasets.filter(d=>part.table_key?d.table_key===part.table_key:part.text&&d.text.includes(part.text)).map(d=>d.id);
    const error=part.error||(!matches.length&&part.kind==='table'?'This table has no supported review selection. Inspect the source and capture notes.':null);
    return {...part,...(error?{error}:{}),id:'part-'+(i+1),dataset_ids:matches,status:part.kind==='image'||error?'unsupported':'pending',note:error||''};
  });
}
export function coverageCounts(parts){
  const counts={pending:0,reviewed:0,excluded:0,unsupported:0};
  for(const p of parts)counts[p.status]++;
  return counts;
}
