import {
  readFile,
  writeFile,
  appendFile,
  mkdir,
  open,
  unlink,
  stat,
} from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import {
  createPacket,
  scriptedInterpreter,
  runInterpretation,
  revalidate,
  appendReview,
  exportInterpretation,
  ContractError,
} from "../src/interpretation/pipeline.js";
const usage = `Offline interpretation lab (scripted data, no AI calls):
  npm run interpretation:demo
  node scripts/interpret.mjs run <input.json> <new-job-directory>
  node scripts/interpret.mjs revalidate <job-directory>
  node scripts/interpret.mjs review <job-directory> <record-id> <approve|reject|needs_review> <reviewer> "<note>" [--confirm-association]
  node scripts/interpret.mjs export <job-directory> [--diagnostic]
Exports default to approved records only. --diagnostic includes pending/rejected rows with their status.
Quotes and source text are written to local artifacts. Reviewer names are self-declared, not authenticated.`;
async function text(path, max = 524288) {
  if ((await stat(path)).size > max)
    throw new ContractError(
      "file_limit",
      "Input artifact exceeds its size limit.",
    );
  return readFile(path, "utf8");
}
async function json(path) {
  try {
    return JSON.parse(await text(path));
  } catch (e) {
    if (e instanceof SyntaxError)
      throw new ContractError(
        "invalid_json",
        "Artifact contains invalid JSON.",
      );
    throw e;
  }
}
async function journal(dir) {
  const value = await text(join(dir, "reviews.jsonl"), 2097152);
  if (value && !value.endsWith("\n"))
    throw new ContractError(
      "review_journal_invalid",
      "Review journal has an incomplete final line.",
    );
  try {
    return value
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new ContractError(
      "review_journal_invalid",
      "Review journal contains an invalid event.",
    );
  }
}
async function load(dir) {
  const packet = await json(join(dir, "packet.json")),
    entry = await json(join(dir, "response-cache.json"));
  const validation = await revalidate(packet, entry);
  return { packet, entry, validation, events: await journal(dir) };
}
const saveJSON = (path, data) =>
  writeFile(path, JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
async function run(inputPath, output) {
  const input = await json(inputPath),
    packet = await createPacket(input);
  const interpreter = Object.hasOwn(input, "scripted_response")
    ? await scriptedInterpreter(input.scripted_response)
    : null;
  const result = await runInterpretation(packet, interpreter);
  if (result.status === "capability_not_configured") {
    console.log(
      JSON.stringify({ status: result.status, issues: result.issues }, null, 2),
    );
    process.exitCode = 2;
    return;
  }
  const dir = resolve(output);
  await mkdir(dirname(dir), { recursive: true });
  await mkdir(dir);
  await saveJSON(join(dir, "packet.json"), packet);
  await saveJSON(join(dir, "response-cache.json"), result.cache_entry);
  await saveJSON(
    join(dir, "validation.json"),
    result.validation ?? { status: result.status, issues: result.issues },
  );
  await writeFile(join(dir, "reviews.jsonl"), "", { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        job_directory: dir,
        mode: "scripted_offline",
        status: result.status,
        validation_status: result.validation?.status,
        candidates: result.validation?.records.length ?? 0,
        approved: 0,
        flagged_candidates:
          result.validation?.records.filter(
            (r) =>
              r.issues.some((i) => i.code !== "association_unverified") ||
              Object.values(r.fields).some((f) => f.issues.length),
          ).length ?? 0,
        issues: result.issues ?? result.validation?.issues ?? [],
        notice:
          "No inference performed. Supplied scripted candidates require human review. Source attribution is user supplied, not fetched.",
      },
      null,
      2,
    ),
  );
  if (result.status !== "validated") process.exitCode = 2;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "demo") {
    await run(
      new URL("../examples/interpretation-scripted.json", import.meta.url),
      args[0] ?? join(".interpretation", "demo-" + Date.now()),
    );
    return;
  }
  if (command === "run" && args.length === 2) {
    await run(args[0], args[1]);
    return;
  }
  if (command === "revalidate" && args.length === 1) {
    const job = await load(args[0]);
    const output = await exportInterpretation(
      job.packet,
      job.entry,
      job.events,
      { approvedOnly: false },
    );
    console.log(JSON.stringify(output.json.validation, null, 2));
    return;
  }
  if (command === "review" && args.length >= 5) {
    const [dir, record_id, action, reviewer, note, ...flags] = args;
    const decision = {
      approve: "approved",
      reject: "rejected",
      needs_review: "needs_review",
    }[action];
    if (!decision || flags.some((f) => f !== "--confirm-association"))
      throw new ContractError(
        "invalid_review",
        "Unknown review action or flag.",
      );
    const lock = join(dir, "reviews.lock");
    const handle = await open(lock, "wx");
    try {
      const job = await load(dir);
      const events = await appendReview(job.packet, job.entry, job.events, {
        record_id,
        decision,
        reviewer,
        note,
        confirmed_association: flags.includes("--confirm-association"),
      });
      await appendFile(
        join(dir, "reviews.jsonl"),
        JSON.stringify(events.at(-1)) + "\n",
      );
      console.log(JSON.stringify(events.at(-1), null, 2));
    } finally {
      await handle.close();
      await unlink(lock);
    }
    return;
  }
  if (
    command === "export" &&
    (args.length === 1 || (args.length === 2 && args[1] === "--diagnostic"))
  ) {
    const dir = args[0],
      job = await load(dir),
      approvedOnly = args[1] !== "--diagnostic";
    const result = await exportInterpretation(
      job.packet,
      job.entry,
      job.events,
      { approvedOnly },
    );
    const prefix = join(
      dir,
      (approvedOnly ? "approved" : "diagnostic") + "-" + Date.now(),
    );
    await saveJSON(prefix + ".json", result.json);
    await writeFile(prefix + ".csv", result.csv, { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify(
        {
          json: resolve(prefix + ".json"),
          csv: resolve(prefix + ".csv"),
          ...result.json.counts,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(usage);
  if (command && command !== "--help") process.exitCode = 2;
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      code: error.code || "operation_failed",
      message:
        error instanceof ContractError
          ? error.message
          : error.code === "EEXIST"
            ? "Output or review lock already exists. Nothing was overwritten. Choose a new output name; inspect stale locks only when no review command is running."
            : error.code === "ENOENT"
              ? "Expected artifact or directory was not found. Check the input and job paths."
              : "Local operation failed. Check file paths and permissions; existing artifacts are not overwritten.",
    }),
  );
  process.exitCode = 1;
});
