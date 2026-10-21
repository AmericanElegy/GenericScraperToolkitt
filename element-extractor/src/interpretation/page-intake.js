// Full-page intake retains the complete source and maps bounded selections back to it.
import { ContractError, canonical, LIMITS } from './pipeline.js';
import { PROSE_SCHEMA, PROSE_VERSION } from './prose-rules.js';
import { WAGE_SCHEMA } from './wage-table.js';
export const PAGE_TABLE_VERSION = 'pasted-page-table-v1';
export const PAGE_LIMIT = 64000;
const grouped = { type: 'number', required: true, min: 0, number_format: 'en-US-grouped' };
export const EMPLOYMENT_SCHEMA = { fields: [
  { name: 'occupation', type: 'string', required: true },
  { name: 'employment_count', ...grouped },
  { name: 'location_quotient', type: 'number', required: true, min: 0 },
  { name: 'hourly_wage_dollars', type: 'number', required: true, min: 0 },
  { name: 'annual_wage_dollars', ...grouped },
] };
const plain = '\\d+(?:\\.\\d+)?';
const group = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const rowPatterns = {
  shares: new RegExp('^(.+?)\\s+('+plain+')\\s+('+plain+')\\s+\\$?('+plain+')\\s+\\$?('+plain+')$'),
  employment: new RegExp('^(.+?)\\s+('+group+')\\s+('+plain+')\\s+\\$?('+plain+')\\s+\\$?('+group+')$'),
};
function rowMatch(text, kind) {
  const m = text.trim().replace(/\s+/g, ' ').match(rowPatterns[kind]);
  return m && /[\p{L}]/u.test(m[1]) && !/\d$/.test(m[1]) && !/https?:\/\//i.test(m[1]) ? m : null;
}
function paragraphs(text, start = 0, end = text.length) {
  const result = [];
  let at = start;
  const add = stop => {
    const raw = text.slice(at, stop), trimmed = raw.trim();
    if (trimmed) { const lead = raw.length - raw.trimStart().length; result.push({ start: at + lead, end: at + lead + trimmed.length, text: trimmed }); }
  };
  for (const m of text.slice(start, end).matchAll(/\n[ \t]*\n+/g)) { add(start + m.index); at = start + m.index + m[0].length; }
  add(end); return result;
}
export function pageHeaders(text) {
  const found = [];
  const specs = [
    ['shares', /Major occupational group[ \t]+Percent of total employment[ \t]+Mean hourly wage \(\$\)[ \t\n]+(United States[ \t]+([^\n]+?))[ \t]+\1(?=\n|$)/gi],
    ['employment', /Occupation(?:\(1\))?[ \t]+Employment[ \t]+Mean wages \(\$\)[ \t\n]+Level(?:\(2\))?[ \t]+Location quotient(?:\(3\))?[ \t]+Hourly[ \t]+Annual(?:\(4\))?(?=\n|$)/gi],
  ];
  for (const [kind, re] of specs) for (const m of text.matchAll(re)) {
    found.push({ kind, start: text.lastIndexOf('\n', m.index - 1) + 1, end: m.index + m[0].length, local: kind === 'shares' ? m[2] : null });
  }
  return found.sort((a, b) => a.start - b.start);
}
export function needsPageIntake(source) {
  if (typeof source?.text !== 'string') return false;
  const text = source.text.replace(/\r\n?/g, '\n');
  return text.length > LIMITS.text || paragraphs(text).length > LIMITS.passages || pageHeaders(text).length > 1;
}
export function planPage(source) {
  if (!source || Object.keys(source).some(k => !['text', 'url'].includes(k)) || typeof source.text !== 'string' || !source.text.trim() || source.text.length > PAGE_LIMIT)
    throw new ContractError('page_limit', 'Paste nonempty page text up to 64,000 characters. Nothing is silently truncated.');
  const text = source.text.replace(/\r\n?/g, '\n');
  if (paragraphs(text).length > 512) throw new ContractError('page_limit', 'The page exceeds 512 paragraphs. Use a smaller page.');
  const headers = pageHeaders(text), datasets = [], consumed = [];
  const add = (label, ranges, schema, parser_version, kind, row_count = null) => {
    if (datasets.length >= 32) throw new ContractError('section_limit', 'More than 32 bounded sections. Use a smaller page.');
    let selected = ''; const source_map = [];
    for (const r of ranges) {
      if (selected) selected += '\n\n';
      source_map.push({ packet_start: selected.length, document_start: r.start, length: r.end - r.start });
      selected += text.slice(r.start, r.end);
    }
    if (selected.length > LIMITS.text || paragraphs(selected).length > LIMITS.passages)
      throw new ContractError('section_limit', 'One section exceeds a bounded packet. Paste a smaller section.');
    datasets.push({ id: 'section-' + (datasets.length + 1), label, text: selected, schema, parser_version, kind, row_count, source_map });
  };
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i], end = headers[i + 1]?.start ?? text.length;
    const rows = [];
    for (const p of paragraphs(text, h.end, end)) {
      if (!rowMatch(p.text, h.kind)) break;
      rows.push(p);
    }
    if (!rows.length) continue;
    consumed.push({ start: h.start, end: rows.at(-1).end });
    for (let at = 0; at < rows.length; at += 24) {
      const batch = rows.slice(at, at + 24);
      const label = h.kind === 'shares' ? 'Employment percentages and hourly dollars' : 'Employment counts, location quotients, hourly and annual dollars';
      add(label + ' · rows ' + (at + 1) + '–' + (at + batch.length) + ' of ' + rows.length + (h.local ? ' · ' + h.local : ''),
        [{ start: h.start, end: h.end }, { start: batch[0].start, end: batch.at(-1).end }],
        h.kind === 'shares' ? WAGE_SCHEMA : EMPLOYMENT_SCHEMA, PAGE_TABLE_VERSION, h.kind, batch.length);
    }
  }
  if (headers.length > 1 && !consumed.length)
    throw new ContractError('ambiguous_table_header', 'Repeated table headers have no recognizable rows. Paste a complete table or select a smaller section.');
  // Everything outside recognized table blocks remains in selectable prose sections.
  let at = 0; const rest = [];
  for (const r of consumed) { rest.push(...paragraphs(text, at, r.start)); at = r.end; }
  rest.push(...paragraphs(text, at));
  let batch = [], size = 0, part = 0;
  const flush = () => { if (batch.length) { add('Other page text · part ' + (++part), batch, PROSE_SCHEMA, PROSE_VERSION, 'prose'); batch = []; size = 0; } };
  for (const p of rest) {
    if (p.text.length > 12000) throw new ContractError('section_limit', 'A single page paragraph exceeds 12,000 characters. Add paragraph breaks before parsing.');
    if (batch.length >= 24 || size + p.text.length + 2 > 12000) flush();
    batch.push(p); size += p.text.length + 2;
  }
  flush();
  if (!datasets.length) throw new ContractError('empty_page', 'No nonempty page sections found.');
  return { text, datasets };
}
export function extractPageTable(packet) {
  const headers = pageHeaders(packet.source.text);
  if (headers.length !== 1) throw new ContractError('page_table_header', 'Expected one explicit grouped table header in this selection.');
  const h = headers[0], schema = h.kind === 'shares' ? WAGE_SCHEMA : EMPLOYMENT_SCHEMA;
  if (canonical(schema) !== canonical(packet.schema)) throw new ContractError('page_table_schema', 'Selected columns do not match the table header.');
  const headerPassage = packet.passages.find(p => p.start <= h.start && p.end >= h.end);
  if (!headerPassage) throw new ContractError('page_table_header', 'Header must be retained in its own evidence passage.');
  const fields = schema.fields, records = [], outcomes = [];
  for (const p of packet.passages) {
    const m = p.id === headerPassage.id ? null : rowMatch(p.text, h.kind);
    const ids = [];
    if (m) {
      if (records.length >= LIMITS.records || p.text.length > LIMITS.quote || headerPassage.text.length > LIMITS.quote)
        throw new ContractError('page_table_limit', 'Table selection exceeds row or quotation limits.');
      const id = 'row-' + (records.length + 1), span = { passage_id: p.id, quote: p.text, occurrence: 0 };
      records.push({ id, fields: Object.fromEntries(fields.map((f, i) => [f.name, {
        value: i ? Number(m[i + 1].replaceAll(',', '')) : m[1],
        evidence: i ? [span, { passage_id: headerPassage.id, quote: headerPassage.text, occurrence: 0 }] : [span],
      }])) }); ids.push(id);
    }
    outcomes.push({ passage_id: p.id, status: ids.length ? 'records' : 'no_result', record_ids: ids,
      reason: ids.length ? 'Typed cells mapped from this row and the explicit selected table header; review alignment before approval.' : 'Retained supporting header or unrecognized text; no data row inferred.' });
  }
  const headerOutcome = outcomes.find(o => o.passage_id === headerPassage.id);
  if (records.length) { headerOutcome.status = 'records'; headerOutcome.record_ids = records.map(r => r.id); }
  return { version: 'candidates-v1', records, outcomes };
}
export function documentEvidence(validation, selection, text, hash) {
  const copy = structuredClone(validation);
  for (const row of copy.records) for (const field of Object.values(row.fields)) for (const e of field.evidence) {
    const part = selection.source_map.find(r => e.source_start >= r.packet_start && e.source_end <= r.packet_start + r.length);
    if (!part) throw new ContractError('document_evidence', 'Evidence crosses a section boundary without a source mapping.');
    const start = part.document_start + e.source_start - part.packet_start;
    if (text.slice(start, start + e.quote.length) !== e.quote) throw new ContractError('document_evidence', 'Section evidence differs from the retained page.');
    e.document_start = start; e.document_end = start + e.quote.length; e.document_hash = hash;
  }
  return copy;
}
