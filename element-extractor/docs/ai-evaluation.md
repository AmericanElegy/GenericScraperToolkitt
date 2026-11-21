# Personal AI comparison — November 21, 2026

Five tasks were evaluated through independent evidence/review validation. Three structured tables use frozen reference snapshots; two tasks use the private chemistry Word document. No records were automatically approved.

| Task | GPT-5 mini exact rows | Claude Haiku 4.5 exact rows |
| --- | --- | --- |
| Simple company table | 6/6 | 6/6 |
| Wikipedia comparison | 18/18 | 18/18 |
| BLS occupational groups | 23/23 | 23/23 |
| Chemistry materials | 12/12 | 12/12 |
| Chemistry quantities/time | 1/4 | 4/4 |

Both providers had zero independent evidence errors. OpenAI captured all four numeric chemistry facts, but included quantity/imperative wording in three subject labels. Those remain exact-output failures. Claude performed better on this small sample; broader accuracy is unproven.

Models: `gpt-5-mini-2025-08-07` and `claude-haiku-4-5-20251001`. Successful usage estimates total **$0.13445275**. Including full reservations for two failed schema requests, the conservative ledger totals **$0.35473435 of $5** across 12 attempts. This is not invoice reconciliation. No automatic retries were used. Claude schema complexity required a simpler field-array response with deterministic conversion; original responses remain retained. Empty outcome explanations receive explicit missing-explanation notices. Grouped numeric validation was corrected and cached responses revalidated without another paid call.

References: [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5-mini), [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Claude model](https://platform.claude.com/docs/en/models/haiku-4-5/overview), [Claude structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Use saved proposals

Open a source in the workbench, expand **Open a locally generated AI proposal**, and choose a `*-proposal.json` from ignored `.wrangler/ai-evaluation/`. Inspect evidence and associations, correct, approve and download. Save the full-source backup first: proposals contain selected text, not original images or the complete document.

The hosted page makes no paid call and receives no provider keys. Local adapters read process variables or ignored `.dev.vars`. They reserve against a shared persistent cap before sending, retain uncertain reservations, lock concurrent requests and cache outputs. Sources are untrusted input; their instructions cannot approve records or mark coverage checked.

The comparison is complete. Do not run additional paid requests without new authorization. Private results, timing, usage, raw responses, proposals and budget receipts remain under `.wrangler/ai-evaluation/`. Hosted one-click generation, OCR and image interpretation remain future choices.
