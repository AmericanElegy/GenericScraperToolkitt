// Bounded selections of one captured table. Row ordinals are captured positions, never inferred joins.
import {ContractError,canonical,digest,LIMITS} from './pipeline.js';
import {rankShape,rankingPlan} from './ranking-rules.js';
const fail=message=>{throw new ContractError('table_selection',message);};
export function descriptiveTableName(title,headers){
 const actual=String(title||'').slice(0,180);
 if(!/^(?:Accessible table|Table) \d+$/i.test(actual))return (/^item$/i.test(headers[0])&&/^count$/i.test(headers[1])?actual+' — item counts':actual).slice(0,180);
 const lead=headers[0]||'Rows',others=headers.slice(1,4).join(', ');
 return (lead+' comparison'+(others?' — '+others+(headers.length>4?'…':''):'' )).slice(0,180);
}
export function capturedTableCatalog(datasets){
 const groups=new Map();
 for(const d of datasets){if(!d.grid)continue;if(!groups.has(d.table_key))groups.set(d.table_key,[]);groups.get(d.table_key).push(d);}
 const catalog=[];
 for(const [key,parts]of groups){
  const columns=[...new Set(parts.flatMap(p=>p.column_indices))].sort((a,b)=>a-b),labels=new Map(),rows=new Map();
  for(const part of parts){
   part.column_indices.forEach((c,i)=>{if(labels.has(c)&&labels.get(c)!==part.grid.headers[i])fail('Captured column headings disagree.');labels.set(c,part.grid.headers[i]);});
   part.grid.rows.forEach((cells,i)=>{const row=part.row_start+i;if(!rows.has(row))rows.set(row,new Map());const target=rows.get(row);part.column_indices.forEach((c,j)=>{if(target.has(c)&&target.get(c)!==cells[j])fail('Overlapping captured cells disagree.');target.set(c,cells[j]);});});
  }
  const parent={version:'captured-table-v1',key,title:parts[0].table_title,name:parts[0].table_name,source_rows:parts[0].total_rows,source_columns:parts[0].total_columns,columns:columns.map(index=>({index,label:labels.get(index)})),rows:[...rows].sort((a,b)=>a[0]-b[0]).map(([index,cells])=>({index,cells:columns.map(c=>cells.has(c)?cells.get(c):null)}))};
  catalog.push(parent);
 }
 return catalog;
}
function validateParent(p){
 if(!p||p.version!=='captured-table-v1'||typeof p.key!=='string'||p.key.length>100||typeof p.title!=='string'||p.title.length>2048||/[\t\r\n]/.test(p.title)||typeof p.name!=='string'||p.name.length>180||!Number.isInteger(p.source_rows)||p.source_rows<1||p.source_rows>5000||!Number.isInteger(p.source_columns)||p.source_columns<2||p.source_columns>100||!Array.isArray(p.columns)||p.columns.length<2||p.columns.length>100||!Array.isArray(p.rows)||!p.rows.length||p.rows.length>800||canonical(p).length>500000)fail('Captured table is outside the supported size or shape.');
 if(p.columns.some((c,i)=>!Number.isInteger(c.index)||c.index<0||c.index>=p.source_columns||i&&c.index<=p.columns[i-1].index||typeof c.label!=='string'||c.label.length>2048))fail('Captured source columns must be distinct and ordered.');
 if(p.rows.some((r,i)=>!Number.isInteger(r.index)||r.index<1||r.index>p.source_rows||i&&r.index<=p.rows[i-1].index||!Array.isArray(r.cells)||r.cells.length!==p.columns.length||r.cells.some(c=>c!==null&&(typeof c!=='string'||c.length>2048||/[\t\n\r]/.test(c)))))fail('Captured source rows must retain their original positions and cells.');
}
export async function selectCapturedTable(parent,options){
 validateParent(parent);
 if(!options||Object.keys(options).some(k=>!['columns','first_row','last_row'].includes(k))||!Array.isArray(options.columns)||options.columns.length<2||options.columns.length>8||new Set(options.columns).size!==options.columns.length||options.columns.some(c=>!Number.isInteger(c)||!parent.columns.some(p=>p.index===c)))fail('Choose 2–8 distinct captured columns.');
 if(!Number.isInteger(options.first_row)||!Number.isInteger(options.last_row)||options.first_row<1||options.last_row<options.first_row||options.last_row>parent.source_rows)fail('Choose a valid source row range.');
 const selected=parent.rows.filter(r=>r.index>=options.first_row&&r.index<=options.last_row);
 if(selected.length!==options.last_row-options.first_row+1)fail('That row range includes rows that were not captured. Choose a smaller captured range.');
 if(selected.length>50)fail('Choose no more than 50 source rows per review.');
 const positions=options.columns.map(c=>parent.columns.findIndex(p=>p.index===c)),headers=positions.map(i=>parent.columns[i].label),rows=selected.map(r=>positions.map(i=>{if(r.cells[i]===null)fail('A selected cell was not captured. Choose available rows and columns.');return r.cells[i];}));
 const line=cells=>cells.join('\t'),ranked=rankShape(headers),context=ranked&&parent.title.length<=500?'Table context: '+parent.title+'\n\n':'';
 if(headers.some(h=>/[\t\n\r]/.test(h))||[headers,...rows].some(r=>line(r).length>LIMITS.quote))fail('The selected header or row exceeds the evidence size limit.');
 const text=context+[headers,...rows].map(line).join('\n');if(text.length>LIMITS.text)fail('Selected text exceeds 16,000 characters. Choose fewer rows or columns.');
 const ranking=rankingPlan(text); // Also checks expanded ranking record limits.
 const selection={version:'table-slice-v1',parent,parent_hash:await digest(parent),columns:[...options.columns],first_row:options.first_row,last_row:options.last_row};
 const label=(parent.name+' · selected rows '+options.first_row+'–'+options.last_row+' of '+parent.source_rows+' · columns '+options.columns.map(c=>c+1).join(', ')).slice(0,1000);
 return {kind:'table',label,text,snapshot_hash:await digest(text),row_count:rows.length,column_count:headers.length,record_count:ranking?.factCount||rows.length,table_key:parent.key,table_selection:selection,table_preview:{headers,rows:rows.slice(0,3)},total_columns:parent.source_columns};
}
export async function validateTableSelection(selection,text){
 if(!selection||selection.version!=='table-slice-v1'||Object.keys(selection).some(k=>!['version','parent','parent_hash','columns','first_row','last_row'].includes(k)))fail('Invalid saved table selection.');
 const result=await selectCapturedTable(selection.parent,{columns:selection.columns,first_row:selection.first_row,last_row:selection.last_row});
 if(selection.parent_hash!==result.table_selection.parent_hash||text!==result.text)fail('Selected content does not match the retained captured table and row/column choices.');
 return result;
}
