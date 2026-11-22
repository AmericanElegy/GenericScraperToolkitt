import readExcel from 'read-excel-file/universal';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import {unzipSync,strFromU8} from 'fflate';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {tableDatasets,proseDatasets} from './source-fetch.js';
import {capturedTableCatalog} from './table-selection.js';
import {digest} from './pipeline.js';
import {sourceCoverage} from './source-coverage.js';
import {summarizeMarket} from '../market-capture.js';

GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
const MAX_FILE=10*1024*1024,MAX_TEXT=500000;
const fail=message=>{throw Error(message);};
function unzip(data) {
  let total=0,count=0;
  return unzipSync(new Uint8Array(data),{filter:entry=>{
    total+=entry.originalSize;
    if(++count>3000||total>32*1024*1024)fail('Expanded document exceeds 32 MiB / 3,000 parts. Use a smaller file; nothing was imported.');
    return true;
  }});
}
const xml=(zip,path)=>zip[path]?strFromU8(zip[path]):'';
const value=v=>v instanceof Date?v.toISOString():v==null?'':String(v);
function table(title,rows,issues) {
  if(!rows.length)return {title,headers:[],rows:[],unsupported:'Empty sheet or table.'};
  const width=Math.max(...rows.map(r=>r.length));
  if(width>100||rows.length>5001)fail(title+': exceeds 5,000 data rows / 100 columns. Nothing from this file was imported.');
  const grid=rows.map(r=>Array.from({length:width},(_,i)=>value(r[i])));
  if(grid.some(r=>r.some(c=>c!==c.replace(/\s+/g,' ').trim())))issues.push(title+': cell whitespace is normalized for review. Download the captured source to retain exact cell text.');
  if(grid[0].some(c=>!c.trim()))issues.push(title+': blank headers received positional names; verify that the first row is a header.');
  return {title,headers:grid[0].map((c,i)=>c||'Column '+(i+1)),rows:grid.slice(1),raw_rows:grid};
}
function pdfText(items) {
  const lines=[];
  for(const item of items.filter(i=>typeof i.str==='string')) {
    const y=item.transform[5];
    let line=lines.find(l=>Math.abs(l.y-y)<2);
    if(!line){line={y,items:[]};lines.push(line);}
    line.items.push(item);
  }
  return lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' ').trim()).filter(Boolean).join('\n');
}
export async function importFile(file) {
  if(!file||file.size>MAX_FILE)fail('Choose a file up to 10 MiB. Nothing was imported.');
  const ext=file.name.toLowerCase().split('.').pop();
  if(ext==='json')return importMarketCapture(JSON.parse(await file.text()));
  if(!['xlsx','csv','pdf','docx','txt','tsv'].includes(ext))fail('Unsupported file. Use .xlsx, .csv, .pdf, .docx, .txt or .tsv. Save older .xls / .doc documents in the newer format first.');
  const data=await file.arrayBuffer(),issues=[],tables=[],blocks=[],inventory=[],retained=[],sourceParts=[];
  if(ext==='xlsx') {
    const zip=unzip(data);
    if(!zip['xl/workbook.xml'])fail('This is not a readable .xlsx workbook. Encrypted workbooks are unsupported.');
    for(const path of Object.keys(zip).filter(k=>/^xl\/worksheets\/.*\.xml$/.test(k))) {
      for(const m of xml(zip,path).matchAll(/\b(?:r|ref)="(?:[A-Z]+\d+:)?([A-Z]+)(\d+)"/g)) {
        const column=[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
        if(column>100||Number(m[2])>5001)fail('Excel sheet dimensions exceed 5,001 rows / 100 columns. Remove unused distant cells or use a smaller file; nothing was imported.');
      }
    }
    issues.push('Excel: first populated row is treated as headings. Review all sheets separately. Formatting, charts, images and macros are not extracted; formulas use saved results and are never recalculated. Dates use ISO text.');
    if(/state="(?:hidden|veryHidden)"/.test(xml(zip,'xl/workbook.xml')))issues.push('Workbook includes hidden sheets; they are listed too.');
    if(Object.keys(zip).some(k=>/^xl\/worksheets\/.*\.xml$/.test(k)&&/<(?:\w+:)?f[ >]/.test(xml(zip,k))))issues.push('Formula cells detected. Cached values may be missing or stale; compare with Excel before approving.');
    // Keep merged sheets visible as unsupported rather than inventing filled cells.
    const merged=Object.keys(zip).filter(k=>/^xl\/worksheets\/.*\.xml$/.test(k)&&/<(?:\w+:)?mergeCell[ >]/.test(xml(zip,k)));
    if(merged.length)issues.push('Merged cells detected. Sheet grids retain blank covered cells; their meaning is uncertain. Unmerge or edit a copy in Excel before relying on those rows.');
    const sheets=await readExcel(data,{trim:false,parseNumber:s=>s});
    for(const sheet of sheets) {
      const t=table('Sheet: '+sheet.sheet,sheet.data,issues);tables.push(t);retained.push(t);
      inventory.push(t.title+': '+t.rows.length+' data rows, '+t.headers.length+' columns'+(t.unsupported?' · '+t.unsupported:''));
    }
  } else if(ext==='csv'||ext==='tsv') {
    let text;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('CSV must be UTF-8. Save it as CSV UTF-8; nothing was imported.');}
    const parsed=Papa.parse(text,{delimiter:ext==='tsv'?'\t':',',skipEmptyLines:false});
    if(parsed.errors.length)fail('CSV could not be read safely: '+parsed.errors.map(e=>e.message).join('; '));
    const rows=parsed.data;
    // A final line terminator does not introduce a source record.
    if(/\r?\n$/.test(text)&&rows.at(-1)?.length===1&&rows.at(-1)[0]==='')rows.pop();
    const width=rows[0]?.length;
    if(rows.some(r=>r.length!==width))fail('CSV rows have different cell counts, including any blank lines. Repair the source; no rows were dropped.');
    const t=table(file.name,rows,issues);tables.push(t);retained.push({text,...t});inventory.push('CSV: '+t.rows.length+' data rows, '+t.headers.length+' columns. First row treated as headings.');
  } else if(ext==='docx') {
    const zip=unzip(data);
    if(!zip['word/document.xml'])fail('This is not a readable .docx document. Encrypted documents are unsupported.');
    const result=await mammoth.convertToHtml({arrayBuffer:data},{externalFileAccess:false,convertImage:mammoth.images.imgElement(()=>Promise.resolve({src:''}))});
    const doc=new DOMParser().parseFromString(result.value,'text/html');
    issues.push('Word: tables and paragraph text are captured separately. Layout, headers/footers, images, text boxes and tracked changes may be incomplete. Compare with the original document.');
    const styleMessages=result.messages.filter(m=>/^Unrecognised (?:paragraph|run) style:/.test(m.message));
    if(styleMessages.length)issues.push('Word: '+styleMessages.length+' custom formatting styles were simplified. Their text is retained; original formatting is not reproduced. Technical details are retained in captured source.');
    issues.push(...result.messages.filter(m=>!styleMessages.includes(m)).map(m=>'Word: '+m.message));
    const images=doc.querySelectorAll('img').length;
    if(images)issues.push('Word: '+images+' images were not read. Any text, diagrams or data inside them require manual review or external OCR.');
    retained.push({conversion_messages:result.messages,unread_images:images});
    // Walk source order before separating tables from prose. Never insert source HTML.
    let paragraph=0,image=0,wordTable=0;
    function visit(el){
      if(el.tagName==='TABLE'){
        const rows=[...el.rows].map(r=>[...r.cells].map(c=>c.textContent));
        sourceParts.push({label:'Word table '+(++wordTable),kind:'table',table_key:'source-table-'+wordTable,rows});
        for(const img of el.querySelectorAll('img'))sourceParts.push({label:'Image '+(++image)+' in table '+wordTable,kind:'image',text:img.alt||'',error:'Image content was not read. Inspect the original or use external OCR.'});
        return;
      }
      if(el.tagName==='IMG'){sourceParts.push({label:'Image '+(++image),kind:'image',text:el.alt||'',error:'Image content was not read. Inspect the original or use external OCR.'});return;}
      if(/^(P|H[1-6]|LI)$/.test(el.tagName)){
        if(el.textContent.trim())sourceParts.push({label:'Text block '+(++paragraph),kind:'text',text:el.textContent});
        for(const img of el.querySelectorAll('img'))visit(img);
        return;
      }
      for(const child of el.children)visit(child);
    }
    visit(doc.body);
    let index=0;
    for(const el of doc.querySelectorAll('table')) {
      if(el.parentElement.closest('table'))continue;
      const t=table('Word table '+(++index),[...el.rows].map(r=>[...r.cells].map(c=>c.textContent)),issues);
      if(el.querySelector('table')||[...el.querySelectorAll('td,th')].some(c=>c.colSpan>1||c.rowSpan>1))t.unsupported='Merged or nested Word table; use a simple unmerged table.';
      tables.push(t);retained.push(t);inventory.push(t.title+': '+t.rows.length+' rows'+(t.unsupported?' · '+t.unsupported:''));
      el.remove();
    }
    const paragraphs=[...doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')].filter(e=>!e.parentElement.closest('li')).map(e=>e.textContent).filter(t=>t.trim());
    blocks.push(...paragraphs);retained.push({paragraphs});inventory.push('Word: '+paragraphs.length+' text blocks.');
  } else if(ext==='pdf') {
    issues.push('PDF text order and spacing are uncertain. Pages stay separate; table columns are not inferred. Edit copied text into tab-separated columns if needed. Embedded images are not read and may require OCR even on text pages.');
    const task=getDocument({data:new Uint8Array(data),isEvalSupported:false,useSystemFonts:true,disableFontFace:true,stopAtErrors:true});
    let pdf;
    try {
      try{pdf=await task.promise;}catch(e){if(e.name==='PasswordException')fail('Password-protected PDF. Save an unlocked copy before importing; nothing was imported.');throw e;}
      if(pdf.numPages>100)fail('PDF exceeds 100 pages. Split it first; nothing was imported.');
      for(let n=1;n<=pdf.numPages;n++) {
        try {
          const page=await pdf.getPage(n),text=pdfText((await page.getTextContent()).items);
          const note='PDF page '+n+(text.trim()?' · text PDF · reading order needs review':' · no readable text: scan/image/blank page; OCR required if content is visible');
          inventory.push(note);retained.push({page:n,text,note});
          if(text.trim())blocks.push({label:'PDF page '+n,text});else issues.push(note);
        }catch(e){const note='PDF page '+n+': not extracted — '+e.message;inventory.push(note);issues.push(note);retained.push({page:n,error:e.message});}
      }
    } finally {await task.destroy();}
  } else {
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('Text files must use UTF-8 encoding.');}
    blocks.push(text);retained.push({text});inventory.push('UTF-8 text file.');
  }
  if(JSON.stringify(retained).length>MAX_TEXT)fail('Captured source exceeds 500,000 characters. Use a smaller file; nothing was imported.');
  const datasets=tableDatasets(tables,issues);
  // Do not combine PDF pages: scans and missing text must remain attributable.
  const wordBlocks=blocks.filter(block=>typeof block==='string'&&block.length<=12000);
  if(ext==='docx'&&wordBlocks.length!==blocks.length)issues.push('Word: '+(blocks.length-wordBlocks.length)+' text blocks exceed the per-section limit and have no review selection. They remain visible in source preview and captured-source download.');
  const reviewBlocks=ext==='docx'?[{label:'Word text',paragraphs:wordBlocks}]:blocks;
  for(const block of reviewBlocks) {
    try {
      const parts=proseDatasets(typeof block==='string'?[block]:block.paragraphs||[block.text]);
      for(const [i,part]of parts.entries()){if(typeof block!=='string')part.label=block.label+(parts.length>1?' · part '+(i+1)+' of '+parts.length:'');datasets.push(part);}
    } catch(e){issues.push((typeof block==='string'?'Text section':block.label)+': not opened for review — '+e.message+'. Full text retained in captured source.');}
  }
  const table_catalog=capturedTableCatalog(datasets);
  for(const [i,d] of datasets.entries()){
    d.id='file-'+(i+1);d.snapshot_hash=await digest(d.text);
    if(d.grid){d.table_preview={headers:d.grid.headers,rows:d.grid.rows.slice(0,3)};delete d.grid;}
  }
  if(!datasets.length)issues.push('No reviewable selections. Check the inventory; scanned pages require OCR outside this tool. Captured source is still downloadable.');
  if(ext!=='docx')for(const entry of retained){
    if(entry.raw_rows||entry.title&&Array.isArray(entry.rows))sourceParts.push({label:entry.title,kind:'table',rows:entry.raw_rows||[entry.headers||[],...entry.rows],table_key:'source-table-'+(tables.indexOf(entry)+1),...(entry.unsupported?{error:entry.unsupported}:{})});
    else if(entry.page)sourceParts.push({label:'PDF page '+entry.page,kind:'text',text:entry.text||'',...(!entry.text?{error:entry.error||'No readable text. Inspect original; OCR may be required.'}:{})});
    else if(entry.text)sourceParts.push({label:'Source text',kind:'text',text:entry.text});
  }
  // CSV retained entries wrap the table; identify their table by position.
  for(const part of sourceParts)if(part.table_key==='source-table-0')part.table_key='source-table-1';
  for(const part of sourceParts)if(part.table_key){const t=tables[Number(part.table_key.split('-').at(-1))-1];if(t?.unsupported)part.error=t.unsupported;}
  const coverage=sourceCoverage(sourceParts,datasets);
  return {source:null,method:'browser-file',retrieved_at:new Date().toISOString(),datasets,table_catalog,issues,inventory,
    file:{name:file.name,format:ext},coverage,captured_source:{file:file.name,format:ext,inventory,issues,content:retained,coverage}};
}
export async function importMarketCapture(capture) {
  if(!capture||JSON.stringify(capture).length>MAX_TEXT||capture.format!=='toolkit-market-capture-v1'||!Array.isArray(capture.observations)||!capture.observations.length||capture.observations.length>50)fail('Unsupported or oversized market capture. Use the helper evidence JSON; nothing was imported.');
  let count=0;
  const scalar=v=>v===null||typeof v==='string'||typeof v==='number';
  for(const o of capture.observations){
    if(!Array.isArray(o.cards)||!Array.isArray(o.offers)||!Array.isArray(o.issues)||!Number.isFinite(Date.parse(o.captured_at)))fail('Invalid market observation; nothing was imported.');
    const url=new URL(o.source_url);if(url.origin!=='https://www.urban-rivals.com'||!url.pathname.startsWith('/market')||url.username||url.password)fail('Unsupported capture source; nothing was imported.');
    if((count+=o.offers.length)>10000)fail('Market capture exceeds 10,000 observed rows; nothing was imported.');
    for(const c of o.cards)if(typeof c.card_id!=='string'||!/^\d+$/.test(c.card_id)||!(c.name===null||typeof c.name==='string')||!(c.advertised_offers===null||Number.isSafeInteger(c.advertised_offers)&&c.advertised_offers>=0))fail('Invalid card coverage; nothing was imported.');
    for(const r of o.offers){
      if(typeof r.sale_id!=='string'||typeof r.card_id!=='string'||!/^\d+$/.test(r.sale_id)||!/^\d+$/.test(r.card_id)||!o.cards.some(c=>c.card_id===r.card_id)||!['quantity','price_clintz','level'].every(k=>r[k]===null||Number.isSafeInteger(r[k])&&r[k]>=0)||!['seller','power','damage','ability','time_remaining','edition_text'].every(k=>scalar(r[k])))fail('Invalid listing values; nothing was imported.');
    }
  }
  const report=summarizeMarket(capture.observations);
  if(!report.offers.length)fail('The capture has no supported listings; nothing was imported.');
  const fields=['sale_id','card_name','quantity','price_clintz','level','seller'];
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const csv=[fields,...report.offers.map(r=>fields.map(k=>r[k]))].map(row=>row.map(quote).join(',')).join('\r\n');
  const result=await importFile(new File([csv],'Market listings.csv',{type:'text/csv'}));
  const notes=[report.unique_cards+' cards; '+report.unique_observed_listings+' unique observed listings. Unreviewed capture from '+report.started_at+' to '+report.ended_at+'.',...report.cards.map(c=>(c.name||c.card_id)+': '+c.observed_unique_listings+' observed / '+(c.advertised_offers??'unknown')+' advertised; '+(c.coverage_status==='partial'?Math.max(0,c.advertised_minus_observed)+' not yet captured. Open View all and capture additional offer pages.':c.coverage_status==='count_matches_only'?'counts match; this does not prove complete coverage.':c.coverage_status==='unknown'?'advertised total unknown.':'counts changed during capture; compare with the source.')),report.notice,'Review shows six core columns. All other fields, raw cells, changes and capture issues remain in Download captured source and workbench backups.',...report.observations.flatMap(o=>o.issues.map(i=>'Capture issue: '+JSON.stringify(i)))];
  if(notes.some(n=>n.length>2048)||notes.length+result.issues.length>512||notes.length+result.inventory.length>512)fail('Market coverage notes exceed the review limits. Use a smaller capture; nothing was imported.');
  result.issues.push(...notes);result.inventory.push(...notes);
  result.file={name:'Browser market capture',format:'market-capture'};
  result.method='browser-market';result.source=report.observations[0].source_url;
  result.captured_source={...result.captured_source,market_capture:report,issues:result.issues,inventory:result.inventory};
  for(const d of result.datasets)d.mapping=fields.map(name=>({name,kind:['quantity','price_clintz','level'].includes(name)?'number':'text'}));
  // Coverage notes stay visible even when there are no parser errors.
  result.coverage.push(...notes.map((note,i)=>({id:'market-note-'+i,label:'Market coverage '+(i+1),kind:'limitation',text:note,dataset_ids:[],status:'pending',note:''})));
  return result;
}
globalThis.ToolkitFiles={importFile,importMarketCapture,digest};
