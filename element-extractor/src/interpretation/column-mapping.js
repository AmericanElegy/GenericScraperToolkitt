// Offline, bounded column mapping. Delimiters establish boundaries; prose is not guessed.
import { ContractError, LIMITS, canonical } from './pipeline.js';
export const MAPPING_VERSION = 'mapped-table-v1';
const fail = message => { throw new ContractError('column_mapping', message); };
const literal = /^([+-]?)\$?([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%)?$/;
function numeric(raw) {
  const value = raw.trim(), m = value.match(literal);
  if (!m || (m[1] && /^[+-]/.test(m[2]))) return null;
  const number = Number((m[1] || '') + m[2].replaceAll(',', ''));
  return Number.isFinite(number) ? { value: number, dollar: value.includes('$'), percent: !!m[3] } : null;
}
const kinds = new Set(['text', 'number', 'percent', 'dollars']);
const reserved = new Set(['constructor','prototype','__proto__','record_id','review_status','validation_issues']);
function nameFor(label, index, used) {
  let name = label.toLowerCase().replace(/%/g, ' percent ').replace(/\$/g, ' dollars ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0,32);
  if (!/^[a-z]/.test(name) || reserved.has(name)) name = 'column_' + (index + 1);
  const base = name; let suffix = 2;
  while (used.has(name)) name = base + '_' + suffix++;
  used.add(name); return name;
}
export function detectColumns(text) {
  if (typeof text !== 'string' || text.length > LIMITS.text) return null;
  const lines = []; let start = 0;
  for (const raw of text.split('\n')) { if (raw.trim()) lines.push({ quote: raw.trim(), start: start + raw.length - raw.trimStart().length }); start += raw.length + 1; }
  if (lines.length < 2) return null;
  const headerAt = lines.findIndex(l => /\t|\||,/.test(l.quote));
  if (headerAt < 0 || headerAt > 3) return null;
  const header = lines[headerAt];
  const delimiter = header.quote.includes('\t') ? '\t' : header.quote.includes('|') ? '|' : ',';
  // Quoted CSV and embedded delimiters need a fuller dialect parser; do not split them incorrectly.
  const split = quote => {
    if (delimiter === ',' && quote.includes('"')) return null;
    let value = quote;
    if (delimiter === '|') value = value.replace(/^\|/, '').replace(/\|$/, '');
    return value.split(delimiter).map(v => v.trim());
  };
  const labels = split(header.quote);
  if (!labels || labels.length < 2 || labels.length > LIMITS.fields || labels.some(l => !/[\p{L}]/u.test(l) || l.length > 100 || /[\n<>]/.test(l) || (delimiter === ',' && /\d/.test(l)))) return null;
  const rows = [], skipped = [];
  for (const line of lines.slice(headerAt + 1)) {
    if (delimiter === '|' && /^\|?[\s:|-]+\|?$/.test(line.quote)) continue;
    const cells = split(line.quote);
    if (!cells || cells.length !== labels.length || line.quote.length > LIMITS.quote) {
      skipped.push({ quote: line.quote.slice(0,120), reason: 'Row has a different cell count, unsupported CSV quoting or exceeds the evidence limit.' }); continue;
    }
    rows.push({ ...line, cells });
  }
  if (!rows.length) return null;
  if (rows.length > LIMITS.records) fail('More than 50 mapped rows. Paste a smaller table; no rows were truncated.');
  if (header.quote.length > LIMITS.quote) fail('The header exceeds the evidence limit.');
  const used = new Set();
  const columns = labels.map((label, index) => {
    const values = rows.map(r => r.cells[index]).filter(Boolean), numbers = values.map(numeric);
    let kind = 'text', reason = 'Retained as text; no numeric conversion was assumed.';
    const identifier = /\b(id|identifier|code|zip|postal|date|year)\b/i.test(label) || values.some(v => /^[-+]?0\d/.test(v));
    if (!identifier && /%|\bpercent(?:age)?\b/i.test(label)) { kind = 'percent'; reason = 'Percentage heading; values remain on the 0–100 scale.'; }
    else if (!identifier && /\$|\bdollars?\b/i.test(label)) { kind = 'dollars'; reason = 'Explicit dollar heading; no currency conversion or ISO currency inference.'; }
    else if (!identifier && values.length && numbers.every(Boolean)) {
      if (numbers.every(n => n.percent && !n.dollar)) kind = 'percent';
      else if (numbers.every(n => n.dollar && !n.percent)) kind = 'dollars';
      else if (numbers.every(n => !n.dollar && !n.percent)) kind = 'number';
      reason = kind === 'text' ? 'Mixed unit markers retained as text.' : 'Consistent literal cell format; verify the heading before approval.';
    }
    return { label, name: nameFor(label,index,used), kind, reason };
  });
  return { delimiter: delimiter === '\t' ? 'tab' : delimiter, header, rows, columns, skipped, prefix_lines: headerAt };
}
export function mappedSchema(plan, overrides) {
  const columns = overrides === undefined ? plan.columns.map(({name,kind}) => ({name,kind})) : overrides;
  if (!Array.isArray(columns) || columns.length !== plan.columns.length || columns.some(c => !c || Object.keys(c).some(k => !['name','kind'].includes(k)) || typeof c.name !== 'string' || !kinds.has(c.kind))) fail('Choose one valid mapping for every source column.');
  // createPacket independently validates names, uniqueness and supported schema attributes.
  const schema = {fields: columns.map(c => ({ name: c.name, type: c.kind === 'text' ? 'string' : 'number', required: true,
    ...(c.kind === 'text' ? {} : { number_format: 'en-US-grouped' }), ...(c.kind === 'percent' ? {min:0,max:100} : {}),
  }))};
  return { columns, schema };
}
export function mappingFor(job) {
  if (job.parser_version !== MAPPING_VERSION) return null;
  const plan = detectColumns(job.packet.source.text);
  if (!plan) fail('No supported delimited table remains in this source.');
  const mapping = mappedSchema(plan, job.mapping);
  if (canonical(mapping.schema) !== canonical(job.packet.schema)) fail('Saved columns differ from the recorded mapping.');
  return { plan, ...mapping };
}
export function extractMappedTable(job) {
  const {plan,columns} = mappingFor(job), packet = job.packet;
  const locate = line => {
    const passage = packet.passages.find(p => line.start >= p.start && line.start + line.quote.length <= p.end);
    if (!passage) fail('A mapped row crosses a source boundary.');
    let occurrence = 0, found = passage.text.indexOf(line.quote);
    while (found >= 0 && found + passage.start < line.start) { occurrence++; found = passage.text.indexOf(line.quote,found+1); }
    return {passage_id:passage.id,quote:line.quote,occurrence};
  };
  const header = locate(plan.header);
  const records = plan.rows.map((row,index) => {
    const span = locate(row), issues = [];
    const fields = Object.fromEntries(columns.map((column,i) => {
      const raw = row.cells[i], n = numeric(raw);
      let value = column.kind === 'text' ? raw : n?.value ?? null;
      if (column.kind !== 'text' && n && ((n.percent && column.kind !== 'percent') || (n.dollar && column.kind !== 'dollars'))) {
        value = null; issues.push('A unit marker conflicts with the selected column mapping. Correct the mapping before approval.');
      }
      return [column.name,{value,evidence: value === null ? [] : [span,header]}];
    }));
    return {id:'row-'+(index+1),fields,...(issues.length ? {issues} : {})};
  });
  return {version:'candidates-v1',records,outcomes:packet.passages.map(p => {
    const ids = records.filter(r => Object.values(r.fields).some(f => f.evidence.some(e => e.passage_id === p.id))).map(r => r.id);
    return {passage_id:p.id,status:ids.length?'records':'no_result',record_ids:ids,reason:ids.length?'Cells mapped using an explicit delimited header; source row and header retained. This does not prove completeness.':'Retained text outside mapped rows.'};
  })};
}
