'use strict';
const $=id=>document.getElementById(id);let data,selected;
function draw(){
 selected=data?.tables[Number($('tables').value)];
 const rows=selected?.rows.filter(row=>row.join(' ').toLowerCase().includes($('search').value.toLowerCase()))||[];
 $('head').replaceChildren();$('rows').replaceChildren();
 if(selected){const tr=document.createElement('tr');for(const value of selected.headers){const th=document.createElement('th');th.textContent=value;tr.append(th)}$('head').append(tr);
 for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td)}$('rows').append(tr)}
 $('count').textContent=rows.length+' of '+selected.rows.length+' snapshot rows';
 $('table-issues').textContent=selected.issues.join(' ');}
 for(const id of ['csv','json','tsv'])$(id).disabled=!selected?.supported;
}
$('render').onsubmit=async event=>{event.preventDefault();$('go').disabled=true;$('results').hidden=true;data=null;selected=null;draw();$('status').textContent='Launching a fresh browser and waiting for rendered rows…';
 try{const response=await fetch('/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('url').value.trim()})});const value=await response.json();if(!response.ok)throw Error(value.error);data=value;
 $('status').textContent=data.diagnostics.message;$('details').textContent=JSON.stringify(data.diagnostics,null,2);$('diagnostics').open=!data.tables.length||data.diagnostics.blocked_resources.length>0;
 $('tables').replaceChildren(...data.tables.map((table,i)=>{const option=document.createElement('option');option.value=i;option.textContent=table.caption+' · '+table.rows.length+' rows';return option}));$('search').value='';$('results').hidden=!data.tables.length;draw();
 }catch(error){$('status').textContent=error.message}finally{$('go').disabled=false}};
$('tables').onchange=draw;$('search').oninput=draw;
function download(contents,type,extension){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download='rendered-table.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function safe(value){return /^[\s]*[=+@-]/.test(value)?"'"+value:value}
$('csv').onclick=()=>download([selected.headers,...selected.rows].map(row=>row.map(v=>'"'+safe(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n','text/csv;charset=utf-8','csv');
$('tsv').onclick=()=>download([selected.headers,...selected.rows].map(row=>row.map(safe).join('\t')).join('\n')+'\n','text/tab-separated-values;charset=utf-8','tsv');
$('json').onclick=()=>download(JSON.stringify({...data,tables:[selected]},null,2),'application/json','json');
