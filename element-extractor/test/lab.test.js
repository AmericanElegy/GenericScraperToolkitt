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
    assert.match(await page.text(), /Session only/);
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
          example_id: "x".repeat(131073),
        })
      ).status,
      413,
    );
  } finally {
    await mf.dispose();
  }
});
