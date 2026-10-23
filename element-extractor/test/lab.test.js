import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const script = await readFile(
  new URL("../worker-code.txt", import.meta.url),
  "utf8",
);
const host = "https://toolkit.example.org";
async function setup() {
  let calls = 0;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-10-01",
      outboundService: () => {
        calls++;
        throw Error("The offline lab must not fetch anything.");
      },
    }),
  );
  return { mf, calls: () => calls };
}
const post = (mf, path, body, extra = {}) =>
  mf.dispatchFetch(host + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: host },
    body: JSON.stringify(body),
    ...extra,
  });
const start = async (mf, example_id = "scores-and-correction") => {
  const r = await post(mf, "/api/interpretation/start", { example_id });
  assert.equal(r.status, 200);
  return r.json();
};
const action = (mf, job, action, extra = {}) =>
  post(mf, "/api/interpretation/action", { job, action, ...extra });
const decision = {
  record_id: "row-1",
  decision: "approved",
  reviewer: "WorkerTestSimulation",
  note: "Simulated review of a fictional example, not a user decision.",
  confirmed_association: true,
};
test("lab serves its page and self-contained script and never makes an outbound request", async () => {
  const { mf, calls } = await setup();
  try {
    const page = await mf.dispatchFetch(host + "/interpretation");
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.match(await page.text(), /Save review session/);
    const client = await mf.dispatchFetch(host + "/interpretation-client.js");
    assert.equal(client.status, 200);
    assert.match(client.headers.get("content-type"), /javascript/);
    assert.match(await client.text(), /textContent/);
    const result = await start(mf);
    assert.deepEqual(result.counts, {
      candidates: 2,
      approved: 0,
      rejected: 0,
      pending: 2,
    });
    assert.equal(result.job.events.length, 0);
    assert.equal(result.validation.outcomes[2].status, "no_result");
    assert.equal(
      (await mf.dispatchFetch(host + "/interpretation", { method: "POST" }))
        .status,
      405,
    );
    assert.equal(calls(), 0);
  } finally {
    await mf.dispose();
  }
});
test("lab review controls preserve append-only events, revalidate, and deliver approved-only or diagnostic exports", async () => {
  const { mf, calls } = await setup();
  try {
    const initial = await start(mf);
    let r = await action(mf, initial.job, "export", { format: "csv" });
    assert.equal(r.headers.get("X-Exported-Records"), "0");
    assert.equal((await r.text()).trim().split("\r\n").length, 1);
    r = await action(mf, initial.job, "review", {
      decision: { ...decision, confirmed_association: false },
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "approval_blocked");
    r = await action(mf, initial.job, "review", { decision });
    assert.equal(r.status, 200);
    const approved = await r.json();
    assert.equal(initial.job.events.length, 0);
    assert.equal(approved.job.events.length, 1);
    assert.equal(approved.counts.approved, 1);
    r = await action(mf, approved.job, "review", {
      decision: { ...decision, record_id: "row-2" },
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "approval_blocked");
    r = await action(mf, approved.job, "review", {
      decision: {
        ...decision,
        record_id: "row-2",
        decision: "rejected",
        confirmed_association: false,
      },
    });
    const rejected = await r.json();
    assert.equal(rejected.job.events.length, 2);
    assert.equal(
      rejected.job.events[1].previous_hash,
      rejected.job.events[0].hash,
    );
    assert.equal(rejected.counts.rejected, 1);
    r = await action(mf, rejected.job, "revalidate");
    const replay = await r.json();
    assert.equal(replay.counts.approved, 1);
    assert.equal(replay.job.events.length, 2);
    r = await action(mf, rejected.job, "export", { format: "json" });
    const delivery = await r.json();
    assert.equal(delivery.validation.records.length, 1);
    assert.equal(delivery.validation.records[0].review_status, "approved");
    assert.equal(delivery.raw_response, undefined);
    r = await action(mf, rejected.job, "export", {
      format: "json",
      diagnostic: true,
    });
    const diagnostic = await r.json();
    assert.equal(diagnostic.validation.records.length, 2);
    assert.ok(diagnostic.raw_response);
    assert.equal(diagnostic.review_events.length, 2);
    for (const f of Object.values(diagnostic.validation.records[0].fields))
      for (const e of f.evidence)
        assert.equal(
          diagnostic.packet.source.text.slice(e.source_start, e.source_end),
          e.quote,
        );
    r = await action(mf, rejected.job, "review", {
      decision: {
        ...decision,
        decision: "needs_review",
        confirmed_association: false,
      },
    });
    const pending = await r.json();
    assert.equal(pending.counts.approved, 0);
    assert.equal(pending.job.events.length, 3);
    assert.equal(pending.job.events[0].decision, "approved");
    assert.equal(calls(), 0);
  } finally {
    await mf.dispose();
  }
});
test("lab examples expose missing evidence and incorrect associations without guessing or auto-approval", async () => {
  const { mf, calls } = await setup();
  try {
    const missing = await start(mf, "missing-evidence");
    assert.ok(
      missing.validation.records[0].fields.score.issues.some(
        (i) => i.code === "quote_not_found",
      ),
    );
    assert.equal(
      (await action(mf, missing.job, "review", { decision })).status,
      400,
    );
    const ambiguous = await start(mf, "ambiguous-association");
    assert.equal(ambiguous.validation.records[0].fields.score.issues.length, 0);
    assert.equal(ambiguous.counts.approved, 0);
    assert.ok(
      ambiguous.validation.records[0].issues.some(
        (i) => i.code === "interpreter_flag",
      ),
    );
    assert.equal(
      (await action(mf, ambiguous.job, "review", { decision })).status,
      400,
    );
    assert.equal(calls(), 0);
  } finally {
    await mf.dispose();
  }
});
test("lab rejects changed fixtures, modified history, cross-origin posts and excessive requests", async () => {
  const { mf } = await setup();
  try {
    const initial = await start(mf);
    const modified = structuredClone(initial.job);
    modified.cache_entry.raw_response.records[0].fields.score.value = 1;
    assert.equal((await action(mf, modified, "revalidate")).status, 400);
    const r = await action(mf, initial.job, "review", { decision });
    const reviewed = await r.json();
    reviewed.job.events[0].note = "changed history";
    assert.equal((await action(mf, reviewed.job, "revalidate")).status, 400);
    assert.equal(
      (await post(mf, "/api/interpretation/start", { example_id: "unknown" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(mf, "/api/interpretation/start", {
          example_id: "scores-and-correction",
          source: "custom text",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          mf,
          "/api/interpretation/start",
          { example_id: "scores-and-correction" },
          {
            headers: {
              origin: "https://other.org",
              "content-type": "application/json",
            },
          },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          mf,
          "/api/interpretation/start",
          {},
          { headers: { "content-type": "text/plain" } },
        )
      ).status,
      415,
    );
    assert.equal(
      (await mf.dispatchFetch(host + "/api/interpretation/start")).status,
      405,
    );
    assert.equal(
      (
        await post(mf, "/api/interpretation/start", {
          example_id: "x".repeat(1048577),
        })
      ).status,
      413,
    );
  } finally {
    await mf.dispose();
  }
});

const custom = (mf, text, fields = [
  { name: 'name', type: 'string', required: true },
  { name: 'score', type: 'number', required: true },
]) => post(mf, '/api/interpretation/start', { example_id: 'custom-text', source: { text, url: null }, schema: { fields } });
const correctedFields = (name, value, passage_id, quote) => ({
  corps_name: { value: name, evidence: [{ passage_id, quote, occurrence: 0 }] },
  score: { value, evidence: [{ passage_id, quote, occurrence: 0 }] },
});
test('pasted text uses bounded versioned rules, accounts for unsupported passages and never fetches', async () => {
  const { mf, calls } = await setup();
  try {
    const response = await custom(mf, 'Alpha scored 98.6.\nBeta: -2.5\n\nA narrative with no supported pair.\n\nGamma scored 95.1. A correction says its score was 95.4.');
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.counts.candidates, 3);
    assert.equal(value.counts.approved, 0);
    assert.equal(value.validation.records[1].fields.score.value, -2.5);
    assert.equal(value.validation.outcomes[1].status, 'no_result');
    assert.ok(value.validation.records[2].issues.some(i => i.code === 'interpreter_flag'));
    assert.equal((await action(mf, value.job, 'revalidate')).status, 200);
    assert.equal((await custom(mf, 'x'.repeat(16001))).status, 400);
    assert.equal((await custom(mf, 'Alpha: 1', [
      { name: 'constructor', type: 'string', required: true },
      { name: 'score', type: 'number', required: true },
    ])).status, 400);
    const repeated = await (await custom(mf, 'Alpha: 1\nAlpha: 1')).json();
    assert.equal(repeated.validation.records[1].fields.name.evidence[0].occurrence, 1);
    assert.equal(repeated.validation.records[1].fields.name.evidence[0].source_start, 9);
    assert.equal((await custom(mf, Array.from({length: 51}, (_, i) => 'Entity' + i + ': 1').join('\n'))).status, 400);
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('candidate corrections preserve original decisions, reset approvals, and require new evidence review', async () => {
  const { mf, calls } = await setup();
  try {
    let value = await start(mf);
    value = await (await action(mf, value.job, 'review', { decision })).json();
    const quote = 'Another Corps scored 95.1. A correction says its score was 95.4.';
    const correction = { record_id: 'row-2', fields: correctedFields('Another Corps', 95.4, 'p002', quote), reviewer: 'Test simulation', note: 'Replace superseded score using the full correction passage.' };
    const changed = await action(mf, value.job, 'correct', { correction });
    assert.equal(changed.status, 200);
    value = await changed.json();
    assert.equal(value.counts.approved, 0);
    assert.equal(value.job.revisions[0].prior_events[0].decision, 'approved');
    assert.equal(value.validation.records[1].fields.score.value, 95.4);
    assert.ok(!value.validation.records[1].issues.some(i => i.code === 'interpreter_flag'));
    value = await (await action(mf, value.job, 'review', { decision: { ...decision, record_id: 'row-2' } })).json();
    assert.equal(value.counts.approved, 1);
    const exported = await (await action(mf, value.job, 'export', { format: 'json' })).json();
    assert.equal(exported.validation.records[0].fields.score.value, 95.4);
    assert.equal(exported.original_candidates.records[1].fields.score.value, 95.1);
    assert.equal(exported.candidate_revision_history[0].prior_events.length, 1);
    const invalid = await (await action(mf, value.job, 'correct', { correction: { ...correction, fields: correctedFields('Another Corps', 99.9, 'p002', 'fabricated quote') } })).json();
    assert.ok(invalid.validation.records[1].fields.score.issues.length);
    assert.equal((await action(mf, invalid.job, 'review', { decision: { ...decision, record_id: 'row-2' } })).status, 400);
    const tampered = structuredClone(value.job);
    tampered.revisions[0].prior_events[0].note = 'Changed without updating journal';
    assert.equal((await action(mf, tampered, 'revalidate')).status, 400);
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('unmatched pasted text permits a manually supplied candidate with exact evidence and independent checks', async () => {
  const { mf } = await setup();
  try {
    let value = await (await custom(mf, 'The published result for Delta was 82.25 points.')).json();
    assert.equal(value.counts.candidates, 0);
    const quote = value.job.packet.passages[0].text;
    const correction = { record_id: null, reviewer: 'Test simulation', note: 'Manual reading of the supplied passage.', fields: {
      name: { value: 'Delta', evidence: [{ passage_id: 'p001', quote }] },
      score: { value: 82.25, evidence: [{ passage_id: 'p001', quote }] },
    } };
    const response = await action(mf, value.job, 'correct', { correction });
    assert.equal(response.status, 200);
    value = await response.json();
    assert.equal(value.counts.candidates, 1);
    assert.equal(value.validation.outcomes[0].status, 'records');
    const result = await action(mf, value.job, 'review', { decision: { ...decision, record_id: 'manual-1' } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).counts.approved, 1);
  } finally { await mf.dispose(); }
});

const autoText = (mf, text) => post(mf, '/api/interpretation/start', { example_id: 'custom-text', mode: 'auto', source: { text, url: null } });
test('automatic prose mode suggests columns for the full BLS passage and preserves associations, units and qualifiers', async () => {
  const { mf, calls } = await setup();
  try {
    const text = await readFile(new URL('./fixtures/bls-oews-passage.txt', import.meta.url), 'utf8');
    const response = await autoText(mf, text);
    assert.equal(response.status, 200);
    let value = await response.json();
    assert.deepEqual(value.interpretation.columns, ['measure', 'value', 'unit', 'qualifier']);
    const rows = value.validation.records;
    assert.equal(rows.length, 4);
    const establishments = rows.find(r => r.fields.measure.value === 'establishments');
    const employment = rows.find(r => r.fields.measure.value === 'weighted sampled employment');
    assert.equal(establishments.fields.value.value, 66.2);
    assert.equal(employment.fields.value.value, 67.2);
    assert.equal(employment.fields.unit.value, 'percent');
    const areas = rows.find(r => r.fields.measure.value === 'areas');
    assert.equal(areas.fields.value.value, 530);
    assert.equal(areas.fields.qualifier.value, 'over');
    assert.ok(!rows.some(r => [2025, 3, 4, 5, 6].includes(r.fields.value.value)));
    for (const r of rows) for (const f of Object.values(r.fields)) {
      assert.equal(f.issues.length, 0);
      for (const e of f.evidence) assert.equal(value.job.packet.source.text.slice(e.source_start, e.source_end), e.quote);
    }
    value = await (await action(mf, value.job, 'review', { decision: { ...decision, record_id: establishments.id } })).json();
    assert.equal(value.counts.approved, 1);
    assert.equal((await action(mf, value.job, 'revalidate')).status, 200);
    const exported = await (await action(mf, value.job, 'export', { format: 'json' })).json();
    assert.equal(exported.method, 'prose-facts-v1');
    assert.equal(exported.original_candidates.records.length, 4);
    assert.equal(exported.validation.records.length, 1);
    assert.equal(exported.validation.records[0].fields.measure.value, 'establishments');
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('automatic prose mode keeps uncertainty, unsupported text and numbers in URLs distinct from accepted facts', async () => {
  const { mf } = await setup();
  try {
    let value = await (await autoText(mf, 'Participation was about 20 percent.\n\nThere were over 530 areas.\n\nNo quantitative claims here. See https://example.org/2025/999-workers.')).json();
    assert.equal(value.counts.candidates, 2);
    assert.equal(value.validation.records[0].fields.qualifier.value, 'about');
    assert.equal(value.validation.outcomes[2].status, 'no_result');
    value = await (await autoText(mf, 'Previously participation was 20 percent.')).json();
    assert.equal(value.validation.records.length, 1);
    assert.ok(value.validation.records[0].issues.some(i => i.code === 'interpreter_flag'));
    value = await (await autoText(mf, 'Participation was 120 percent.')).json();
    assert.equal(value.validation.records.length, 1);
    assert.equal((await action(mf, value.job, 'review', { decision })).status, 400);
    value = await (await autoText(mf, 'A was 20 percent and B was 30 percent.')).json();
    assert.equal(value.counts.candidates, 0);
    assert.equal((await autoText(mf, 'Alpha: 1')).status, 200);
    assert.equal((await (await autoText(mf, 'See https://example.org/Alpha:98.6')).json()).counts.candidates, 0);
  } finally { await mf.dispose(); }
});

test('pasted grouped wage table distinguishes employment percentages from hourly dollars using header evidence', async () => {
  const { mf, calls } = await setup();
  try {
    const text = await readFile(new URL('./fixtures/pasted-wage-table.txt', import.meta.url), 'utf8');
    const response = await autoText(mf, text);
    assert.equal(response.status, 200);
    let value = await response.json();
    assert.equal(value.counts.candidates, 23);
    assert.match(value.interpretation.explanation, /local = Jacksonville/);
    assert.equal(value.job.parser_version, 'pasted-wage-table-v1');
    const first = value.validation.records[0].fields;
    assert.equal(first.occupational_group.value, 'Total, all occupations');
    assert.equal(first.employment_percent_national.value, 100);
    assert.equal(first.employment_percent_local.value, 100);
    assert.equal(first.hourly_wage_national_dollars.value, 33.54);
    assert.equal(first.hourly_wage_local_dollars.value, 31.59);
    assert.equal(value.validation.records[1].fields.hourly_wage_local_dollars.value, 65.97);
    for (const r of value.validation.records) for (const f of Object.values(r.fields)) {
      assert.equal(f.issues.length, 0);
      for (const e of f.evidence) assert.equal(value.job.packet.source.text.slice(e.source_start, e.source_end), e.quote);
    }
    assert.equal(first.hourly_wage_local_dollars.evidence.length, 2);
    value = await (await action(mf, value.job, 'review', { decision })).json();
    assert.equal(value.counts.approved, 1);
    const exported = await action(mf, value.job, 'export', { format: 'csv' });
    const csv = await exported.text();
    assert.match(csv, /hourly_wage_local_dollars/);
    assert.match(csv, /"100","100","33.54","31.59"/);
    assert.equal((await action(mf, value.job, 'revalidate')).status, 200);
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('pasted wage mapping needs unambiguous repeated header and complete four-value rows', async () => {
  const { mf } = await setup();
  try {
    const header = 'Major occupational group Percent of total employment Mean hourly wage ($) United States New York United States New York';
    let value = await (await autoText(mf, header + '\n\nManagement 7.2 7.4 $69.84 $65.97\n\nIncomplete 1 2 3\n\nExtra values 1 2 3 4 5')).json();
    assert.equal(value.counts.candidates, 1);
    assert.match(value.interpretation.explanation, /local = New York/);
    assert.equal(value.validation.outcomes[2].status, 'no_result');
    assert.equal(value.validation.outcomes[3].status, 'no_result');
    assert.equal((await autoText(mf, header + '\n\n' + header)).status, 400);
    value = await (await autoText(mf, 'Management 7.2 7.4 69.84 65.97')).json();
    assert.equal(value.counts.candidates, 0);
  } finally { await mf.dispose(); }
});

test('full copied page is split into bounded independent table batches and prose with original-page evidence', async () => {
  const { mf, calls } = await setup();
  try {
    const text = (await readFile(new URL('./fixtures/bls-full-page.txt', import.meta.url), 'utf8')).replace(/\r?\n/g, '\r\n');
    const response = await autoText(mf, text);
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.equal(first.counts.candidates, 23);
    assert.equal(first.job.packet.passages.length, 24);
    assert.equal(first.document.datasets.length, 4);
    assert.equal(first.document.text, text.replace(/\r\n?/g, '\n'));
    assert.notEqual(first.document.original_text_hash, first.document.text_hash);
    assert.match(first.document.notice, /Only the selected section/);
    const selectedViews = [];
    for (const d of first.document.datasets) {
      const r = await post(mf, '/api/interpretation/start', { example_id: 'custom-text', mode: 'auto', source: { text, url: null }, dataset_id: d.id });
      assert.equal(r.status, 200);
      const v = await r.json(); selectedViews.push(v);
      assert.ok(v.job.packet.source.text.length <= 16000);
      assert.ok(v.job.packet.passages.length <= 32);
      for (const row of v.validation.records) for (const field of Object.values(row.fields)) {
        assert.equal(field.issues.length, 0);
        for (const e of field.evidence) {
          assert.equal(v.document.text.slice(e.document_start, e.document_end), e.quote);
          assert.equal(e.document_hash, v.document.text_hash);
        }
      }
    }
    const [shares, jobs1, jobs2, prose] = selectedViews;
    assert.equal(jobs1.counts.candidates, 24);
    assert.equal(jobs2.counts.candidates, 24);
    assert.equal(shares.counts.candidates + jobs1.counts.candidates + jobs2.counts.candidates, 71);
    assert.equal(jobs1.validation.records[0].fields.employment_count.value, 96850);
    assert.equal(jobs1.validation.records[0].fields.location_quotient.value, 1.11);
    assert.equal(jobs1.validation.records[0].fields.hourly_wage_dollars.value, 23.89);
    assert.equal(jobs1.validation.records[0].fields.annual_wage_dollars.value, 49690);
    assert.equal(jobs1.validation.validator_version, 'evidence-grouped-v1');
    assert.ok(prose.validation.records.some(r => r.fields.value.value === 66.2));
    // Every non-whitespace character is retained in at least one selectable range.
    const covered = new Set();
    for (const v of selectedViews) for (const r of v.document.source_map)
      for (let i = r.document_start; i < r.document_start + r.length; i++) covered.add(i);
    for (let i = 0; i < first.document.text.length; i++) if (/\S/.test(first.document.text[i])) assert.ok(covered.has(i), 'Unretained source at ' + i);
    const reviewed = await (await action(mf, jobs1.job, 'review', { decision })).json();
    assert.equal(reviewed.counts.approved, 1);
    const exported = await (await action(mf, reviewed.job, 'export', { format: 'json' })).json();
    assert.equal(exported.document.selected_id, jobs1.document.selected_id);
    assert.equal(exported.document.text, first.document.text);
    assert.equal(exported.validation.records.length, 1);
    assert.equal((await action(mf, reviewed.job, 'revalidate')).status, 200);
    const tampered = structuredClone(reviewed.job);
    tampered.document.dataset_id = first.document.datasets[2].id;
    assert.equal((await action(mf, tampered, 'revalidate')).status, 400);
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('full-page intake rejects oversize input and invalid section selection without truncating or substituting records', async () => {
  const { mf } = await setup();
  try {
    const oversized = await autoText(mf, 'x'.repeat(64001));
    assert.equal(oversized.status, 400);
    assert.equal((await oversized.json()).code, 'page_limit');
    const text = Array.from({ length: 70 }, (_, i) => 'Item' + i + ': 1').join('\n\n');
    const response = await autoText(mf, text);
    assert.equal(response.status, 200);
    const v = await response.json();
    assert.equal(v.document.datasets.length, 3);
    assert.equal(v.counts.candidates, 24);
    const wrong = await post(mf, '/api/interpretation/start', { example_id: 'custom-text', mode: 'auto', source: { text }, dataset_id: 'missing' });
    assert.equal(wrong.status, 400);
  } finally { await mf.dispose(); }
});

test('portable sessions restore source, candidate revisions and explicit reviews after independent validation', async () => {
  const { mf, calls } = await setup();
  try {
    let value = await start(mf);
    const correction = { record_id: 'row-2', reviewer: 'TransferTestSimulation', note: 'Correct the fictional old score before portability testing.', fields: correctedFields('Another Corps', 95.4, 'p002', 'Another Corps scored 95.1. A correction says its score was 95.4.') };
    value = await (await action(mf, value.job, 'correct', { correction })).json();
    value = await (await action(mf, value.job, 'review', { decision: { ...decision, record_id: 'row-2' } })).json();
    const saved = await action(mf, value.job, 'save');
    assert.equal(saved.status, 200);
    assert.match(saved.headers.get('content-disposition'), /toolkit-review-session.json/);
    const session = await saved.json();
    assert.equal(session.format, 'toolkit-review-session-v1');
    const restore = await post(mf, '/api/interpretation/action', { action: 'restore', session });
    assert.equal(restore.status, 200);
    const restored = await restore.json();
    assert.equal(restored.counts.approved, 1);
    assert.equal(restored.job.revisions.length, 1);
    assert.deepEqual(restored.job.events, value.job.events);
    assert.equal(restored.validation.records[1].fields.score.value, 95.4);
    assert.equal((await action(mf, restored.job, 'export', { format: 'csv' })).status, 200);
    const altered = structuredClone(session);
    altered.job.events[0].note = 'This review was altered after saving.';
    assert.equal((await post(mf, '/api/interpretation/action', { action: 'restore', session: altered })).status, 400);
    assert.equal((await post(mf, '/api/interpretation/action', { action: 'restore', session: { format: 'interpretation_diagnostic_export', job: value.job } })).status, 400);
    assert.equal(calls(), 0);
  } finally { await mf.dispose(); }
});
test('portable full-page sessions restore the selected batch, document mapping and grouped dollar values', async () => {
  const { mf } = await setup();
  try {
    const text = await readFile(new URL('./fixtures/bls-full-page.txt', import.meta.url), 'utf8');
    let value = await (await post(mf, '/api/interpretation/start', { example_id: 'custom-text', mode: 'auto', source: { text }, dataset_id: 'section-2' })).json();
    value = await (await action(mf, value.job, 'review', { decision })).json();
    const session = await (await action(mf, value.job, 'save')).json();
    const restored = await (await post(mf, '/api/interpretation/action', { action: 'restore', session })).json();
    assert.equal(restored.document.selected_id, 'section-2');
    assert.equal(restored.counts.approved, 1);
    assert.equal(restored.validation.records[0].fields.annual_wage_dollars.value, 49690);
    const evidence = restored.validation.records[0].fields.annual_wage_dollars.evidence[0];
    assert.equal(restored.document.text.slice(evidence.document_start, evidence.document_end), evidence.quote);
  } finally { await mf.dispose(); }
});
