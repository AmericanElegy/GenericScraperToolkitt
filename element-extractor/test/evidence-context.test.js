import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceContext} from '../src/interpretation/evidence-context.js';
test('review context retains nearby subject and date without expanding the exact quote',()=>{
 const source='Employment in 2025\n\nAcme opened a branch. It employs 120 workers.\n\nNext topic.';
 const quote='It employs 120 workers.',start=source.indexOf(quote),e={quote,source_start:start,source_end:start+quote.length};
 const c=evidenceContext(source,e);assert.equal(c.quote,quote);assert.match(c.before,/Employment in 2025/);assert.match(c.after,/Next topic/);assert.equal(c.before+c.quote+c.after,source);
 assert.equal(evidenceContext(source,{...e,source_start:0}),null);
});
test('context uses checked original-page offsets and bounds surrounding text',()=>{
 const source='x'.repeat(1000)+'A😀 fact.'+'y'.repeat(1000),quote='A😀 fact.';
 const e={quote,source_start:0,source_end:quote.length,document_start:1000,document_end:1000+quote.length};
 const c=evidenceContext(source,e,{document:true});assert.equal(c.before.length,350);assert.equal(c.after.length,350);assert.equal(c.quote,quote);assert.equal(c.truncated_before,true);assert.equal(c.truncated_after,true);assert.equal(evidenceContext(source,e),null);
 assert.equal(evidenceContext(source,{...e,document_end:9999},{document:true}),null);
});
