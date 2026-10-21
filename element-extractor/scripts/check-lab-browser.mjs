import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const dir = await mkdtemp(join(tmpdir(), "lab-browser-"));
let outboundCalls = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: await readFile(
      new URL("../worker-code.txt", import.meta.url),
      "utf8",
    ),
    compatibilityDate: "2026-10-01",
    host: "127.0.0.1",
    port: 8794,
    outboundService: () => {
      outboundCalls++;
      throw Error("The lab must not fetch a source or provider.");
    },
  }),
);
await mf.ready;
const chrome = spawn(
  process.env.CHROMIUM_PATH || "chromium",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9225",
    "--user-data-dir=" + dir + "/profile",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let ws;
const pending = new Map();
let id = 0;
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out");
}
try {
  const targets = await waitFor(async () => {
    const r = await fetch("http://127.0.0.1:9225/json");
    return r.json();
  });
  ws = new WebSocket(
    targets.find((x) => x.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) =>
    ws.addEventListener("open", resolve, { once: true }),
  );
  const errors = [];
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: dir,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:8794/" });
  await waitFor(() =>
    evaluate(
      '[...document.querySelectorAll("a")].some(a=>a.getAttribute("href")==="/interpretation")',
    ),
  );
  await send("Page.navigate", { url: "http://127.0.0.1:8794/interpretation" });
  await waitFor(() =>
    evaluate(
      'document.readyState==="complete" && Boolean(document.getElementById("load"))',
    ),
  );
  assert.equal(
    await evaluate('document.getElementById("workspace").hidden'),
    true,
  );
  await evaluate('document.getElementById("load").click()');
  await waitFor(() =>
    evaluate(
      'document.getElementById("counts").textContent.includes("2 candidates") && !document.getElementById("load").disabled',
    ),
  );
  assert.match(
    await evaluate('document.getElementById("counts").textContent'),
    /0 approved/,
  );
  assert.equal(
    await evaluate('document.getElementById("approve").disabled'),
    true,
  );
  assert.match(
    await evaluate('document.getElementById("approval-note").textContent'),
    /reviewer name.*review note.*confirmation box/,
  );
  await evaluate('document.getElementById("confirm").checked=true;document.getElementById("confirm").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.getElementById("approve").disabled'), true);
  await evaluate('document.getElementById("reviewer").value="BrowserTestSimulation";document.getElementById("reviewer").dispatchEvent(new Event("input"))');
  assert.match(await evaluate('document.getElementById("approval-note").textContent'), /enter a review note/);
  assert.equal(await evaluate('document.getElementById("approve").disabled'), true);
  await evaluate('document.getElementById("note").value="Checked fictional source pairing.";document.getElementById("note").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.getElementById("approve").disabled'), false);
  await evaluate(
    'document.querySelector("button[data-record=row-1][data-field=score]").click()',
  );
  assert.match(
    await evaluate('document.getElementById("field-title").textContent'),
    /score/,
  );
  assert.ok(
    await evaluate('document.querySelectorAll("#passages mark").length>0'),
  );
  assert.match(
    await evaluate('document.getElementById("passages").textContent'),
    /Interpreter reported no result/,
  );
  await evaluate(
    'document.getElementById("reviewer").value="BrowserTestSimulation";document.getElementById("note").value="Fictional test review only. <img src=x onerror=alert(1)>";document.getElementById("confirm").checked=true;document.getElementById("confirm").dispatchEvent(new Event("change"));document.getElementById("approve").click()',
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("counts").textContent.includes("1 approved") && !document.getElementById("load").disabled',
    ),
  );
  assert.equal(
    await evaluate('document.getElementById("approve").textContent'),
    "Already approved",
  );
  assert.match(
    await evaluate('document.getElementById("approval-note").textContent'),
    /already approved.*included in Approved CSV/,
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#history li").length'),
    1,
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#history img").length'),
    0,
  );
  assert.match(
    await evaluate('document.getElementById("history").textContent'),
    /<img src=x/,
  );
  for (const [button, file] of [
    ["approved-csv", "interpretation-approved.csv"],
    ["approved-json", "interpretation-approved.json"],
    ["diagnostic-json", "interpretation-diagnostic.json"],
  ]) {
    await evaluate(
      "document.getElementById(" + JSON.stringify(button) + ").click()",
    );
    await waitFor(async () => (await readdir(dir)).includes(file));
    await waitFor(() => evaluate('!document.getElementById("load").disabled'));
  }
  const csv = await readFile(join(dir, "interpretation-approved.csv"), "utf8");
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.match(csv, /98\.6/);
  const delivery = JSON.parse(
    await readFile(join(dir, "interpretation-approved.json"), "utf8"),
  );
  assert.equal(delivery.validation.records.length, 1);
  assert.equal(delivery.validation.records[0].review_status, "approved");
  assert.equal(delivery.raw_response, undefined);
  const diagnostic = JSON.parse(
    await readFile(join(dir, "interpretation-diagnostic.json"), "utf8"),
  );
  assert.equal(diagnostic.validation.records.length, 2);
  assert.equal(diagnostic.review_events.length, 1);
  assert.ok(diagnostic.raw_response);
  assert.equal(diagnostic.validation.records[1].review_status, "needs_review");
  await evaluate(
    'document.querySelector("button[data-record=row-2][data-field=score]").click()',
  );
  assert.equal(
    await evaluate('document.getElementById("confirm").checked'),
    false,
  );
  await evaluate(
    'document.getElementById("note").value="Fictional old score contradicted by its correction.";document.getElementById("confirm").checked=true;document.getElementById("confirm").dispatchEvent(new Event("change"))',
  );
  assert.equal(
    await evaluate('document.getElementById("approve").disabled'),
    true,
  );
  assert.match(
    await evaluate('document.getElementById("approval-note").textContent'),
    /Cannot approve.*correction/,
  );
  await evaluate('document.getElementById("reject").click()');
  await waitFor(() =>
    evaluate(
      'document.getElementById("counts").textContent.includes("1 rejected") && !document.getElementById("load").disabled',
    ),
  );
  await evaluate('document.getElementById("revalidate").click()');
  await waitFor(() =>
    evaluate(
      'document.getElementById("status").textContent.includes("revalidated") && !document.getElementById("load").disabled',
    ),
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#history li").length'),
    2,
  );
  if (process.env.LAB_SCREENSHOT_DIR) {
    await mkdir(process.env.LAB_SCREENSHOT_DIR, { recursive: true });
    const shot = await send("Page.captureScreenshot", {
      captureBeyondViewport: true,
    });
    await writeFile(
      join(process.env.LAB_SCREENSHOT_DIR, "interpretation-lab-desktop.png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.ok(
    await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),
  );
  if (process.env.LAB_SCREENSHOT_DIR) {
    const shot = await send("Page.captureScreenshot", {
      captureBeyondViewport: true,
    });
    await writeFile(
      join(process.env.LAB_SCREENSHOT_DIR, "interpretation-lab-mobile.png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  await evaluate(
    'document.getElementById("note").value="Keep this fictional candidate unresolved.";document.getElementById("pending").click()',
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("counts").textContent.includes("1 pending") && !document.getElementById("load").disabled',
    ),
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#history li").length'),
    3,
  );
  await evaluate(
    'document.getElementById("example").value="missing-evidence";document.getElementById("load").click()',
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("history").children.length===0 && !document.getElementById("load").disabled',
    ),
  );
  await evaluate(
    'document.querySelector("button[data-record=row-1][data-field=score]").click()',
  );
  assert.match(
    await evaluate('document.getElementById("evidence").textContent'),
    /not validated/,
  );
  assert.equal(
    await evaluate('document.getElementById("approve").disabled'),
    true,
  );
  await evaluate(
    'document.getElementById("example").value="ambiguous-association";document.getElementById("load").click()',
  );
  await waitFor(() =>
    evaluate(
      'document.getElementById("counts").textContent.includes("1 candidate") && !document.getElementById("load").disabled',
    ),
  );
  assert.match(
    await evaluate('document.getElementById("findings").textContent'),
    /association is wrong/,
  );
  assert.equal(
    await evaluate('document.getElementById("approve").disabled'),
    true,
  );
  await send("Page.reload");
  await waitFor(() =>
    evaluate(
      'document.readyState==="complete" && document.getElementById("workspace").hidden',
    ),
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#history li").length'),
    0,
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(outboundCalls, 0);
  console.log(
    "PASS: lab evidence highlighting, review guards, approve/reject/pending history, offline revalidation, real CSV/JSON downloads, inert review text, mobile layout and session reset; no outbound calls.",
  );
} finally {
  ws?.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await exited;
  await mf.dispose();
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
