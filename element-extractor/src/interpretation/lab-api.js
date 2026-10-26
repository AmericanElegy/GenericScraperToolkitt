import {makeFeedbackSnapshot} from './feedback-snapshots.js';
import {feedbackCase} from './feedback.js';
import {RANKING_VERSION,rankingPlan,extractRanking,rankingMeaning} from './ranking-rules.js';
import {TEXT_FACTS_VERSION,TEXT_FACTS_SCHEMA,hasTextRelations,extractTextFacts,assertTextFactConsistency,textFactMeaning} from './text-facts.js';
import { MAPPING_VERSION, LEGACY_MAPPING_VERSION, detectColumns, mappedSchema, mappingFor, extractMappedTable } from './column-mapping.js';
import { reviewQueue } from './review-queue.js';
import { planPage, needsPageIntake, extractPageTable, PAGE_TABLE_VERSION, documentEvidence } from './page-intake.js';
import { wageHeader, extractWageTable, WAGE_SCHEMA, WAGE_VERSION, LEGACY_WAGE_VERSION } from './wage-table.js';
import { extractProseRules, PROSE_SCHEMA, PROSE_VERSION, LEGACY_PROSE_VERSION } from './prose-rules.js';
import { extractTextRules } from './text-rules.js';
import sample from "../../examples/interpretation-scripted.json";
import {
  createPacket,
  scriptedInterpreter,
  runInterpretation,
  revalidate,
  appendReview,
  appendReviewBatch,
  exportInterpretation,
  canonical,
  digest,
  ContractError,
} from "./pipeline.js";
import { LAB_PAGE } from "./lab-page.js";
import client from "./lab-client.txt";

const examples = {
  "scores-and-correction": sample,
  "missing-evidence": (() => {
    const value = structuredClone(sample);
    value.scripted_response.records[0].fields.score.evidence[0].quote =
      "This proposed quotation does not occur in the source.";
    return value;
  })(),
  "ambiguous-association": {
    source: {
      url: "https://example.org/fictional-ambiguous-results",
      text: "Alpha Corps scored 98.6, while Beta Corps scored 95.1.",
    },
    schema: sample.schema,
    scripted_response: {
      version: "candidates-v1",
      records: [
        {
          id: "row-1",
          issues: [
            "This scripted candidate pairs Alpha Corps with Beta Corps's score. Both literals occur in the passage, but their association is wrong.",
          ],
          fields: {
            corps_name: {
              value: "Alpha Corps",
              evidence: [
                {
                  passage_id: "p001",
                  quote:
                    "Alpha Corps scored 98.6, while Beta Corps scored 95.1.",
                },
              ],
            },
            score: {
              value: 95.1,
              evidence: [
                {
                  passage_id: "p001",
                  quote:
                    "Alpha Corps scored 98.6, while Beta Corps scored 95.1.",
                },
              ],
            },
          },
        },
      ],
      outcomes: [
        {
          passage_id: "p001",
          status: "records",
          record_ids: ["row-1"],
          reason:
            "Deliberately incorrect scripted association for review practice.",
        },
      ],
    },
  },
};
const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
const fail = (code, message, status = 400) => {
  const error = new ContractError(code, message);
  error.status = status;
  throw error;
};
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) =>
  plain(value) && Object.keys(value).every((key) => keys.includes(key));
async function readBody(request) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    fail("json_required", "Send a JSON request.", 415);
  let oversized = Number(request.headers.get("content-length")) > 1048576;
  const reader = request.body?.getReader(),
    chunks = [];
  let bytes = 0;
  if (reader)
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1048576) { oversized = true; chunks.length = 0; }
        // Drain a bounded oversize upload so a normal client can receive the 413
        // instead of an EPIPE while it is still writing. Never buffer excess data.
        if (bytes > 2097152) {
          await reader.cancel();
          fail("request_limit", "The lab request exceeds 1 MiB.", 413);
        }
        if (!oversized) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  if (oversized) fail("request_limit", "The lab request exceeds 1 MiB. Export the current diagnostic report before starting a smaller session.", 413);
  let body;
  try {
    body = JSON.parse(await new Blob(chunks).text());
  } catch {
    fail("invalid_json", "The lab request is not valid JSON.");
  }
  return body;
}
async function entryFor(packet, response) {
  return (await runInterpretation(packet, await scriptedInterpreter(response))).cache_entry;
}
function applyCorrection(packet, response, change) {
  if (!only(change, ['record_id', 'fields', 'reviewer', 'note', 'at', 'prior_events']) ||
      typeof change.reviewer !== 'string' || !change.reviewer.trim() || change.reviewer.length > 80 ||
      typeof change.note !== 'string' || !change.note.trim() || change.note.length > 1000 ||
      typeof change.at !== 'string' || !Number.isFinite(Date.parse(change.at)) ||
      !Array.isArray(change.prior_events) || change.prior_events.length > 64 || !plain(change.fields))
    fail('invalid_correction', 'A correction requires a reviewer, note, timestamp and requested fields.');
  const next = structuredClone(response);
  const index = next.records.findIndex(r => r.id === change.record_id);
  if (change.record_id !== null && index < 0) fail('unknown_record', 'Select an existing record to correct.');
  const candidate = { id: index < 0 ? 'manual-' + (next.records.length + 1) : change.record_id, fields: change.fields };
  if (index < 0) next.records.push(candidate); else next.records[index] = candidate;
  // Recompute passage accounting from every retained supporting reference.
  next.outcomes = packet.passages.map(p => {
    const ids = next.records.filter(r => Object.values(r.fields).some(f =>
      Array.isArray(f?.evidence) && f.evidence.some(e => e.passage_id === p.id))).map(r => r.id);
    return { passage_id: p.id, status: ids.length ? 'records' : 'no_result', record_ids: ids,
      reason: ids.length ? 'Candidate evidence references this paragraph; associations require human review.' : 'No current candidate cites this paragraph. This is not proof that it contains no useful data.' };
  });
  return next;
}
function originalResponse(job) {
  if (job.example_id !== 'custom-text') return examples[job.example_id].scripted_response;
  if ([MAPPING_VERSION,LEGACY_MAPPING_VERSION].includes(job.parser_version)) return extractMappedTable(job);
  if(job.parser_version===RANKING_VERSION)return extractRanking(job.packet);
  if(job.parser_version===TEXT_FACTS_VERSION)return extractTextFacts(job.packet);
  if (job.parser_version === 'name-number-v1') return extractTextRules(job.packet);
  if (job.parser_version === PAGE_TABLE_VERSION) return extractPageTable(job.packet);
  if ([WAGE_VERSION, LEGACY_WAGE_VERSION].includes(job.parser_version)) return extractWageTable(job.packet, job.parser_version);
  if ([PROSE_VERSION, LEGACY_PROSE_VERSION].includes(job.parser_version)) return extractProseRules(job.packet, job.parser_version);
  fail('parser_version', 'Unsupported text parser version.');
}
async function documentInfo(job) {
  if (!job.document) return null;
  if (job.example_id !== 'custom-text' || !only(job.document, ['source', 'dataset_id']))
    fail('invalid_document', 'Invalid full-page source or selection.');
  const plan = planPage(job.document.source, job.parser_version === LEGACY_PROSE_VERSION ? LEGACY_PROSE_VERSION : PROSE_VERSION,{semantic:job.parser_version===TEXT_FACTS_VERSION});
  const selected = plan.datasets.find(d => d.id === job.document.dataset_id);
  if (!selected || job.parser_version !== selected.parser_version)
    fail('invalid_document', 'The selected section or parser does not match the retained page.');
  const rebuilt = await createPacket({ source: { text: selected.text, url: job.document.source.url ?? null }, schema: selected.schema }, job.packet.source.received_at);
  if (canonical(rebuilt) !== canonical(job.packet))
    fail('document_mismatch', 'The selected packet does not match its original full-page source.');
  return { plan, selected, hash: await digest(plan.text), original_hash: await digest(job.document.source.text) };
}
function publicDocument(info, job) {
  const selected = info.selected;
  const batches = selected.kind === 'prose' ? [] : info.plan.datasets.filter(d => d.kind === selected.kind && d.source_map[0].document_start === selected.source_map[0].document_start);
  const index = batches.findIndex(d => d.id === selected.id);
  const start = batches.slice(0,index).reduce((n,d) => n+d.row_count,0)+1;
  const selected_scope = batches.length ? {
    kind:'table_batch', row_start:start, row_end:start+selected.row_count-1,
    table_rows:batches.reduce((n,d)=>n+d.row_count,0), batch_number:index+1, batch_count:batches.length,
    previous_id:batches[index-1]?.id ?? null, next_id:batches[index+1]?.id ?? null,
  } : {kind:'prose',previous_id:null,next_id:null};
  return { text: info.plan.text, text_hash: info.hash, original_text_hash: info.original_hash,
    url: job.packet.source.url, selected_id: info.selected.id,
    source_map: info.selected.source_map, selected_scope,
    datasets: info.plan.datasets.map(d => ({ id: d.id, label: d.label, row_count: d.row_count, kind: d.kind })),
    notice: 'Only the selected section is parsed/reviewed/exported as current records. The full page is retained; other sections are not implicitly approved. Switching sections starts a new review session.' };
}
async function checkJob(job) {
  if (!only(job, ['example_id', 'packet', 'cache_entry', 'events', 'revisions', 'parser_version', 'document', 'mapping', 'retrieval']) ||
      !Array.isArray(job.events) || job.events.length > 64 ||
      (job.revisions !== undefined && (!Array.isArray(job.revisions) || job.revisions.length > 8)))
    fail('invalid_lab_job', 'Invalid session. Maximum 64 review events and 8 candidate revisions.');
  if (job.mapping !== undefined && ![MAPPING_VERSION,LEGACY_MAPPING_VERSION].includes(job.parser_version)) fail('column_mapping', 'Recorded column mappings require a mapped table session.');
  if(job.retrieval!==undefined){
    const r=job.retrieval;
    if(!only(r,['method','source','retrieved_at','snapshot_hash','label','content_kind']) || !['static-html','local-chromium'].includes(r.method) || (r.content_kind!==undefined&&!['table','prose'].includes(r.content_kind)) || r.source!==job.packet.source.url || r.snapshot_hash!==job.packet.source.text_hash || typeof r.label!=='string'||r.label.length>1000||typeof r.retrieved_at!=='string'||!Number.isFinite(Date.parse(r.retrieved_at))) fail('retrieval_metadata','Retrieval description does not match the retained text snapshot.');
  }
  await revalidate(job.packet, job.cache_entry);
  await documentInfo(job);
  let response;
  if (job.example_id === 'custom-text') {
    response = originalResponse(job);
  } else {
    if (!Object.hasOwn(examples, job.example_id)) fail('invalid_lab_job', 'Unknown example.');
    const fixture = examples[job.example_id];
    if (job.packet.source.text !== fixture.source.text || job.packet.source.url !== fixture.source.url ||
        canonical(job.packet.schema) !== canonical(fixture.schema))
      fail('example_mismatch', 'The fictional example source or columns changed. Start again.');
    response = fixture.scripted_response;
  }
  for (const change of job.revisions || []) {
    const prior = await entryFor(job.packet, response);
    // Replay prior reviews against their original candidate version; approvals never carry over.
    await exportInterpretation(job.packet, prior, change.prior_events, { approvedOnly: false });
    response = applyCorrection(job.packet, response, change);
    await revalidate(job.packet, await entryFor(job.packet, response));
  }
  if(job.parser_version===TEXT_FACTS_VERSION)assertTextFactConsistency(response);
  if (canonical(job.cache_entry.raw_response) !== canonical(response))
    fail('example_mismatch', 'Candidate data differs from its rule output and recorded corrections.');
  return exportInterpretation(job.packet, job.cache_entry, job.events, { approvedOnly: false });
}
async function view(job, result) {
  const info = await documentInfo(job);
  if (info) result.json.validation = documentEvidence(result.json.validation, info.selected, info.plan.text, info.hash);
  const records = result.json.validation.records;
  const mapped = mappingFor(job);
  const meaning=job.parser_version===RANKING_VERSION?rankingMeaning(job.packet):job.parser_version===TEXT_FACTS_VERSION?textFactMeaning():null;
  const unmatched = result.json.validation.outcomes.filter(o => o.status === 'no_result');
  const tableLike = /(?:percent of total employment|mean hourly wage|major occupational group)/i.test(job.packet.source.text)
    || job.packet.passages.some(p => /^.+?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\$?\d+(?:\.\d+)?\s+\$?\d+(?:\.\d+)?$/.test(p.text.trim()));
  return {
    job,
    meaning,
    column_mapping: mapped ? {
      editable: true, delimiter: mapped.plan.delimiter,
      columns: mapped.columns.map((c,i) => ({...c, source_label:mapped.plan.columns[i].label, required:mapped.schema.fields[i].required, reason: mapped.plan.columns[i].reason, samples:mapped.plan.rows.slice(0,3).map(r => r.cells[i])})),
      skipped_rows: mapped.plan.skipped, prefix_lines: mapped.plan.prefix_lines,
      notice: 'Suggested from explicit source columns. No code changes needed. Remapping starts a new unapproved review; save the current session first.',
    } : {
      editable:false, columns:job.packet.schema.fields.map(f => ({name:f.name,kind:f.type === 'string'?'text': /percent/.test(f.name)?'percent':/dollars/.test(f.name)?'dollars':'number',source_label:f.name.replaceAll('_',' '),samples:records.slice(0,3).map(r => r.fields[f.name]?.value)})),
      skipped_rows:[], notice:'Columns selected by the supported extraction method; inspect their source evidence.',
    },
    extraction: {
      unmatched_passages: unmatched.length,
      mapping_unresolved: records.length === 0 && tableLike,
      message: records.length === 0
        ? tableLike ? 'Table-like content detected, but column mapping is unresolved. No records extracted. Keep the complete grouped headings with the rows; manual two-column mode cannot represent this table.' : 'No supported relationships found. No records extracted; source text is retained.'
        : records.length + ' candidate records extracted. ' + (unmatched.length ? unmatched.length + (unmatched.length === 1 ? ' passage produced' : ' passages produced') + ' no records; inspect unmatched source text for omissions.' : 'Inspect the column mapping and evidence before approval. Extraction may still be incomplete.') + (mapped?.plan.skipped.length ? ' ' + mapped.plan.skipped.length + ' malformed rows were not mapped; inspect the column preview.' : ''),
    },
    ...(info ? { document: publicDocument(info, job) } : {}),
    validation: result.json.validation,
    review_queue: reviewQueue(job, result.json.validation),
    counts: {
      candidates: records.length,
      approved: records.filter((r) => r.review_status === "approved").length,
      rejected: records.filter((r) => r.review_status === "rejected").length,
      pending: records.filter((r) => r.review_status === "needs_review").length,
    },
    interpretation: {
      method: job.parser_version || 'fictional-scripted-example',
      columns: job.packet.schema.fields.map(f => f.name),
      explanation: meaning?meaning.explanation:mapped ? 'Delimited table: suggested columns from the header and literal cell formats. Identifiers stay text; units are not converted. Malformed rows are listed in the mapping preview. Review the row/header association before approval.' : info
        ? 'Full page retained. Current section: ' + info.selected.label + '. Other sections remain selectable and are not included in current approvals or records. Review row/header evidence and original-page offsets.'
        : [WAGE_VERSION, LEGACY_WAGE_VERSION].includes(job.parser_version)
        ? 'Pasted wage table: the header defines two employment percentages followed by two hourly wages in dollars. National = United States; local = ' + wageHeader(job.packet).local + '. Dollar amounts stay numeric, with currency and hourly basis in the column names. Inspect row and header evidence before approval.'
        : [PROSE_VERSION, LEGACY_PROSE_VERSION].includes(job.parser_version)
        ? 'Suggested measure, value, unit and qualifier columns from explicit quantitative patterns. All suggestions require review. Counts, rates and scores can describe different concepts; inspect the full quotation. Unmatched text is retained. This is limited rule-based interpretation, not general language understanding.'
        : 'Limited name/number rules or prewritten examples. All candidates require review.',
    },
    notice:
      "Rule-based or scripted candidates, with optional human corrections. No AI inference. Session-only, self-declared review; not an authenticated audit service.",
  };
}
export async function labFetch(request) {
  const url = new URL(request.url);
  if (
    url.pathname === "/interpretation" ||
    url.pathname === "/interpretation-client.js"
  ) {
    if (request.method !== "GET")
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...headers, Allow: "GET" },
      });
    return new Response(
      url.pathname === "/interpretation" ? LAB_PAGE : client,
      {
        headers: {
          ...headers,
          "Content-Type":
            url.pathname === "/interpretation"
              ? "text/html; charset=utf-8"
              : "application/javascript; charset=utf-8",
        },
      },
    );
  }
  if (request.method !== "POST") {
    const response = reply(
      {
        error: "Use a same-origin JSON POST request.",
        code: "method_not_allowed",
      },
      405,
    );
    response.headers.set("Allow", "POST");
    return response;
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return reply(
      {
        error: "Cross-origin lab requests are not supported.",
        code: "origin_not_allowed",
      },
      403,
    );
  try {
    const body = await readBody(request);
    if (url.pathname === "/api/interpretation/start") {
      let packet, response, parserVersion, document, mapping;
      if (body?.example_id === 'custom-text') {
        if (!only(body, ['example_id', 'source', 'schema', 'mode', 'dataset_id', 'mapping', 'retrieval']) ||
            (body.mode !== undefined && !['auto', 'pair'].includes(body.mode)))
          fail('invalid_input', 'Choose automatic suggestions or manual pair columns.');
        if (body.mapping !== undefined && (body.mode !== 'auto' || body.dataset_id !== undefined)) fail('column_mapping', 'Column mapping requires automatic mode on one pasted table.');
        if (body.mode === 'auto' && body.schema !== undefined)
          fail('invalid_input', 'Automatic suggestions choose their own columns. Use manual mode to supply columns.');
        const columns = body.mode === 'auto' ? detectColumns(body.source?.text?.replace(/\r\n?/g, '\n'),MAPPING_VERSION,body.retrieval?.content_kind==='table') : null;
        if (body.mapping !== undefined && !columns) fail('column_mapping', 'No supported delimited header found.');
        const ranking=body.mode==='auto'?rankingPlan(body.source?.text?.replace(/\r\n?/g,'\n')):null;
        if(ranking&&body.mapping===undefined&&body.dataset_id===undefined){
          packet=await createPacket({source:body.source,schema:ranking.schema});parserVersion=RANKING_VERSION;
        } else if (columns && body.dataset_id === undefined) {
          const mapped = mappedSchema(columns, body.mapping);
          mapping = mapped.columns;
          packet = await createPacket({source:body.source,schema:mapped.schema});
          parserVersion = MAPPING_VERSION;
        } else if (body.mode === 'auto' && (needsPageIntake(body.source) || body.dataset_id !== undefined)) {
          const plan = planPage(body.source,PROSE_VERSION,{semantic:true});
          const selected = body.dataset_id === undefined ? plan.datasets[0] : plan.datasets.find(d => d.id === body.dataset_id);
          if (!selected) fail('invalid_selection', 'Choose a listed full-page section.');
          document = { source: body.source, dataset_id: selected.id };
          packet = await createPacket({ source: { text: selected.text, url: body.source.url ?? null }, schema: selected.schema });
          parserVersion = selected.parser_version;
        } else {
          if (body.dataset_id !== undefined) fail('invalid_selection', 'Section selection requires automatic mode.');
          const textFacts=body.mode==='auto'&&hasTextRelations(body.source?.text);
          packet = await createPacket({ source: body.source, schema: body.mode === 'auto' ? textFacts?TEXT_FACTS_SCHEMA:PROSE_SCHEMA : body.schema });
          parserVersion = body.mode === 'auto' ? textFacts?TEXT_FACTS_VERSION:PROSE_VERSION : 'name-number-v1';
          if (body.mode === 'auto' && wageHeader(packet)) {
            packet = await createPacket({ source: body.source, schema: WAGE_SCHEMA }, packet.source.received_at);
            parserVersion = WAGE_VERSION;
          }
        }
        response = originalResponse({ example_id: 'custom-text', parser_version: parserVersion, packet, ...(mapping ? {mapping} : {}), ...(body.retrieval?{retrieval:body.retrieval}:{}) });
      } else {
        if (!only(body, ['example_id']) || !Object.hasOwn(examples, body.example_id))
          fail('unknown_example', 'Choose an example or paste your own text.');
        const fixture = examples[body.example_id];
        packet = await createPacket(fixture);
        response = fixture.scripted_response;
      }
      const run = await runInterpretation(
        packet,
        await scriptedInterpreter(response),
      );
      if(body.retrieval&&document&&body.retrieval.snapshot_hash!==await digest(body.source.text.replace(/\r\n?/g,'\n')))fail('retrieval_metadata','The retained page differs from the recorded retrieved snapshot.');
      const job = {
        example_id: body.example_id,
        packet,
        cache_entry: run.cache_entry,
        events: [],
        revisions: [],
        ...(document ? { document } : {}),
        ...(mapping ? {mapping} : {}),
        ...(body.retrieval ? {retrieval:document?{...body.retrieval,snapshot_hash:packet.source.text_hash}:body.retrieval} : {}),
        ...(body.example_id === "custom-text" ? { parser_version: parserVersion } : {}),
      };
      return reply(await view(job, await checkJob(job)));
    }
    if (url.pathname !== "/api/interpretation/action")
      return reply({ error: "Not found", code: "not_found" }, 404);
    if (
      !only(body, ["action", "job", "decision", "format", "diagnostic", "correction", "session", "record_ids", "reviewer", "note", "confirmed_mapping"]) ||
      !["revalidate", "review", "export", "correct", "save", "restore", "review_batch", "feedback"].includes(body.action)
    )
      fail("invalid_action", "Choose revalidate, review, correct, export, save or restore.");
    if (body.action === "restore") {
      if (!only(body, ["action", "session"]) || !only(body.session, ["format", "job"]) ||
          body.session.format !== "toolkit-review-session-v1")
        fail("invalid_session", "Choose a toolkit review session JSON file, not a CSV or data export.");
      return reply(await view(body.session.job, await checkJob(body.session.job)));
    }
    const result = await checkJob(body.job);
    if (body.action === "feedback") return reply(await feedbackCase(body.job,result.json.validation,originalResponse(body.job)));
    if (body.action === "review_batch") {
      const queue = reviewQueue(body.job, result.json.validation);
      if (!only(body, ["action", "job", "record_ids", "reviewer", "note", "confirmed_mapping"]) ||
          !Array.isArray(body.record_ids) || !body.record_ids.length || body.record_ids.length > 50 ||
          new Set(body.record_ids).size !== body.record_ids.length ||
          body.record_ids.some(id => !queue.eligible_ids.includes(id)) || body.confirmed_mapping !== true)
        fail("batch_not_eligible", "Select pending, unchanged table rows with clean checks and explicitly confirm the column mapping. Prose and exceptions need individual review.");
      if (body.record_ids.length > queue.remaining_review_events)
        fail("review_limit", "This batch exceeds the session review limit. Save the session and reduce the selection.", 413);
      if (typeof body.reviewer !== "string" || !body.reviewer.trim() || body.reviewer.length > 80 ||
          typeof body.note !== "string" || !body.note.trim() || body.note.length > 900)
        fail("invalid_review", "Enter a reviewer name and a batch review note (up to 900 characters).");
      // One independent validation per batch, with an individual journal event per row.
      const events = await appendReviewBatch(body.job.packet, body.job.cache_entry, body.job.events,
        body.record_ids.map(id => ({ record_id: id, decision: "approved", reviewer: body.reviewer.trim(),
          note: "Batch table review (" + body.record_ids.length + " selected rows): " + body.note.trim(), confirmed_association: true })));
      const job = { ...body.job, events };
      return reply(await view(job, await checkJob(job)));
    }
    if (body.action === "save") {
      const session = JSON.stringify({ format: "toolkit-review-session-v1", job: body.job });
      // Leave room for the restore request envelope, so every saved file can reopen.
      if (new TextEncoder().encode(session).byteLength > 1000000)
        fail("session_limit", "This review session exceeds the portable file limit. Export diagnostic JSON instead.", 413);
      return new Response(session + "\n", { headers: { ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="toolkit-review-session.json"',
      } });
    }
    if (body.action === 'correct') {
      if ((body.job.revisions || []).length >= 8) fail('revision_limit', 'Maximum 8 revisions. Download diagnostic JSON before starting a new session.');
      if (!only(body.correction, ['record_id', 'fields', 'reviewer', 'note'])) fail('invalid_correction', 'Unexpected correction fields.');
      const change = { ...body.correction, at: new Date().toISOString(), prior_events: body.job.events };
      const response = applyCorrection(body.job.packet, body.job.cache_entry.raw_response, change);
      const job = { ...body.job, revisions: [...(body.job.revisions || []), change], events: [],
        cache_entry: await entryFor(body.job.packet, response) };
      return reply(await view(job, await checkJob(job)));
    }
    if (body.action === "review") {
      if (body.job.events.length >= 64)
        fail(
          "review_limit",
          "This demo is limited to 64 review events. Download a diagnostic report, then load a new example.",
          413,
        );
      const events = await appendReview(
        body.job.packet,
        body.job.cache_entry,
        body.job.events,
        body.decision,
      );
      const job = { ...body.job, events };
      return reply(await view(job, await checkJob(job)));
    }
    if (body.action === "revalidate") return reply(await view(body.job, result));
    if (
      !["csv", "json"].includes(body.format) ||
      (body.diagnostic !== undefined && typeof body.diagnostic !== "boolean")
    )
      fail(
        "invalid_export",
        "Choose CSV or JSON and a boolean diagnostic flag.",
      );
    const exported = await exportInterpretation(
      body.job.packet,
      body.job.cache_entry,
      body.job.events,
      { approvedOnly: !body.diagnostic },
    );
    const info = await documentInfo(body.job);
    if (info) {
      exported.json.document = publicDocument(info, body.job);
      exported.json.validation = documentEvidence(exported.json.validation, info.selected, info.plan.text, info.hash);
    }
    exported.json.candidate_revision_history = body.job.revisions || [];
    exported.json.original_candidates = originalResponse(body.job);
    if(body.job.retrieval)exported.json.source_retrieval={...body.job.retrieval,notice:'Descriptive session metadata, not authenticated source provenance. Snapshot hash is revalidated.'};
    if(body.job.parser_version===RANKING_VERSION)exported.json.interpretation_context=rankingMeaning(body.job.packet);
    if(body.job.parser_version===TEXT_FACTS_VERSION)exported.json.interpretation_context=textFactMeaning();
    exported.json.method = body.job.parser_version || 'fictional-scripted-example';
    exported.json.notice = 'Limited rules or scripted examples, with optional human corrections. No AI inference. Original automated findings are retained separately from human review.';
    const prefix = body.diagnostic
      ? "interpretation-diagnostic"
      : "interpretation-approved";
    return new Response(
      body.format === "csv"
        ? exported.csv
        : JSON.stringify(exported.json, null, 2) + "\n",
      {
        headers: {
          ...headers,
          "Content-Type":
            body.format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${prefix}.${body.format}"`,
          "X-Exported-Records": String(exported.json.counts.exported),
        },
      },
    );
  } catch (error) {
    return reply(
      {
        error:
          error instanceof ContractError
            ? error.message
            : "The lab request failed. Your current session has not been replaced.",
        code:
          error instanceof ContractError ? error.code : "lab_request_failed",
      },
      error.status || (error instanceof ContractError ? 400 : 500),
    );
  }
}

// Reuse the exact review/source validation for durable local feedback.
export async function validatedFeedbackSnapshot(job){
 const result=await checkJob(job);
 const reviewed=result.json.validation.records.some(r=>['approved','rejected'].includes(r.review_status));
 const example=reviewed?await feedbackCase(job,result.json.validation,originalResponse(job)):null;
 return makeFeedbackSnapshot(job,example);
}
