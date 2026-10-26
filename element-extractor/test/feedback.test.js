import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {compareFeedback} from '../src/interpretation/feedback.js';
const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
const post=(mf,path,body)=>mf.dispatchFetch('https://feedback.example.org'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const act=(mf,job,action,extra={})=>post(mf,'/api/interpretation/action',{job,action,...extra});

test('feedback is tied to validated human decisions, portable, deduplicated and checked offline across sources',async()=>{
 let outbound=0;const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',outboundService:()=>{outbound++;throw Error('Unexpected fetch');}}));
 const dir=await mkdtemp(join(tmpdir(),'toolkit-feedback-'));
 try{
  const cases=[];
  for(const [text,url]of [['Name\tScore\nAlpha\t98.6','https://one.example.org/'],['Year\t#1\t#2\n2025\tSolar eclipse\tFootball','https://two.example.org/']]){
   let v=await (await post(mf,'/api/interpretation/start',{example_id:'custom-text',mode:'auto',source:{text,url}})).json();
   assert.equal((await act(mf,v.job,'feedback')).status,400,'Unreviewed proposals are not an answer key.');
   v=await (await act(mf,v.job,'review',{decision:{record_id:'row-1',decision:'approved',reviewer:'Test',note:'Compared exact source relationship.',confirmed_association:true}})).json();
   const response=await act(mf,v.job,'feedback');assert.equal(response.status,200);const c=await response.json();assert.equal(c.expectations.approved.length,1);assert.equal(c.expectations.unreviewed_count,v.counts.candidates-1);assert.equal(c.id,(await (await act(mf,v.job,'feedback')).json()).id);
   cases.push(c);
   const tampered=structuredClone(v.job);tampered.cache_entry.raw_response.records[0].fields[Object.keys(tampered.packet.schema.fields)[0]]={value:'Forged',evidence:[]};assert.equal((await act(mf,tampered,'feedback')).status,400);
  }
  let corrected=await (await post(mf,'/api/interpretation/start',{example_id:'scores-and-correction'})).json();
  const evidence=[{passage_id:'p002',quote:'Another Corps scored 95.1. A correction says its score was 95.4.'}];
  corrected=await (await act(mf,corrected.job,'correct',{correction:{record_id:'row-2',fields:{corps_name:{value:'Another Corps',evidence},score:{value:95.4,evidence}},reviewer:'Test',note:'Use the explicitly corrected score.'}})).json();
  assert.equal((await act(mf,corrected.job,'feedback')).status,400,'Correction alone does not establish an approved answer.');
  corrected=await (await act(mf,corrected.job,'review',{decision:{record_id:'row-2',decision:'approved',reviewer:'Test',note:'Checked corrected score association.',confirmed_association:true}})).json();
  const correctedCase=await (await act(mf,corrected.job,'feedback')).json();assert.equal(correctedCase.expectations.approved[0].values.score,95.4);assert.equal(correctedCase.job.revisions.length,1);assert.equal(correctedCase.baseline.candidate_values[1].score,95.1);
  assert.equal(outbound,0);
  const path=join(dir,'examples.json');await writeFile(path,JSON.stringify({format:'toolkit-feedback-collection-v1',cases}));
  const cli=(...args)=>spawnSync(process.execPath,['scripts/feedback.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:40000});
  let run=cli('check',path);assert.equal(run.status,0,run.stderr+run.stdout);const report=JSON.parse(run.stdout);assert.equal(report.cases.length,2);assert.equal(report.summary.regressions,0);assert.equal(report.cases[1].unjudged_candidates,1);
  const correctedPath=join(dir,'corrected.json');await writeFile(correctedPath,JSON.stringify(correctedCase));
  run=cli('check',correctedPath);assert.equal(run.status,1,run.stderr);const gap=JSON.parse(run.stdout);assert.equal(gap.cases[0].status,'known_issues');assert.equal(gap.cases[0].unresolved_corrections.length,1,'Fresh extraction must not silently replay the human fix.');
  const merged=join(dir,'merged.json');run=cli('collect',merged,path,path);assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(await readFile(merged)).cases.length,2);assert.notEqual(cli('collect',merged,path).status,0,'Existing collection files are not overwritten.');
  const forged=structuredClone(cases[0]);forged.expectations.approved[0].values.score=0;const bad=join(dir,'bad.json');await writeFile(bad,JSON.stringify(forged));assert.notEqual(cli('check',bad).status,0);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

test('feedback separates lost approved answers, rejected proposals and unjudged extras without claiming accuracy',()=>{
 const row=value=>({fields:{answer:{value}}});
 const expected={approved:[{values:{answer:'Paris'}}],rejected:[{values:{answer:'Rome'}}],coverage:'partial-review'};
 let r=compareFeedback(expected,{validation:{records:[row('Paris'),row('Rome'),row('Other')]}});assert.equal(r.status,'known_issues');assert.equal(r.approved_matched,1);assert.equal(r.rejected_still_proposed.length,1);
 r=compareFeedback(expected,{validation:{records:[row('Rome')]}});assert.equal(r.status,'regression');assert.equal(r.missing_approved.length,1);
 r=compareFeedback(expected,{validation:{records:[row('Paris')]}});assert.equal(r.status,'reviewed_checks_passed');assert.equal(r.coverage,'partial-review');assert.ok(!('accuracy' in r));
 const invalid=row('Paris');invalid.fields.answer.issues=[{code:'evidence_not_found'}];r=compareFeedback(expected,{validation:{records:[invalid]}});assert.equal(r.approved_matched,0,'Matching values with invalid evidence are not a passing answer.');assert.equal(r.invalid_candidate_count,1);
});
