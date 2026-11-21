import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceCoverage,coverageCounts} from '../src/interpretation/source-coverage.js';
test('coverage accounts for text, unsupported images and table selections without claiming review',()=>{
 const parts=sourceCoverage([{label:'Text',kind:'text',text:'Retained sentence.'},{label:'Image',kind:'image',error:'Unread image'},{label:'Table',kind:'table',table_key:'source-table-1'},{label:'Unmapped text',kind:'text',text:'Not interpreted'}],[{id:'a',text:'Heading\nRetained sentence.'},{id:'b',text:'table snapshot',table_key:'source-table-1'},{id:'c',text:'next batch',table_key:'source-table-1'}]);
 assert.deepEqual(parts.map(p=>p.dataset_ids),[['a'],[],['b','c'],[]]);
 assert.deepEqual(coverageCounts(parts),{pending:3,reviewed:0,excluded:0,unsupported:1});
 assert.equal(parts[3].text,'Not interpreted');
});
