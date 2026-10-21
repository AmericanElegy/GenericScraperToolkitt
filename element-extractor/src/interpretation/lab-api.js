import { extractTextRules } from './text-rules.js';
import sample from "../../examples/interpretation-scripted.json";
import {
  createPacket,
  scriptedInterpreter,
  runInterpretation,
  revalidate,
  appendReview,
  exportInterpretation,
  canonical,
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
  if (Number(request.headers.get("content-length")) > 131072)
    fail(
      "request_limit",
      "The lab request exceeds 128 KiB. Download the current diagnostic report before starting a new session.",
      413,
    );
  const reader = request.body?.getReader(),
    chunks = [];
  let bytes = 0;
  if (reader)
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 131072) {
          await reader.cancel();
          fail("request_limit", "The lab request exceeds 128 KiB.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
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
async function checkJob(job) {
  if (!only(job, ['example_id', 'packet', 'cache_entry', 'events', 'revisions', 'parser_version']) ||
      !Array.isArray(job.events) || job.events.length > 64 ||
      (job.revisions !== undefined && (!Array.isArray(job.revisions) || job.revisions.length > 8)))
    fail('invalid_lab_job', 'Invalid session. Maximum 64 review events and 8 candidate revisions.');
  await revalidate(job.packet, job.cache_entry);
  let response;
  if (job.example_id === 'custom-text') {
    if (job.parser_version !== 'name-number-v1') fail('parser_version', 'Unsupported text parser version.');
    response = extractTextRules(job.packet);
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
  if (canonical(job.cache_entry.raw_response) !== canonical(response))
    fail('example_mismatch', 'Candidate data differs from its rule output and recorded corrections.');
  return exportInterpretation(job.packet, job.cache_entry, job.events, { approvedOnly: false });
}
function view(job, result) {
  const records = result.json.validation.records;
  return {
    job,
    validation: result.json.validation,
    counts: {
      candidates: records.length,
      approved: records.filter((r) => r.review_status === "approved").length,
      rejected: records.filter((r) => r.review_status === "rejected").length,
      pending: records.filter((r) => r.review_status === "needs_review").length,
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
      let packet, response;
      if (body?.example_id === 'custom-text') {
        if (!only(body, ['example_id', 'source', 'schema'])) fail('invalid_input', 'Send source text and two requested columns.');
        packet = await createPacket({ source: body.source, schema: body.schema });
        response = extractTextRules(packet);
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
      const job = {
        example_id: body.example_id,
        packet,
        cache_entry: run.cache_entry,
        events: [],
        revisions: [],
        ...(body.example_id === "custom-text" ? { parser_version: "name-number-v1" } : {}),
      };
      return reply(view(job, await checkJob(job)));
    }
    if (url.pathname !== "/api/interpretation/action")
      return reply({ error: "Not found", code: "not_found" }, 404);
    if (
      !only(body, ["action", "job", "decision", "format", "diagnostic", "correction"]) ||
      !["revalidate", "review", "export", "correct"].includes(body.action)
    )
      fail("invalid_action", "Choose revalidate, review, correct or export.");
    const result = await checkJob(body.job);
    if (body.action === 'correct') {
      if ((body.job.revisions || []).length >= 8) fail('revision_limit', 'Maximum 8 revisions. Download diagnostic JSON before starting a new session.');
      if (!only(body.correction, ['record_id', 'fields', 'reviewer', 'note'])) fail('invalid_correction', 'Unexpected correction fields.');
      const change = { ...body.correction, at: new Date().toISOString(), prior_events: body.job.events };
      const response = applyCorrection(body.job.packet, body.job.cache_entry.raw_response, change);
      const job = { ...body.job, revisions: [...(body.job.revisions || []), change], events: [],
        cache_entry: await entryFor(body.job.packet, response) };
      return reply(view(job, await checkJob(job)));
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
      return reply(view(job, await checkJob(job)));
    }
    if (body.action === "revalidate") return reply(view(body.job, result));
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
    exported.json.candidate_revision_history = body.job.revisions || [];
    exported.json.original_candidates = body.job.example_id === 'custom-text'
      ? extractTextRules(body.job.packet) : examples[body.job.example_id].scripted_response;
    exported.json.method = body.job.example_id === 'custom-text' ? 'name-number-v1' : 'fictional-scripted-example';
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
