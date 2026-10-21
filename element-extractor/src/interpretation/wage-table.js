// A bounded pasted-table layout, recognized by its explicit grouped headers.
// No source URL, city-specific data or external requests are used.
import { ContractError, canonical, LIMITS } from './pipeline.js';
export const WAGE_VERSION = 'pasted-wage-table-v1';
export const WAGE_SCHEMA = { fields: [
  { name: 'occupational_group', type: 'string', required: true },
  { name: 'employment_percent_national', type: 'number', required: true, min: 0, max: 100 },
  { name: 'employment_percent_local', type: 'number', required: true, min: 0, max: 100 },
  { name: 'hourly_wage_national_dollars', type: 'number', required: true, min: 0 },
  { name: 'hourly_wage_local_dollars', type: 'number', required: true, min: 0 },
] };
export function wageHeader(packet) {
  const matches = packet.passages.map(p => {
    const normalized = p.text.replace(/\s+/g, ' ').trim();
    const m = normalized.match(/^Major occupational group Percent of total employment Mean hourly wage \(\$\) (United States (.+?)) \1$/i);
    return m ? { passage: p, national: 'United States', local: m[2] } : null;
  }).filter(Boolean);
  if (matches.length > 1) throw new ContractError('ambiguous_table_header', 'More than one wage-table header was found. Paste one table at a time.');
  return matches[0] || null;
}
export function extractWageTable(packet) {
  const header = wageHeader(packet);
  if (!header || canonical(packet.schema) !== canonical(WAGE_SCHEMA))
    throw new ContractError('wage_table_schema', 'The pasted wage table needs its explicit grouped percentage and hourly-dollar headers.');
  const records = [], outcomes = [];
  const names = WAGE_SCHEMA.fields.map(f => f.name);
  for (const p of packet.passages) {
    const ids = [];
    if (p.id !== header.passage.id) {
      let cursor = 0;
      for (const line of p.text.split('\n')) {
        const quote = line.trim();
        const pos = p.text.indexOf(quote, cursor); cursor = pos + quote.length;
        // Exactly four values, in the order established by the grouped header.
        const m = quote.match(/^(.+?)[ \t]+(\d+(?:\.\d+)?)[ \t]+(\d+(?:\.\d+)?)[ \t]+\$?(\d+(?:\.\d+)?)[ \t]+\$?(\d+(?:\.\d+)?)$/);
        if (!m || !/[\p{L}]/u.test(m[1]) || /\d$/.test(m[1]) || /https?:\/\//i.test(quote)) continue;
        if (records.length >= LIMITS.records) throw new ContractError('record_limit', 'More than 50 table rows. Paste a smaller table.');
        if (quote.length > LIMITS.quote || header.passage.text.length > LIMITS.quote) throw new ContractError('quote_limit', 'Table row or header exceeds the evidence limit.');
        let occurrence = 0, found = p.text.indexOf(quote);
        while (found >= 0 && found < pos) { occurrence++; found = p.text.indexOf(quote, found + 1); }
        const span = { passage_id: p.id, quote, occurrence };
        const fields = Object.fromEntries(names.map((name, i) => [name, {
          value: i === 0 ? m[1] : Number(m[i + 1]),
          evidence: i === 0 ? [span] : [span, { passage_id: header.passage.id, quote: header.passage.text, occurrence: 0 }],
        }]));
        const id = 'row-' + (records.length + 1); records.push({ id, fields }); ids.push(id);
      }
    }
    outcomes.push({ passage_id: p.id, status: ids.length ? 'records' : 'no_result', record_ids: ids,
      reason: p.id === header.passage.id ? 'Grouped header supplies column meanings and currency units; it is retained as evidence, not a data row.' : ids.length ? 'Four numeric cells mapped to the explicit grouped header. Confirm row alignment and units before approval.' : 'No complete four-value row recognized. This text was retained, not guessed or discarded.' });
  }
  // Header evidence is explicitly accounted for as support for all rows.
  const h = outcomes.find(o => o.passage_id === header.passage.id);
  if (records.length) { h.status = 'records'; h.record_ids = records.map(r => r.id); }
  return { version: 'candidates-v1', records, outcomes };
}
