import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {launchBrowser} from './browser-cdp.mjs';

const zip=files=>Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])))).toString('base64');
const xlsx=zip({
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Scores" sheetId="1" r:id="rId1"/><sheet name="Hidden notes" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
 ...Object.fromEntries([1,2].map(n=>['xl/worksheets/sheet'+n+'.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Score</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${n===1?'Alpha':'Beta'}</t></is></c><c r="B2"><f>1+11</f><v>12</v></c></row></sheetData></worksheet>`]))
});
const docx=zip({
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Widgets reached 12.6 percent.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Score</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Gamma</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>88</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
});
function pdfFixture() {
 const stream='BT /F1 12 Tf 50 750 Td (Widgets reached 12.6 percent.) Tj ET';
 const imageStream='q 512 0 0 692 50 50 cm /Im1 Do Q';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',`<< /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`,'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream'];
 let text='%PDF-1.4\n',offsets=[0];
 for(const [i,obj]of objects.entries()){offsets.push(text.length);text+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const size=objects.length+1,xref=text.length;text+=`xref\n0 ${size}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(text).toString('base64');
}
const html='<main><table><tr><th>Name</th><th>Score</th></tr><tr><td>Website</td><td>42</td></tr></table></main>';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('worker-code.txt','utf8'),compatibilityDate:'2026-10-01',host:'127.0.0.1',port:0,outboundService:request=>new URL(request.url).hostname==='cloudflare-dns.com'?Response.json({Status:0,Answer:new URL(request.url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]}):new Response(html,{headers:{'content-type':'text/html'}})}));
const base=(await mf.ready).origin,dir=await mkdtemp(join(tmpdir(),'workbench-test-'));let browser;
const wait=async expression=>{for(let i=0;i<200;i++){if(await browser.evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
async function upload(name,data) {
 await wait('!document.getElementById("import-file").disabled');
 await browser.evaluate(`document.getElementById('input-panel').open=true;{const bytes=Uint8Array.from(atob(${JSON.stringify(data)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],${JSON.stringify(name)}));document.getElementById('source-file').files=dt.files;document.getElementById('import-file').click();}`);
 await wait('!document.getElementById("import-file").disabled');
}
try {
 browser=await launchBrowser({guardNetwork:false});await browser.send('Page.enable');await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
 const errors=[];browser.on(m=>{if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.text);console.error(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);}});await browser.send('Runtime.enable');
 await browser.send('Page.navigate',{url:base});await wait('typeof document.getElementById("import-file")?.onclick==="function"');
 assert.equal(await browser.evaluate('document.querySelectorAll("#advanced").length'),1);
 await mkdir('.wrangler',{recursive:true});
 await writeFile('.wrangler/workbench-desktop.png',Buffer.from((await browser.send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
 await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
 await writeFile('.wrangler/workbench-mobile.png',Buffer.from((await browser.send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
 await browser.send('Emulation.clearDeviceMetricsOverride');
 await browser.evaluate(`document.getElementById('source-text').value="Name\\tScore\\nPasted\\t9";document.getElementById('extract').click()`);await wait('document.getElementById("candidate-rows").textContent.includes("Pasted")&&!document.getElementById("load").disabled');console.log('PASS pasted text');
 await browser.evaluate(`document.getElementById('input-panel').open=true;document.getElementById('source-url').value='https://fixture.example.org/';document.getElementById('fetch-source').click()`);await wait('document.getElementById("candidate-rows").textContent.includes("Website")&&!document.getElementById("load").disabled');console.log('PASS website link');
 await upload('quoted.csv',Buffer.from('Name,Score,Note\r\n"Alpha, Inc",12,"line one\nline two"\r\nBeta,9,=1+1\r\n').toString('base64'));
 assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/Alpha, Inc/);assert.match(await browser.evaluate('document.getElementById("file-issues").textContent'),/whitespace/);
 await browser.evaluate('document.getElementById("download-capture").click()');
 for(let i=0;i<100&&!(await readdir(dir)).includes('captured-source.json');i++)await new Promise(r=>setTimeout(r,50));
 const captured=JSON.parse(await readFile(join(dir,'captured-source.json'),'utf8'));assert.equal(captured.content[0].raw_rows[1][2],'line one\nline two');
 await browser.evaluate(`document.getElementById('select-eligible').click();document.getElementById('batch-reviewer').value='Workbench Test';document.getElementById('batch-note').value='Checked original CSV and normalized cells.';document.getElementById('batch-confirm').checked=true;document.getElementById('batch-confirm').dispatchEvent(new Event('change'));document.getElementById('approve-batch').click()`);
 await wait('document.getElementById("counts").textContent.includes("2 approved")&&!document.getElementById("load").disabled');
 await browser.evaluate('document.getElementById("approved-csv").click()');await wait('!document.getElementById("load").disabled');
 for(let i=0;i<100&&!(await readdir(dir)).includes('interpretation-approved.csv');i++)await new Promise(r=>setTimeout(r,50));
 assert.match(await readFile(join(dir,'interpretation-approved.csv'),'utf8'),/'=1\+1/);
 await browser.evaluate('document.getElementById("advanced").open=true;document.querySelector(".session-tools").open=true;document.getElementById("save-session").click()');await wait('!document.getElementById("load").disabled');
 for(let i=0;i<100&&!(await readdir(dir)).includes('toolkit-review-session.json');i++)await new Promise(r=>setTimeout(r,50));
 const session=JSON.parse(await readFile(join(dir,'toolkit-review-session.json'),'utf8'));assert.equal(session.job.retrieval.file.name,'quoted.csv');assert.ok(session.job.retrieval.file.issues.length);
 const restored=await (await fetch(base+'/api/interpretation/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'restore',session})})).json();assert.equal(restored.counts.approved,2);
 console.log('PASS approved CSV formula protection, saved review and file-warning restore');
 assert.match(await browser.evaluate('document.getElementById("source-part-preview").textContent'),/Alpha, Inc/);
 await browser.evaluate(`document.getElementById('coverage-reviewed').click()`);
 assert.match(await browser.evaluate('document.getElementById("status").textContent'),/Enter what you checked/);
 await browser.evaluate(`document.getElementById('coverage-note').value='Checked against original CSV';document.getElementById('coverage-reviewed').click();document.getElementById('save-workbench').click()`);
 for(let i=0;i<100&&!(await readdir(dir)).includes('toolkit-workbench.json');i++)await new Promise(r=>setTimeout(r,50));
 const backup=await readFile(join(dir,'toolkit-workbench.json'),'utf8');
 assert.equal(JSON.parse(backup).source.coverage[0].status,'reviewed');assert.equal(JSON.parse(backup).reviews.length,1);
 await browser.send('Page.reload');await wait('typeof document.getElementById("restore-workbench")?.onclick==="function"');
 await browser.evaluate(`{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(backup)}],'backup.json'));document.getElementById('workbench-backup').files=dt.files;document.getElementById('restore-workbench').click();}`);
 await wait('document.getElementById("status").textContent.includes("Restored source coverage")&&!document.getElementById("load").disabled');
 assert.match(await browser.evaluate('document.getElementById("counts").textContent'),/2 approved/);assert.match(await browser.evaluate('document.getElementById("coverage-counts").textContent'),/1 checked/);
 const damaged=JSON.parse(backup);damaged.source.datasets[0].text+=' changed';
 await browser.evaluate(`{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(damaged))}],'damaged.json'));document.getElementById('workbench-backup').files=dt.files;document.getElementById('restore-workbench').click();}`);
 await wait('document.getElementById("status").textContent.includes("snapshot mismatch")&&!document.getElementById("load").disabled');
 assert.match(await browser.evaluate('document.getElementById("counts").textContent'),/2 approved/);
 console.log('PASS captured preview, required coverage reasons and full backup/restore across reload');
 console.log('PASS quoted/multiline CSV and lossless captured cells');
 await upload('book.xlsx',xlsx);
 assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/Alpha/);
 assert.equal(await browser.evaluate('document.getElementById("retrieved-dataset").options.length'),2);
 assert.match(await browser.evaluate('document.getElementById("file-issues").textContent'),/Formula cells detected/);
 await browser.evaluate('document.getElementById("retrieved-dataset").selectedIndex=1;document.getElementById("retrieved-dataset").dispatchEvent(new Event("change"));document.getElementById("open-retrieved").click()');await wait('document.getElementById("candidate-rows").textContent.includes("Beta")&&!document.getElementById("load").disabled');
 await browser.evaluate(`document.getElementById('select-eligible').click();document.getElementById('batch-reviewer').value='Workbench Test';document.getElementById('batch-note').value='Checked cached value.';document.getElementById('batch-confirm').checked=true;document.getElementById('batch-confirm').dispatchEvent(new Event('change'));document.getElementById('approve-batch').click()`);await wait('document.getElementById("counts").textContent.includes("1 approved")&&!document.getElementById("load").disabled');
 for(const index of [0,1]){await browser.evaluate(`document.getElementById('retrieved-dataset').selectedIndex=${index};document.getElementById('retrieved-dataset').dispatchEvent(new Event('change'));document.getElementById('open-retrieved').click()`);await wait('!document.getElementById("load").disabled');}
 assert.match(await browser.evaluate('document.getElementById("counts").textContent'),/1 approved/);
 const precise=zip(Object.fromEntries(Object.entries(unzipSync(Buffer.from(xlsx,'base64'))).map(([k,v])=>[k,strFromU8(v).replaceAll('<v>12</v>','<v>9007199254740993</v>')])));
 const rawNumber=await browser.evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(precise)}),c=>c.charCodeAt(0));const result=await ToolkitFiles.importFile(new File([bytes],'precision.xlsx'));return result.captured_source.content[0].raw_rows[1][1];})()`);
 assert.equal(rawNumber,'9007199254740993');
 console.log('PASS multi-sheet Excel, hidden sheet and cached-formula warning');
 await upload('document.docx',docx);assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/Gamma/);assert.equal(await browser.evaluate('document.getElementById("retrieved-dataset").options.length'),2);console.log('PASS Word table and retained paragraphs');
 if(process.env.TOOLKIT_DOCX_FIXTURE){
   await upload('operator-document.docx',(await readFile(process.env.TOOLKIT_DOCX_FIXTURE)).toString('base64'));
   assert.ok(await browser.evaluate('document.getElementById("retrieved-dataset").options.length<33'));
   assert.match(await browser.evaluate('document.getElementById("file-issues").textContent'),/2 images were not read/);
   assert.match(await browser.evaluate('document.getElementById("file-issues").textContent'),/custom formatting styles were simplified/);
   assert.equal(await browser.evaluate('document.getElementById("retrieved-dataset").options[0].textContent.startsWith("Word text")'),true);
   console.log('PASS supplied Word document: grouped text, simplified styles and explicit unread images');
 }
 await upload('mixed.pdf',pdfFixture());
 assert.match(await browser.evaluate('document.getElementById("file-inventory").textContent'),/PDF page 1.*text PDF.*PDF page 2.*OCR required/);
 assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/12.6/);console.log('PASS text PDF and no-text page OCR distinction');
 await browser.evaluate(`document.getElementById('source-part').selectedIndex=1;document.getElementById('source-part').dispatchEvent(new Event('change'))`);
 assert.equal(await browser.evaluate('document.getElementById("coverage-reviewed").disabled'),true);
 await browser.evaluate(`document.getElementById('coverage-note').value='Image-only page intentionally omitted from this export';document.getElementById('coverage-exclude').click()`);
 assert.match(await browser.evaluate('document.getElementById("source-part-scope").textContent'),/OCR/);
 assert.match(await browser.evaluate('document.getElementById("coverage-counts").textContent'),/1 intentionally excluded.*1 parts have capture limitations/);
 console.log('PASS unread pages cannot be marked checked and exclusions retain limitations');
 await upload('old.doc',Buffer.from('invalid').toString('base64'));assert.match(await browser.evaluate('document.getElementById("status").textContent'),/Unsupported file/);
 assert.match(await browser.evaluate('document.getElementById("candidate-rows").textContent'),/12.6/);
 await upload('broken.csv',Buffer.from('Name,Score\nAlpha,1,unexpected').toString('base64'));assert.match(await browser.evaluate('document.getElementById("status").textContent'),/different cell counts/);console.log('PASS unsupported files and malformed CSV preserve previous review');
 assert.deepEqual(errors,[]);console.log('PASS no uncaught browser exceptions');
}finally{await browser?.close();await mf.dispose();await rm(dir,{recursive:true,force:true});}
