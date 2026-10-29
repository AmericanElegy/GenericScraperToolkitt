// Review-only context. Never used to create evidence or approve a relationship.
export function evidenceContext(source,evidence,{document=false}={}){
 const start=document?evidence.document_start:evidence.source_start,end=document?evidence.document_end:evidence.source_end;
 if(typeof source!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>source.length||source.slice(start,end)!==evidence.quote)return null;
 const from=Math.max(0,start-350),to=Math.min(source.length,end+350);
 return {before:source.slice(from,start),quote:source.slice(start,end),after:source.slice(end,to),start:from,end:to,truncated_before:from>0,truncated_after:to<source.length,scope:document?'retained page':'current source snapshot'};
}
