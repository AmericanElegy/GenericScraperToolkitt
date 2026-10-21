// Deliberately narrow grammar, not semantic interpretation or a model call.
import { ContractError, LIMITS } from './pipeline.js';
export function extractTextRules(packet) {
  if (packet.schema.fields.length !== 2 || packet.schema.fields[0].type !== 'string' || packet.schema.fields[1].type !== 'number')
    throw new ContractError('rule_schema', 'The text parser needs a text column followed by a numeric column.');
  const [name, number] = packet.schema.fields.map(f => f.name);
  const records = [], outcomes = [];
  for (const p of packet.passages) {
    const ids = [];
    let cursor = 0;
    // Newlines or sentence boundaries; decimal points within a number stay intact.
    for (const line of p.text.split(/\n|(?<=[.!?])\s+(?=[A-Z])/)) {
      const quote = line.trim();
      const position = p.text.indexOf(quote, cursor);
      cursor = position + quote.length;
      let occurrence = 0, found = p.text.indexOf(quote);
      while (found >= 0 && found < position) { occurrence++; found = p.text.indexOf(quote, found + 1); }
      const match = quote.match(/^(.{1,120}?)\s*(?::|\s+(?:scored|received a score of|was given a score of))\s*([-+]?\d+(?:\.\d+)?)\.?$/i);
      if (!match || !/[\p{L}]/u.test(match[1]) || !Number.isFinite(Number(match[2]))) continue;
      if (records.length >= LIMITS.records) throw new ContractError('record_limit', 'More than 50 rule matches. Use a smaller passage; no matches were silently dropped.');
      const id = 'row-' + (records.length + 1);
      const span = { passage_id: p.id, quote, occurrence };
      const record = { id, fields: {
        [name]: { value: match[1].trim(), evidence: [span] },
        [number]: { value: Number(match[2]), evidence: [span] },
      } };
      if (/\b(correct(?:ion|ed)?|revised|not|never|instead|however|previously|disputed)\b/i.test(p.text))
        record.issues = ['This paragraph includes correction, negation or uncertainty wording. The rule match needs a manually corrected candidate with supporting quotations.'];
      records.push(record); ids.push(id);
    }
    outcomes.push({ passage_id: p.id, status: ids.length ? 'records' : 'no_result', record_ids: ids,
      reason: ids.length ? 'Matched a limited name/number grammar; human association review is still required.' : 'No supported name/number pattern matched. This does not mean the paragraph contains no useful data. Add a candidate manually or reformat the source in a new session.' });
  }
  return { version: 'candidates-v1', records, outcomes };
}
