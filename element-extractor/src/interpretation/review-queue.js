// Routing is derived from independent validation, never from client confidence labels.
const tableMethods = new Set(['mapped-table-v1', 'mapped-table-v2', 'pasted-wage-table-v1', 'pasted-wage-table-v2', 'pasted-page-table-v1']);
const reviewOnly = new Set(['association_unverified', 'cross_passage_association']);
export function reviewQueue(job, validation) {
  const structured = tableMethods.has(job.parser_version);
  const changed = new Set((job.revisions || []).map(r => r.record_id));
  const eligible_ids = [], exception_ids = [], individual_ids = [];
  for (const row of validation.records) {
    if (row.review_status !== 'needs_review') continue;
    const blocked = validation.issues.length > 0 || row.issues.some(i => !reviewOnly.has(i.code)) ||
      Object.values(row.fields).some(f => f.issues.length > 0);
    if (blocked) exception_ids.push(row.id);
    else if (structured && !changed.has(row.id) && !row.id.startsWith('manual-')) eligible_ids.push(row.id);
    else individual_ids.push(row.id);
  }
  return { structured, eligible_ids, exception_ids, individual_ids,
    remaining_review_events: Math.max(0, 64 - job.events.length),
    notice: 'Batch approval is an explicit human decision on supported table mappings. Prose, changed candidates and validation exceptions require individual review. No record is automatically accepted.' };
}
