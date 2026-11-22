// Self-contained DOM reader: no cookies, storage, network calls or page actions.
export function readMarketDOM(doc,sourceURL){
 const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
 const number=s=>/^\d+$/.test(String(s))&&Number.isSafeInteger(Number(s))?Number(s):null;
 const cards=[],offers=[],issues=[];
 const groups=Array.from(doc.querySelectorAll('[id^="row-"]')).filter(n=>/^row-\d+$/.test(n.id)&&n.querySelector('tr[data-saleid]'));
 for(const g of groups){
  const id=g.id.slice(4),link=Array.from(g.querySelectorAll('a[href*="id_perso="]')).find(a=>norm(a.textContent));
  const all=Array.from(g.querySelectorAll('a')).find(a=>/^View all [\d ,]+ offers$/i.test(norm(a.textContent)));
  const advertised=all?Number(norm(all.textContent).replace(/\D/g,'')):null;
  cards.push({card_id:id,name:norm(link?.textContent)||null,advertised_offers:advertised});
 }
 const modal=doc.querySelector('.js-offers-modal.show');
 const modalLink=modal?.querySelector('a.js-offers-modal-page');
 const modalId=modalLink?new URL(modalLink.getAttribute('href'),sourceURL).searchParams.get('id'):null;
 if(modalId&&!cards.some(c=>c.card_id===modalId))cards.push({card_id:modalId,name:norm(modal.querySelector('#market-offers-title,h3,h4,h5')?.textContent)||null,advertised_offers:null});
 const roots=[...groups.map(g=>({node:g,card_id:g.id.slice(4),view:'page-preview'})),...(modalId?[{node:modal,card_id:modalId,view:'offer-overlay'}]:[])];
 for(const root of roots)for(const row of root.node.querySelectorAll('tr[data-saleid]')){
  const cells=Array.from(row.cells),sale_id=row.getAttribute('data-saleid'),card_id=row.getAttribute('data-id');
  const raw=cells.map(c=>norm(c.textContent));
  if(!/^\d+$/.test(sale_id||'')||card_id!==root.card_id||cells.length!==10){issues.push({card_id:root.card_id,sale_id,reason:'Unexpected listing identity or column layout; retained raw cells.',raw_cells:raw});continue;}
  const edition=cells[3],seller=cells[8].querySelector('a');
  const offer={sale_id,card_id,quantity:number(row.getAttribute('data-quantity')),price_clintz:number(row.getAttribute('data-price')),level:number(row.getAttribute('data-level')),edition_text:norm(edition.textContent),edition_labels:Array.from(edition.querySelectorAll('[title],[aria-label],img[alt]')).map(e=>e.getAttribute('title')||e.getAttribute('aria-label')||e.getAttribute('alt')).filter(Boolean),edition_markup:edition.innerHTML,state:row.getAttribute('data-state'),serial:row.getAttribute('data-serial'),power:raw[5],damage:raw[6],ability:raw[7],seller:norm(seller?.textContent)||raw[8],time_remaining:raw[9],raw_cells:raw,view:root.view};
  if(offer.quantity===null||offer.price_clintz===null||offer.level===null)issues.push({sale_id,reason:'A numeric listing attribute was missing or invalid; values were not guessed.'});
  offers.push(offer);
 }
 const controls=Array.from(doc.querySelectorAll('select')).map(s=>({label:s.getAttribute('aria-label')||s.name||'',value:s.value,text:norm(s.selectedOptions?.[0]?.textContent)}));
 return {format:'toolkit-market-observation-v1',captured_at:new Date().toISOString(),source_url:sourceURL,search:doc.querySelector('#market-search')?.value||'',controls,page_numbers:Array.from(doc.querySelectorAll('.ur-pagination-page.active')).filter(n=>!n.closest('.js-offers-modal')).map(n=>norm(n.textContent)),overlay_card_id:modalId,overlay_page:modal?norm(modal.querySelector('.ur-pagination-page.active')?.textContent):null,overlay_loading:!!modal&&!offers.some(r=>r.view==='offer-overlay'),cards,offers,issues,notice:'Loaded DOM observations only. Advertised offer counts are separate. This is not a simultaneous complete market snapshot or proof of completed sales.'};
}

export function summarizeMarket(observations){
 const cards=new Map(),listings=new Map();
 for(const o of observations){for(const c of o.cards)if(c.advertised_offers!==null||!cards.has(c.card_id))cards.set(c.card_id,c);for(const r of o.offers){const prior=listings.get(r.sale_id);listings.set(r.sale_id,{...r,first_seen:prior?.first_seen||o.captured_at,last_seen:o.captured_at});}}
 const rows=[...listings.values()].map(r=>({...r,card_name:cards.get(r.card_id)?.name||null})),coverage=[...cards.values()].map(c=>{const observed=rows.filter(r=>r.card_id===c.card_id).length;return {...c,observed_unique_listings:observed,advertised_minus_observed:c.advertised_offers===null?null:c.advertised_offers-observed,coverage_status:c.advertised_offers===null?'unknown':observed<c.advertised_offers?'partial':observed===c.advertised_offers?'count_matches_only':'changed_during_capture'};});
 return {format:'toolkit-market-capture-v1',started_at:observations[0]?.captured_at,ended_at:observations.at(-1)?.captured_at,unique_cards:cards.size,unique_observed_listings:rows.length,observed_quantity_total:rows.some(r=>r.quantity===null)?null:rows.reduce((n,r)=>n+r.quantity,0),unknown_quantity_listings:rows.filter(r=>r.quantity===null).length,cards:coverage,offers:rows,observations,notice:'Unreviewed observations over time, not current inventory or completed sales. Repeated sale IDs are counted once; original observations retain changes. Missing advertised offers remain uncollected. Count agreement alone does not prove completeness. Edition markup is retained for manual inspection; blank text does not prove an edition.'};
}

// Installed explicitly as a bookmarklet. Reads only; every capture/download is operator-triggered.
export function marketCaptureTool(read,summarize,workbenchOrigin){
 if(location.hostname!=='www.urban-rivals.com'||!location.pathname.startsWith('/market')){alert('Open the Urban Rivals marketplace first.');return;}
 if(document.getElementById('toolkit-market-capture')){document.getElementById('toolkit-market-capture').hidden=false;return;}
 const observations=[],panel=document.createElement('section');panel.id='toolkit-market-capture';
 panel.style.cssText='position:fixed;right:12px;top:12px;z-index:2147483647;background:#fff;color:#172637;padding:18px;border:3px solid #24628a;border-radius:10px;max-width:370px;font:14px Arial;box-shadow:0 3px 18px #0008';
 const heading=document.createElement('h3');heading.textContent='Market capture - local only';const status=document.createElement('p');
 const help=document.createElement('p');help.textContent='Capture this page, then manually open View all and each offer page; capture again. No Buy/Sell clicks or automatic requests. Keep the search and main page unchanged during a capture session.';
 panel.append(heading,status,help);document.body.append(panel);
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='margin:4px;padding:8px;color:#172637;background:#eef5fb;border:1px solid #24628a';b.onclick=fn;panel.append(b);return b;};
 const quote=v=>{let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const save=(content,name,type)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const report=()=>summarize(observations);
 let transfer=null;
 window.addEventListener('message',event=>{
  if(!transfer||event.origin!==workbenchOrigin||event.source!==transfer.child||event.data?.channel!=='toolkit-market-bridge-v1'||event.data.token!==transfer.token)return;
  if(event.data.action==='ready')transfer.child.postMessage({channel:'toolkit-market-bridge-v1',token:transfer.token,action:'capture',capture:transfer.capture},workbenchOrigin);
  if(event.data.action==='received'||event.data.action==='failed'){status.textContent=event.data.action==='received'?'Capture opened in the workbench. Review the rows there; nothing was approved automatically.':'The workbench could not open this capture. Check its error message. Your original capture remains here; download evidence JSON before reloading.';clearTimeout(transfer.timer);transfer=null;}
 });
 button('Review in workbench',()=>{
  if(!observations.length){status.textContent='Capture loaded offers first.';return;}
  if(transfer){status.textContent='A handoff is already pending. Finish sign-in in the new tab, or use the evidence JSON fallback.';return;}
  const token=crypto.randomUUID(),capture=report(),child=window.open(workbenchOrigin+'/?market_capture='+encodeURIComponent(token),'_blank');
  if(!child){status.textContent='The browser blocked the new tab. Allow this operator-triggered tab or download evidence JSON and open it in the workbench.';return;}
  transfer={token,capture,child,timer:setTimeout(()=>{transfer=null;status.textContent='Handoff was not confirmed. Your capture is still here. Retry, or download evidence JSON and open it in the workbench.';},120000)};
  status.textContent='Opening the workbench with '+capture.unique_observed_listings+' listings. Finish Cloudflare sign-in there if asked. This sends captured listing data to your private workbench for review.';
 });
 button('Capture loaded offers',()=>{try{const o=read(document,location.href);if(o.overlay_loading)throw Error('The offer overlay is still loading or empty. Wait for listing rows, or close it before capturing.');if(observations.length&&JSON.stringify([o.search,o.controls,o.page_numbers,o.cards.map(c=>c.card_id)])!==JSON.stringify([observations[0].search,observations[0].controls,observations[0].page_numbers,observations[0].cards.map(c=>c.card_id)]))throw Error('Main page or search settings changed. Download this session and reload before starting another.');if(!o.cards.length||!o.offers.length)throw Error('No supported loaded market listings found.');if(observations.length>=50||observations.reduce((n,s)=>n+s.offers.length,0)+o.offers.length>10000)throw Error('Capture limit reached; download before starting another session. Nothing was removed.');observations.push(o);const r=report();status.textContent=r.unique_cards+' unique cards; '+r.unique_observed_listings+' unique observed listings; '+observations.length+' observations. '+r.cards.reduce((n,c)=>n+(c.advertised_offers||0),0)+' advertised offers; '+r.cards.reduce((n,c)=>n+Math.max(0,c.advertised_minus_observed||0),0)+' not yet observed. Count agreement does not prove completeness; inspect JSON issues.';}catch(e){status.textContent=e.message;}});
 button('Download evidence JSON',()=>save(JSON.stringify(report(),null,2),'market-capture.json','application/json'));
 button('Download offers CSV',()=>{const fields=['sale_id','card_id','card_name','quantity','price_clintz','level','edition_text','power','damage','ability','seller','time_remaining','first_seen','last_seen'];save([fields,...report().offers.map(r=>fields.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n','market-offers.csv','text/csv');});
 button('Download card coverage CSV',()=>{const fields=['card_id','name','advertised_offers','observed_unique_listings','advertised_minus_observed','coverage_status'];save([fields,...report().cards.map(r=>fields.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n','market-card-coverage.csv','text/csv');});
 button('Hide helper',()=>{panel.hidden=true;});status.textContent='No capture yet. Downloads stay on this computer. Reloading loses this session; download JSON first.';
}

export function marketCapturePage(){
 const script='void ('+marketCaptureTool.toString()+')('+readMarketDOM.toString()+','+summarizeMarket.toString()+','+JSON.stringify('https://toolkit-capture.invalid')+')';
 const href=('javascript:'+encodeURIComponent(script)).replaceAll('&','&amp;').replaceAll('"','&quot;');
 return '<!doctype html><meta charset="utf-8"><title>Capture signed-in market page</title><style>body{font:18px system-ui;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}a{color:#135c92}.install{display:inline-block;background:#eaf4ff;padding:16px;border:2px solid #135c92}</style><h1>Capture → Review → Download</h1><p><strong>Updating an existing bookmark?</strong> Replace the old bookmark with the link below to get direct review.</p><p>This helper reads loaded Urban Rivals listings in your signed-in browser. It reads no cookies or account balances and never clicks market controls. Review in workbench opens your private toolkit and transfers captured listing data for review; capturing itself makes no requests.</p><ol><li>Drag the following link to your bookmarks bar.</li><li>Open your market page, then click the saved bookmark.</li><li>Click Capture loaded offers. For more listings, manually open View all, capture each offer page, and repeat.</li><li>Click Review in workbench to open captured listings directly in a fresh review tab. Sign in to the toolkit if asked. Download evidence JSON as a backup or fallback; the workbench can open it directly.</li></ol><a class="install" href="'+href+'">Capture Urban Rivals market</a><p>The helper reports observed listings separately from advertised totals. It does not claim complete market coverage. Stop at the current main results page; start a separate session if filters/page change. Card editions and time remaining require manual review.</p><p>If your browser or the site blocks bookmarklets, do not disable security settings; use a supported capture route instead.</p><p><a href="/">Return to workbench</a></p>';
}
