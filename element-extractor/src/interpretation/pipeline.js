// Standalone offline interpretation contract. No provider SDKs, networking, or domain rules.
export const PACKET_VERSION = "passages-v1";
export const RESPONSE_VERSION = "candidates-v1";
export const VALIDATOR_VERSION = "evidence-v1";
export const LIMITS = Object.freeze({
  text: 16000,
  passages: 32,
  fields: 8,
  records: 50,
  spans: 4,
  quote: 2048,
  response: 131072,
  events: 1000,
});
const encoder = new TextEncoder();
export class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}
function check(ok, code, message) {
  if (!ok) throw new ContractError(code, message);
}
function object(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
function keys(v, allowed) {
  return object(v) && Object.keys(v).every((k) => allowed.includes(k));
}
function bounded(s, max) {
  return typeof s === "string" && s.length > 0 && s.length <= max;
}
export function canonical(value, depth = 0) {
  check(depth <= 16, "json_depth", "JSON nesting exceeds the limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    check(
      Number.isFinite(value),
      "nonfinite_number",
      "Numbers must be finite.",
    );
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return (
      "[" + Array.from(value, (v) => canonical(v, depth + 1)).join(",") + "]"
    );
  check(object(value), "invalid_json", "Only plain JSON values are supported.");
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k], depth + 1))
      .join(",") +
    "}"
  );
}
const copy = (v) => JSON.parse(canonical(v));
export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(typeof value === "string" ? value : canonical(value)),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function schemaOf(schema) {
  check(
    keys(schema, ["fields"]) &&
      Array.isArray(schema.fields) &&
      schema.fields.length > 0 &&
      schema.fields.length <= LIMITS.fields,
    "invalid_schema",
    "Provide 1–8 requested fields.",
  );
  const names = new Set();
  for (const f of schema.fields) {
    check(
      keys(f, ["name", "type", "required", "min", "max", "number_format"]) &&
        typeof f.name === "string" &&
        /^[a-z][a-z0-9_]{0,39}$/.test(f.name) &&
        ![
          "constructor",
          "prototype",
          "__proto__",
          "record_id",
          "review_status",
          "validation_issues",
        ].includes(f.name) &&
        !names.has(f.name),
      "invalid_schema",
      "Field names must be unique, safe identifiers.",
    );
    check(
      ["string", "number"].includes(f.type) && typeof f.required === "boolean",
      "invalid_schema",
      "Each field requires a string/number type and a required boolean.",
    );
    check(f.number_format === undefined || (f.type === "number" && f.number_format === "en-US-grouped"),
      "invalid_schema", "number_format is only supported for numeric en-US-grouped fields.");
    for (const k of ["min", "max"])
      if (Object.hasOwn(f, k))
        check(
          f.type === "number" && Number.isFinite(f[k]),
          "invalid_schema",
          "Bounds must be finite and apply only to numeric fields.",
        );
    check(
      f.min === undefined || f.max === undefined || f.min <= f.max,
      "invalid_schema",
      "Minimum cannot exceed maximum.",
    );
    names.add(f.name);
  }
  return copy(schema);
}
export async function createPacket(
  { source, schema },
  now = new Date().toISOString(),
) {
  check(
    keys(source, ["url", "text"]) && bounded(source.text, LIMITS.text),
    "invalid_source",
    "Provide nonempty source text up to 16,000 UTF-16 code units. Text is never silently truncated.",
  );
  let url = null;
  if (source.url !== undefined && source.url !== null) {
    let u;
    try {
      u = new URL(source.url);
    } catch {}
    check(
      u?.protocol === "https:" &&
        !u.username &&
        !u.password &&
        source.url.length <= 2048,
      "invalid_source",
      "Source attribution must be a credential-free HTTPS URL. No URL is fetched in this offline lane.",
    );
    url = u.href;
  }
  check(
    typeof now === "string" && Number.isFinite(Date.parse(now)),
    "invalid_timestamp",
    "Invalid receipt timestamp.",
  );
  const text = source.text.replace(/\r\n?/g, "\n");
  const passages = [];
  let start = 0;
  const add = (end) => {
    const slice = text.slice(start, end);
    const leading = slice.length - slice.trimStart().length;
    const value = slice.trim();
    if (value)
      passages.push({
        id: "p" + String(passages.length + 1).padStart(3, "0"),
        text: value,
        start: start + leading,
        end: start + leading + value.length,
      });
  };
  for (const m of text.matchAll(/\n[ \t]*\n+/g)) {
    add(m.index);
    start = m.index + m[0].length;
  }
  add(text.length);
  check(
    passages.length > 0 && passages.length <= LIMITS.passages,
    "passage_limit",
    "Source must contain 1–32 paragraphs. No paragraphs are silently omitted.",
  );
  for (const p of passages) p.hash = await digest(p.text);
  const packet = {
    version: PACKET_VERSION,
    source: {
      url,
      provenance: "user_supplied_text",
      received_at: new Date(now).toISOString(),
      text,
      text_hash: await digest(text),
      original_text_hash: await digest(source.text),
      offset_unit: "UTF-16 code units; start inclusive, end exclusive",
    },
    schema: schemaOf(schema),
    passages,
  };
  return freeze({ ...packet, hash: await digest(packet) });
}
export async function verifyPacket(packet) {
  check(
    keys(packet, ["version", "source", "schema", "passages", "hash"]) &&
      packet.version === PACKET_VERSION,
    "invalid_packet",
    "Unsupported packet format.",
  );
  const { hash, ...body } = packet;
  check(
    hash === (await digest(body)),
    "packet_hash_mismatch",
    "Packet content does not match its hash.",
  );
  check(
    keys(packet.source, [
      "url",
      "provenance",
      "received_at",
      "text",
      "text_hash",
      "original_text_hash",
      "offset_unit",
    ]) && packet.source.provenance === "user_supplied_text",
    "invalid_packet",
    "Unsupported source provenance.",
  );
  const rebuilt = await createPacket(
    {
      source: { url: packet.source.url, text: packet.source.text },
      schema: packet.schema,
    },
    packet.source.received_at,
  );
  check(
    packet.source.text_hash === rebuilt.source.text_hash &&
      canonical(packet.passages) === canonical(rebuilt.passages) &&
      canonical(packet.schema) === canonical(rebuilt.schema),
    "invalid_packet",
    "Passage offsets, hashes or schema are inconsistent with the retained snapshot.",
  );
  check(
    /^[a-f0-9]{64}$/.test(packet.source.original_text_hash),
    "invalid_packet",
    "Invalid original text hash.",
  );
  return packet;
}
const issue = (code, message) => ({ code, message });
function evidenceFor(candidate, field, packet) {
  const issues = [],
    evidence = [];
  if (!object(candidate)) {
    if (field.required)
      issues.push(
        issue(
          "missing_field",
          "No candidate supplied for this required field.",
        ),
      );
    return { value: null, evidence, issues };
  }
  const value = Object.hasOwn(candidate, "value") ? candidate.value : null;
  if (!keys(candidate, ["value", "evidence"]))
    issues.push(issue("unknown_field_metadata", "Unexpected field metadata."));
  if (value === null) {
    if (field.required)
      issues.push(
        issue("required_value_missing", "A required value is missing."),
      );
    if (candidate.evidence?.length)
      issues.push(
        issue("evidence_without_value", "Evidence supplied without a value."),
      );
    return { value, evidence, issues };
  }
  const correctType =
    typeof value === field.type &&
    (field.type !== "number" || Number.isFinite(value));
  if (!correctType)
    issues.push(
      issue(
        "wrong_type",
        "Candidate type does not match the requested column.",
      ),
    );
  if (field.type === "string" && !bounded(value, 2048))
    issues.push(
      issue("invalid_string", "Text values must contain 1–2048 code units."),
    );
  if (
    correctType &&
    field.type === "number" &&
    ((field.min !== undefined && value < field.min) ||
      (field.max !== undefined && value > field.max))
  )
    issues.push(
      issue("out_of_bounds", "Number is outside the requested bounds."),
    );
  if (
    !Array.isArray(candidate.evidence) ||
    candidate.evidence.length === 0 ||
    candidate.evidence.length > LIMITS.spans
  ) {
    issues.push(
      issue(
        "evidence_required",
        "Supply 1–4 supporting spans per nonempty field.",
      ),
    );
    return { value, evidence, issues };
  }
  for (const span of candidate.evidence) {
    if (
      !keys(span, ["passage_id", "quote", "occurrence"]) ||
      !bounded(span.quote, LIMITS.quote)
    ) {
      issues.push(issue("invalid_evidence", "Malformed supporting span."));
      continue;
    }
    const p = packet.passages.find((p) => p.id === span.passage_id);
    if (!p) {
      issues.push(
        issue("unknown_passage", "Evidence references an unknown passage."),
      );
      continue;
    }
    const positions = [];
    let at = 0;
    while (at <= p.text.length) {
      const found = p.text.indexOf(span.quote, at);
      if (found < 0) break;
      positions.push(found);
      at = found + 1;
    }
    if (!positions.length) {
      issues.push(
        issue(
          "quote_not_found",
          "Exact quotation is absent from the cited passage.",
        ),
      );
      continue;
    }
    const occurrence = span.occurrence ?? (positions.length === 1 ? 0 : null);
    if (
      !Number.isInteger(occurrence) ||
      occurrence < 0 ||
      occurrence >= positions.length
    ) {
      issues.push(
        issue(
          "ambiguous_quote",
          "Repeated quotations require a valid zero-based occurrence index.",
        ),
      );
      continue;
    }
    const local = positions[occurrence];
    evidence.push({
      passage_id: p.id,
      quote: span.quote,
      occurrence,
      passage_start: local,
      passage_end: local + span.quote.length,
      source_start: p.start + local,
      source_end: p.start + local + span.quote.length,
      source_hash: packet.source.text_hash,
    });
  }
  if (correctType && evidence.length) {
    const supported =
      field.type === "string"
        ? evidence.some((e) => e.quote.includes(value))
        : evidence.some((e) =>
            Array.from(
              e.quote.matchAll(
                field.number_format === "en-US-grouped"
                  ? /(?<![\w.,])[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?!\w|\.\d|,\d)/g
                  : /(?<![\w.,])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?!\w|\.\d|,\d)/g,
              ),
              (m) => Number(field.number_format === "en-US-grouped" ? m[0].replaceAll(",", "") : m[0]),
            ).includes(value),
          );
    if (!supported)
      issues.push(
        issue(
          "literal_support_missing",
          field.number_format === "en-US-grouped"
            ? "The literal value is not supported by a strict en-US-grouped number in the retained quotations."
            : "The literal value is not supported by the retained quotations. Numeric formatting is limited to signed, ungrouped decimal notation.",
        ),
      );
  }
  return { value, evidence, issues };
}
export async function validateResponse(packet, response) {
  await verifyPacket(packet);
  check(
    encoder.encode(canonical(response)).byteLength <= LIMITS.response,
    "response_limit",
    "Response exceeds 128 KiB.",
  );
  check(
    keys(response, ["version", "records", "outcomes"]) &&
      response.version === RESPONSE_VERSION &&
      Array.isArray(response.records) &&
      response.records.length <= LIMITS.records &&
      Array.isArray(response.outcomes) &&
      response.outcomes.length <= LIMITS.passages,
    "invalid_response",
    "Expected a bounded versioned records/outcomes response.",
  );
  const ids = new Set(),
    records = [];
  for (const candidate of response.records) {
    check(
      keys(candidate, ["id", "fields", "issues"]) &&
        typeof candidate.id === "string" &&
        /^[a-zA-Z0-9_-]{1,60}$/.test(candidate.id) &&
        !ids.has(candidate.id) &&
        object(candidate.fields),
      "invalid_response",
      "Record IDs must be unique, bounded, and accompanied by fields.",
    );
    ids.add(candidate.id);
    const fields = {},
      issues = [
        issue(
          "association_unverified",
          "Literal evidence and valid types do not establish entity/value association. Human review is required.",
        ),
      ];
    for (const name of Object.keys(candidate.fields))
      if (!packet.schema.fields.some((f) => f.name === name))
        issues.push(
          issue(
            "unknown_column",
            "Interpreter supplied an unrequested column: " + name.slice(0, 40),
          ),
        );
    for (const field of packet.schema.fields)
      fields[field.name] = evidenceFor(
        Object.hasOwn(candidate.fields, field.name)
          ? candidate.fields[field.name]
          : null,
        field,
        packet,
      );
    if (candidate.issues !== undefined) {
      check(
        Array.isArray(candidate.issues) &&
          candidate.issues.length <= 16 &&
          candidate.issues.every((s) => bounded(s, 256)),
        "invalid_response",
        "Interpreter issues must be a bounded string list.",
      );
      for (const text of candidate.issues)
        issues.push(issue("interpreter_flag", text));
    }
    if (
      new Set(
        Object.values(fields).flatMap((f) =>
          f.evidence.map((e) => e.passage_id),
        ),
      ).size > 1
    )
      issues.push(
        issue(
          "cross_passage_association",
          "Support spans multiple passages; the association needs explicit review.",
        ),
      );
    records.push({
      id: candidate.id,
      fields,
      issues,
      review_status: "needs_review",
    });
  }
  const outcomes = [],
    issues = [],
    seen = new Set();
  for (const outcome of response.outcomes) {
    check(
      keys(outcome, ["passage_id", "status", "record_ids", "reason"]) &&
        packet.passages.some((p) => p.id === outcome.passage_id) &&
        !seen.has(outcome.passage_id) &&
        ["records", "no_result"].includes(outcome.status) &&
        Array.isArray(outcome.record_ids) &&
        outcome.record_ids.length <= LIMITS.records &&
        bounded(outcome.reason, 512),
      "invalid_response",
      "Every passage outcome needs valid identity, status, record IDs and reason.",
    );
    seen.add(outcome.passage_id);
    check(
      new Set(outcome.record_ids).size === outcome.record_ids.length &&
        outcome.record_ids.every((id) => ids.has(id)) &&
        (outcome.status === "no_result"
          ? outcome.record_ids.length === 0
          : outcome.record_ids.length > 0),
      "invalid_response",
      "Passage outcome record references are inconsistent.",
    );
    const supportedIds = new Set(
      records
        .filter((r) =>
          Object.values(r.fields).some((f) =>
            f.evidence.some((e) => e.passage_id === outcome.passage_id),
          ),
        )
        .map((r) => r.id),
    );
    for (const id of outcome.record_ids)
      if (!supportedIds.has(id))
        issues.push(
          issue(
            "outcome_without_evidence",
            "Record " +
              id +
              " is assigned to " +
              outcome.passage_id +
              " without supporting evidence.",
          ),
        );
    for (const id of supportedIds)
      if (!outcome.record_ids.includes(id))
        issues.push(
          issue(
            "unaccounted_record_evidence",
            "Evidence for " +
              id +
              " in " +
              outcome.passage_id +
              " is not accounted for.",
          ),
        );
    outcomes.push(copy(outcome));
  }
  for (const p of packet.passages)
    if (!seen.has(p.id)) {
      issues.push(
        issue("unaccounted_passage", "Interpreter did not account for " + p.id),
      );
      outcomes.push({
        passage_id: p.id,
        status: "not_processed",
        record_ids: [],
        reason: "No outcome supplied.",
      });
    }
  for (const r of records)
    if (!outcomes.some((o) => o.record_ids.includes(r.id)))
      issues.push(
        issue("unaccounted_record", "No passage outcome accounts for " + r.id),
      );
  return freeze({
    validator_version: packet.schema.fields.some(f => f.number_format) ? "evidence-grouped-v1" : VALIDATOR_VERSION,
    packet_hash: packet.hash,
    source_hash: packet.source.text_hash,
    status: issues.length
      ? "incomplete"
      : records.length
        ? "candidates_require_review"
        : "interpreter_reported_no_result",
    records,
    outcomes,
    issues,
  });
}
export async function scriptedInterpreter(response) {
  const raw = copy(response);
  check(
    encoder.encode(canonical(raw)).byteLength <= LIMITS.response,
    "response_limit",
    "Scripted response exceeds 128 KiB.",
  );
  return Object.freeze({
    identity: Object.freeze({
      id: "scripted",
      version: "1",
      script_hash: await digest(raw),
    }),
    interpret: async () => copy(raw),
  });
}
const keyFor = async (packet, identity) =>
  digest({
    packet_version: PACKET_VERSION,
    response_version: RESPONSE_VERSION,
    packet_hash: packet.hash,
    interpreter: identity,
  });
export async function revalidate(packet, entry) {
  await verifyPacket(packet);
  check(
    keys(entry, [
      "format",
      "key",
      "packet_hash",
      "interpreter",
      "raw_response",
      "raw_hash",
    ]) &&
      entry.format === "response-cache-v1" &&
      entry.packet_hash === packet.hash &&
      entry.key === (await keyFor(packet, entry.interpreter)) &&
      entry.raw_hash === (await digest(entry.raw_response)),
    "cache_integrity",
    "Cached raw response or packet identity is inconsistent.",
  );
  check(
    keys(entry.interpreter, ["id", "version", "script_hash"]) &&
      entry.interpreter.id === "scripted" &&
      entry.interpreter.version === "1" &&
      entry.interpreter.script_hash === entry.raw_hash,
    "cache_identity",
    "Unsupported or inconsistent interpreter identity.",
  );
  return validateResponse(packet, entry.raw_response);
}
export async function runInterpretation(
  packet,
  interpreter = null,
  cache = new Map(),
) {
  await verifyPacket(packet);
  if (!interpreter)
    return {
      status: "capability_not_configured",
      packet,
      cache_entry: null,
      validation: null,
      issues: [
        issue(
          "interpreter_not_configured",
          "No interpreter configured. No inference or network request was made.",
        ),
      ],
    };
  check(
    interpreter.identity?.id === "scripted" &&
      typeof interpreter.interpret === "function",
    "unsupported_interpreter",
    "Only an explicit scripted interpreter is enabled.",
  );
  const key = await keyFor(packet, interpreter.identity);
  let entry = cache.get(key),
    cache_hit = Boolean(entry);
  if (!entry) {
    const raw = copy(await interpreter.interpret(freeze(copy(packet))));
    entry = {
      format: "response-cache-v1",
      key,
      packet_hash: packet.hash,
      interpreter: copy(interpreter.identity),
      raw_response: raw,
      raw_hash: await digest(raw),
    };
    cache.set(key, freeze(copy(entry)));
  }
  try {
    return {
      status: "validated",
      packet,
      cache_entry: freeze(copy(entry)),
      cache_hit,
      validation: await revalidate(packet, entry),
    };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return {
      status: "invalid_response",
      packet,
      cache_entry: freeze(copy(entry)),
      cache_hit,
      validation: null,
      issues: [issue(error.code, error.message)],
    };
  }
}
const blocking = (r) =>
  r.issues.some(
    (i) =>
      !["association_unverified", "cross_passage_association"].includes(i.code),
  ) || Object.values(r.fields).some((f) => f.issues.length);
async function replayReviews(packet, validation, events = []) {
  check(
    validation.packet_hash === packet.hash,
    "review_identity",
    "Validation does not belong to this packet.",
  );
  check(
    Array.isArray(events) && events.length <= LIMITS.events,
    "review_limit",
    "Review event limit exceeded.",
  );
  const validation_hash = await digest(validation),
    states = new Map(validation.records.map((r) => [r.id, "needs_review"]));
  let previous = null;
  for (const [index, event] of events.entries()) {
    check(
      keys(event, [
        "sequence",
        "previous_hash",
        "packet_hash",
        "validation_hash",
        "record_id",
        "decision",
        "reviewer",
        "note",
        "confirmed_association",
        "at",
        "hash",
      ]) &&
        event.sequence === index + 1 &&
        event.previous_hash === previous &&
        event.packet_hash === packet.hash &&
        event.validation_hash === validation_hash &&
        states.has(event.record_id),
      "review_identity",
      "Review history is out of order or belongs to a different validation.",
    );
    const { hash, ...body } = event;
    check(
      hash === (await digest(body)),
      "review_integrity",
      "Review event hash mismatch.",
    );
    check(
      ["approved", "rejected", "needs_review"].includes(event.decision) &&
        bounded(event.reviewer, 80) &&
        event.reviewer.trim().length > 0 &&
        bounded(event.note, 1000) &&
        event.note.trim().length > 0 &&
        typeof event.confirmed_association === "boolean" &&
        typeof event.at === "string" &&
        Number.isFinite(Date.parse(event.at)),
      "invalid_review",
      "Malformed review event.",
    );
    if (event.decision === "approved")
      check(
        !validation.issues.length &&
          !blocking(validation.records.find((r) => r.id === event.record_id)) &&
          event.confirmed_association,
        "approval_blocked",
        "Approval requires clean independent checks and an explicit human association confirmation.",
      );
    states.set(event.record_id, event.decision);
    previous = hash;
  }
  return states;
}
export async function appendReview(packet, entry, events, decision, now = new Date().toISOString()) {
  return appendReviewBatch(packet, entry, events, [decision], now);
}
export async function appendReviewBatch(packet, entry, events, decisions, now = new Date().toISOString()) {
  check(Array.isArray(decisions) && decisions.length > 0 && decisions.length <= LIMITS.records,
    "invalid_review", "Provide a bounded set of review decisions.");
  const validation = await revalidate(packet, entry);
  await replayReviews(packet, validation, events);
  const validationHash = await digest(validation), updated = copy(events);
  for (const decision of decisions) {
    check(keys(decision, ["record_id", "decision", "reviewer", "note", "confirmed_association"]),
      "invalid_review", "Unexpected review fields.");
    const body = { ...copy(decision), confirmed_association: decision.confirmed_association ?? false,
      sequence: updated.length + 1, previous_hash: updated.at(-1)?.hash ?? null,
      packet_hash: packet.hash, validation_hash: validationHash, at: now };
    updated.push({ ...body, hash: await digest(body) });
  }
  // Check the whole proposed journal before returning it; callers retain the old
  // state on any failure. Validation is shared, while every row has its own event.
  await replayReviews(packet, validation, updated);
  return freeze(updated);
}
function quoteCSV(value) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export async function exportInterpretation(
  packet,
  entry,
  events = [],
  { approvedOnly = true } = {},
) {
  const validation = await revalidate(packet, entry),
    states = await replayReviews(packet, validation, events);
  const all = validation.records.map((r) => ({
    ...copy(r),
    review_status: states.get(r.id),
  }));
  const records = approvedOnly
    ? all.filter((r) => r.review_status === "approved")
    : all;
  const json = {
    kind: approvedOnly
      ? "approved_interpretation_export"
      : "interpretation_diagnostic_export",
    counts: {
      total_candidates: all.length,
      exported: records.length,
      excluded: all.length - records.length,
    },
    notice:
      "Scripted candidate data; not AI inference or automatic factual verification. Only explicitly reviewed records may be approved.",
    packet: copy(packet),
    cache_identity: {
      key: entry.key,
      raw_hash: entry.raw_hash,
      interpreter: copy(entry.interpreter),
    },
    validation: { ...copy(validation), records },
    review_events: copy(events),
  };
  if (!approvedOnly) json.raw_response = copy(entry.raw_response);
  const headers = [
    "record_id",
    "review_status",
    ...packet.schema.fields.map((f) => f.name),
    "validation_issues",
  ];
  const csv =
    [
      headers,
      ...records.map((r) => [
        r.id,
        r.review_status,
        ...packet.schema.fields.map((f) => r.fields[f.name].value),
        [
          ...r.issues.map((i) => i.code),
          ...Object.entries(r.fields).flatMap(([name, f]) =>
            f.issues.map((i) => name + ":" + i.code),
          ),
          ...validation.issues.map((i) => i.code),
        ].join(";"),
      ]),
    ]
      .map((row) => row.map(quoteCSV).join(","))
      .join("\r\n") + "\r\n";
  return { json, csv };
}
