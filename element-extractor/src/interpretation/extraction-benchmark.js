// Independent comparison with frozen source-derived reference rows.
export function scoreTable(expected,actual) {
 const columns=expected.columns,key=columns[0],wanted=expected.rows.map(row=>Object.fromEntries(columns.map((c,i)=>[c,row[i]])));
 const remaining=[...actual],missing=[],extra=[],mismatches=[];let correct=0,exactRows=0;
 for(const row of wanted){
  const index=remaining.findIndex(r=>r[key]===row[key]);
  if(index<0){missing.push(row[key]);continue;}
  const found=remaining.splice(index,1)[0];let exact=true;
  for(const column of columns){if(Object.is(found[column],row[column]))correct++;else{exact=false;mismatches.push({row:row[key],column,expected:row[column],actual:found[column]??null});}}
  for(const column of Object.keys(found))if(!columns.includes(column)){exact=false;mismatches.push({row:row[key],column,reason:'unexpected column'});}
  if(exact)exactRows++;
 }
 extra.push(...remaining.map(r=>r[key]??'(missing identity)'));
 return {pass:!missing.length&&!extra.length&&!mismatches.length,expected_rows:wanted.length,actual_rows:actual.length,exact_rows:exactRows,expected_cells:wanted.length*columns.length,correct_cells:correct,missing_rows:missing,extra_rows:extra,mismatches};
}
