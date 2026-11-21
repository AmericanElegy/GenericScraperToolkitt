import {canonical} from './pipeline.js';
import {quoteWorkspaceCSV} from './workspace-core.js';

export async function exportTable(body,validate){
 const {parts,total_rows,format}=body;
 if(!['csv','json'].includes(format)||!Number.isInteger(total_rows)||total_rows<1||total_rows>5000||!Array.isArray(parts)||!parts.length||parts.length>32)throw Error('Choose a captured table with at most 32 batches.');
 const ordered=[...parts].sort((a,b)=>a.row_start-b.row_start),records=[],sources=[];
 let next=1,fields=null,identity=null,pending=0,rejected=0,unopened=0;
 for(const p of ordered){
  if(!Number.isInteger(p.row_start)||!Number.isInteger(p.row_count)||p.row_start!==next||p.row_count<1||p.row_count>50)throw Error('Table batches overlap or have missing captured rows. Export selections separately.');
  next+=p.row_count;
  if(!p.job){unopened+=p.row_count;continue;}
  const view=await validate(p.job),r=p.job.retrieval;
  if(!r||r.content_kind!=='table'||p.snapshot_hash!==p.job.packet.source.text_hash||view.validation.records.length!==p.row_count)throw Error('A review does not match its captured table batch.');
  const id=canonical([r.source,r.retrieved_at,p.job.packet.schema]);
  if(identity!==null&&id!==identity)throw Error('Table reviews use different captures or column mappings. Export selections separately.');
  identity=id;fields=p.job.packet.schema.fields;
  const seen=new Set();
  for(const row of view.validation.records){
   const n=Number(/^row-(\d+)$/.exec(row.id)?.[1]);
   if(!Number.isInteger(n)||n<1||n>p.row_count||seen.has(n))throw Error('Edited record positions cannot be combined safely. Export this selection separately.');
   seen.add(n);
   if(row.review_status==='approved')records.push({...row,source_row:p.row_start+n-1,snapshot_hash:p.snapshot_hash});
   else if(row.review_status==='rejected')rejected++;else pending++;
  }
  sources.push({row_start:p.row_start,row_count:p.row_count,job:p.job});
 }
 if(next!==total_rows+1||!fields)throw Error('The full captured table range is unavailable. Open a table review first.');
 records.sort((a,b)=>a.source_row-b.source_row);
 const coverage={source_rows:total_rows,approved:records.length,pending,rejected,unopened,excluded:total_rows-records.length};
 const result={format:'toolkit-table-export-v1',coverage,schema:fields,records,sources,notice:'Approved rows only. Pending, rejected and unopened rows are excluded and counted. Captured positions and grouping are descriptive, not authenticated provenance. JSON retains reviewed source text and history.'};
 const content=format==='json'?JSON.stringify(result,null,2)+'\n':[['source_row','record_id','review_status',...fields.map(f=>f.name)],...records.map(r=>[r.source_row,r.id,r.review_status,...fields.map(f=>r.fields[f.name].value)])].map(row=>row.map(quoteWorkspaceCSV).join(',')).join('\r\n')+'\r\n';
 return new Response(content,{headers:{'content-type':format==='csv'?'text/csv; charset=utf-8':'application/json','cache-control':'no-store','X-Exported-Records':String(records.length),'X-Excluded-Rows':String(coverage.excluded)}});
}
