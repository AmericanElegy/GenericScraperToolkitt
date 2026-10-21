// Versioned, offline fact suggestions. These patterns do not understand arbitrary prose.
import { ContractError, LIMITS, canonical } from './pipeline.js';
import { extractTextRules } from './text-rules.js';
export const PROSE_VERSION = 'prose-facts-v1';
export const PROSE_SCHEMA = { fields: [
  { name: 'measure', type: 'string', required: true },
  { name: 'value', type: 'number', required: true },
  { name: 'unit', type: 'string', required: false },
  { name: 'qualifier', type: 'string', required: false },
] };
const number = '[-+]?\\d+(?:\\.\\d+)?';
const qualifiers = 'over|more than|at least|about|approximately|roughly|nearly|under|less than|up to|at most';
const counts = 'areas|states|employees|workers|establishments|respondents|participants|schools|hospitals|people|households|companies|students|patients';
const flags = /\b(correct(?:ion|ed)?|revised|no|not|never|instead|however|previously|disputed|forecast|projected|estimated)\b/i;
export function extractProseRules(packet) {
  if (canonical(packet.schema) !== canonical(PROSE_SCHEMA))
    throw new ContractError('prose_schema', 'Automatic prose mode uses its suggested measure/value/unit/qualifier columns.');
  const records = [], outcomes = [];
  for (const passage of packet.passages) {
    const ids = [], seen = new Set();
    // Mask URL targets (including Markdown hrefs) without changing source offsets.
    const masked = passage.text.replace(/https?:\/\/[^\s)"<>]+/g, s => ' '.repeat(s.length));
    // A period only ends a sentence when followed by whitespace or end of text.
    const sentences = [...masked.matchAll(/[^.!?\n]*(?:\.(?!\s|$)[^.!?\n]*)*(?:[.!?](?=\s|$)|$)/g)].filter(m => m[0].trim());
    for (const sentence of sentences) {
      const raw = passage.text.slice(sentence.index, sentence.index + sentence[0].length).trim();
      const searchable = sentence[0].trim();
      const add = (measure, value, unit = null, qualifier = null, uncertain = false) => {
        measure = measure.trim().replace(/[\s,;:.]+$/, '');
        if (!measure || !/[\p{L}]/u.test(measure)) return;
        if (raw.length > LIMITS.quote) throw new ContractError('quote_limit', 'A matched sentence exceeds the 2,048-character evidence limit. Paste a smaller section.');
        const key = canonical([measure, value, unit, qualifier, sentence.index]);
        if (seen.has(key)) return;
        seen.add(key);
        if (records.length >= LIMITS.records) throw new ContractError('record_limit', 'More than 50 suggested facts. Paste a smaller section; nothing was silently truncated.');
        const id = 'row-' + (records.length + 1);
        const local = passage.text.indexOf(raw, sentence.index);
        let occurrence = 0, found = passage.text.indexOf(raw);
        while (found >= 0 && found < local) { occurrence++; found = passage.text.indexOf(raw, found + 1); }
        const evidence = [{ passage_id: passage.id, quote: raw, occurrence }];
        const field = v => ({ value: v, evidence: v === null ? [] : evidence });
        const candidate = { id, fields: { measure: field(measure), value: field(value), unit: field(unit), qualifier: field(qualifier) } };
        if (flags.test(searchable) || uncertain)
          candidate.issues = ['This sentence contains uncertainty, correction, negation or a percentage outside 0–100. Inspect the context and explicitly correct the candidate before approval.'];
        records.push(candidate); ids.push(id);
      };
      // Each rate is associated only with its immediately following "based on" label.
      const based = new RegExp('(?<![\\w.,-])(?:('+qualifiers+')\\s+)?('+number+')\\s*(percent|%)\\s+(?:based on|of)\\s+([^.;!?]+?)(?=\\s+(?:and|or)\\s+(?:(?:'+qualifiers+')\\s+)?'+number+'\\s*(?:percent|%)|[.;!?]|$)', 'gi');
      let rateFound = false;
      for (const m of searchable.matchAll(based)) {
        add(m[4], Number(m[2]), m[3], m[1] || null, Number(m[2]) < 0 || Number(m[2]) > 100);
        rateFound = true;
      }
      // Conservative single-clause labels. Multiple unassociated rates are left unmatched.
      const percentCount = [...searchable.matchAll(new RegExp(number+'\\s*(?:percent|%)', 'gi'))].length;
      if (!rateFound && percentCount === 1) {
        const m = searchable.match(new RegExp('^(.{1,180}?)\\s*(?::\\s*|\\s+(?:was|were|is|are|reached|totaled|at)\\s+)(?:('+qualifiers+')\\s+)?('+number+')\\s*(percent|%)\\.?$', 'i'));
        if (m) add(m[1], Number(m[3]), m[4], m[2] || null, Number(m[3]) < 0 || Number(m[3]) > 100);
      }
      // Count nouns, never bare years, NAICS digits or numbers inside URL targets.
      const count = new RegExp('(?<![\\w.,-])(?:('+qualifiers+')\\s+)?('+number+')\\s+('+counts+')\\b', 'gi');
      for (const m of searchable.matchAll(count)) add(m[3], Number(m[2]), m[3], m[1] || null);
    }
    // Retain the original pair grammar as a fallback when this paragraph has no fact matches.
    if (!ids.length) {
      const pairPacket = { ...packet, passages: [passage], schema: { fields: [
        { name: 'measure', type: 'string', required: true },
        { name: 'value', type: 'number', required: true },
      ] } };
      for (const r of extractTextRules(pairPacket).records) {
        if (Object.values(r.fields).some(f => f.evidence.some(e => /https?:\/\//i.test(e.quote)))) continue;
        if (records.length >= LIMITS.records) throw new ContractError('record_limit', 'More than 50 suggestions. Paste a smaller section.');
        r.id = 'row-' + (records.length + 1);
        r.fields.unit = { value: null, evidence: [] };
        r.fields.qualifier = { value: null, evidence: [] };
        records.push(r); ids.push(r.id);
      }
    }
    outcomes.push({ passage_id: passage.id, status: ids.length ? 'records' : 'no_result', record_ids: ids,
      reason: ids.length ? 'Suggested explicit rates, count quantities or name/number pairs. Other information in this paragraph may be unrecognized; this is not a complete interpretation.' : 'No supported quantitative relationship was recognized. The text is retained. Add a candidate manually; arbitrary prose understanding is not enabled.' });
  }
  return { version: 'candidates-v1', records, outcomes };
}
