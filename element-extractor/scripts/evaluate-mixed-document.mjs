import {readFile,writeFile,mkdir}from 'node:fs/promises';import {createHash}from 'node:crypto';
import {unzipSync,strFromU8}from 'fflate';import {DOMParser}from '@xmldom/xmldom';
import {Miniflare,convertV4MiniflareOptions}from 'miniflare';import {launchBrowser}from './browser-cdp.mjs';
const fixture=process.env.TOOLKIT_DOCX_FIXTURE;if(!fixture)throw Error('Set TOOLKIT_DOCX_FIXTURE to the private chemistry document. It will not be copied into tracked files or sent to an AI provider.');
const bytes=await readFile(fixture),manifest=JSON.parse(await readFile('test/fixtures/extraction-benchmark/expected.json','utf8')),expected=manifest.mixed_case;
const zip=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(zip['word/document.xml']),'text/xml');
const paragraphs=Array.from(xml.getElementsByTagName('w:p')).map(p=>Array.from(p.getElementsByTagName('w:t')).map(t=>t.textContent).join('')).filter(t=>t.trim());
let outbound=0,browser;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('worker-code.txt','utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0,outboundService:()=>{outbound++;throw Error('Mixed-document benchmark must remain offline.');}}));
try{
 const base=(await mf.ready).origin;browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Page.navigate',{url:base});
 for(let i=0;i<100;i++){if(await browser.evaluate('typeof globalThis.ToolkitFiles?.importFile === "function"'))break;await new Promise(r=>setTimeout(r,50));}
 const captured=await browser.evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));const result=await ToolkitFiles.importFile(new File([bytes],'chemistry.docx'));return {datasets:result.datasets,coverage:result.coverage,retained:result.captured_source.content};})()`);
 const text=captured.retained.flatMap(r=>r.paragraphs||[]).join('\n\n'),norm=s=>s.replace(/\s+/g,' ').trim(),normalized=norm(text);
 const missingParagraphs=paragraphs.filter(p=>!normalized.includes(norm(p))),actual=[];
 for(const d of captured.datasets){
  const response=await mf.dispatchFetch(base+'/api/interpretation/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({example_id:'custom-text',mode:'auto',source:{text:d.text,url:null}})});
  const view=await response.json();if(!response.ok)throw Error(view.error);
  actual.push(...view.validation.records.map(r=>Object.fromEntries(Object.entries(r.fields).map(([k,f])=>[k,f.value]))));
 }
 const missingMaterials=expected.desired_materials.filter(m=>!actual.some(r=>(r.material??r.material_name)===m));
 const missingFacts=expected.desired_facts.filter(f=>!actual.some(r=>(r.subject??r.measure)===f.subject&&(r.amount??r.value)===f.value&&r.unit===f.unit&&(!f.qualifier||r.qualifier===f.qualifier)));
 const report={format:'mixed-document-benchmark-v1',checked_at:new Date().toISOString(),source_sha256:createHash('sha256').update(bytes).digest('hex'),task:expected.task,capture:{original_text_paragraphs:paragraphs.length,captured_text_blocks:captured.retained.flatMap(r=>r.paragraphs||[]).length,missing_original_paragraphs:missingParagraphs.length,unread_images:captured.coverage.filter(p=>p.kind==='image'&&p.error).length,review_sections:captured.datasets.length,pass:missingParagraphs.length===0&&outbound===0},interpretation:{desired_material_rows:12,matched_material_rows:12-missingMaterials.length,desired_quantity_rows:4,matched_quantity_rows:4-missingFacts.length,actual_candidate_rows:actual.length,pass:missingMaterials.length===0&&missingFacts.length===0,missing_materials:missingMaterials,missing_facts:missingFacts},ai_calls:0,outbound_calls:outbound,notice:'Zero extraction remains a known quality gap, not a successful semantic benchmark. Diagrams are supplementary for this specific extraction task. No user approvals were created.'};
 await mkdir('.wrangler/benchmarks',{recursive:true});await writeFile('.wrangler/benchmarks/mixed-document.json',JSON.stringify(report,null,2)+'\n');
 console.log('Capture: '+(report.capture.pass?'PASS':'FAIL')+'; '+paragraphs.length+' original text paragraphs, '+missingParagraphs.length+' missing.');console.log('Interpretation: '+report.interpretation.matched_material_rows+'/12 materials and '+report.interpretation.matched_quantity_rows+'/4 quantity facts; '+actual.length+' candidate rows.');
 if(!report.capture.pass)process.exitCode=1;else if(!report.interpretation.pass)process.exitCode=2;
}finally{await browser?.close();await mf.dispose();}
