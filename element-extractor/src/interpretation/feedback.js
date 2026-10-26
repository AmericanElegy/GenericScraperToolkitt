// Portable human-reviewed examples. This records feedback; it never changes extraction rules.
import {canonical,digest,ContractError} from './pipeline.js';
export const FEEDBACK_FORMAT='toolkit-feedback-case-v1';
export const COLLECTION_FORMAT='toolkit-feedback-collection-v1';
export async function feedbackCase(job,validation,original){
 const reviewed=validation.records.filter(r=>r.review_status==='approved'||r.review_status==='rejected');
 if(!reviewed.length)throw new ContractError('feedback_needs_review','Approve or reject at least one record before collecting feedback. Corrections remain proposals until reviewed.');
 const values=r=>Object.fromEntries(Object.entries(r.fields).map(([name,f])=>[name,f.value]));
 const expectations={approved:reviewed.filter(r=>r.review_status==='approved').map(r=>({record_id:r.id,values:values(r)})),rejected:reviewed.filter(r=>r.review_status==='rejected').map(r=>({record_id:r.id,values:values(r)})),unreviewed_count:validation.records.length-reviewed.length,coverage:'partial-review; unreviewed or absent records are not ground truth'};
 const baseline={candidate_values:original.records.map(values)};
 const payload={format:FEEDBACK_FORMAT,job,expectations,baseline};
 const result={...payload,id:await digest(payload)};
 if(new TextEncoder().encode(canonical(result)).byteLength>950000)throw new ContractError('feedback_limit','This feedback case exceeds the portable case limit. Use a smaller source selection.');
 return result;
}
export function compareFeedback(expected,current,baseline){
 const signature=values=>canonical(values);
 const rowSignature=r=>signature(Object.fromEntries(Object.entries(r.fields).map(([k,f])=>[k,f.value])));
 const candidates=current.validation.records.map(rowSignature);
 const reviewOnly=new Set(['association_unverified','cross_passage_association']);
 const available=current.validation.records.filter(r=>!current.validation.issues?.length&&!(r.issues||[]).some(i=>!reviewOnly.has(i.code))&&!Object.values(r.fields).some(f=>f.issues?.length)).map(rowSignature);
 const invalid_candidate_count=candidates.length-available.length;
 const remaining=[...candidates],missing=[];
 for(const row of expected.approved){const key=signature(row.values),i=available.indexOf(key);if(i<0)missing.push(row);else{available.splice(i,1);remaining.splice(remaining.indexOf(key),1);}}
 const baselineValues=baseline?.candidate_values.map(signature);
 const regressions=missing.filter(row=>!baselineValues||baselineValues.includes(signature(row.values)));
 const unresolved_corrections=missing.filter(row=>baselineValues&&!baselineValues.includes(signature(row.values)));
 const rejected_still_proposed=expected.rejected.filter(row=>candidates.includes(signature(row.values)));
 for(const row of expected.rejected){const i=remaining.indexOf(signature(row.values));if(i>=0)remaining.splice(i,1);}
 const newly_rejected_proposals=rejected_still_proposed.filter(row=>baselineValues&&!baselineValues.includes(signature(row.values)));
 return {invalid_candidate_count,unresolved_corrections,newly_rejected_proposals,regressions,approved_expected:expected.approved.length,approved_matched:expected.approved.length-missing.length,missing_approved:missing,rejected_still_proposed,unjudged_candidates:remaining.length,coverage:expected.coverage,status:regressions.length||newly_rejected_proposals.length?'regression':missing.length||rejected_still_proposed.length?'known_issues':'reviewed_checks_passed',notice:'Checks cover saved human decisions only. Extra candidates are unjudged, not automatically errors. No overall accuracy or completeness rate is established.'};
}
