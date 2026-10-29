# Draft paragraph answer key

These expectations were drafted by the assistant and have not been human verified. They cover quantities and selected named relationships, not every possible claim. Fictional cases test controlled failures; five real paragraphs retain Wikipedia attribution, capture timestamps and hashes in the JSON fixture. No cases are automatically approved.

## simple-count

Synthetic example.

> Acme employs 120 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | workers | — |

## grouped-count

Synthetic example.

> Acme employs 1,200 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 1200 | workers | — |

## dated-count

Synthetic example.

> Acme employed 1,200 people in 2025.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 1200 | people | 2025 |

## comparison

Synthetic example.

> Acme employed 1,200 people in 2025, up from 1,000 in 2024.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 1200 | people | 2025 |
| Acme | employment | 1000 | people | 2024 |

## pronoun

Synthetic example.

> Acme opened a branch in 2025. It employs 120 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | workers | — |

## ambiguous-pronoun

Synthetic example.

> Acme partnered with Beta. It employs 120 workers.

No resolved target claim expected.

Unresolved: The pronoun has two possible antecedents.

## revenue

Synthetic example.

> Revenue was $1,234.50.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Revenue | amount | 1234.5 | $ | — |

## scaled-money

Synthetic example.

> Acme reported revenue of $1.2 million in 2025.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | revenue | 1200000 | $ | 2025 |

## percentage

Synthetic example.

> Office occupations accounted for 12.6 percent of local employment.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Office occupations | share of local employment | 12.6 | percent | — |

## percentage-list

Synthetic example.

> Office occupations accounted for 12.6 percent of employment, followed by sales (9.8 percent) and food service (9.4 percent).

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Office occupations | share of employment | 12.6 | percent | — |
| sales | share of employment | 9.8 | percent | — |
| food service | share of employment | 9.4 | percent | — |

## noun-answer

Synthetic example.

> The most viewed article in 2025 was Example One.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| article | most viewed | Example One | — | 2025 |

## capital

Synthetic example.

> The capital of France is Paris.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| France | capital | Paris | — | — |

## winner

Synthetic example.

> The winner of Example Cup was Team Blue.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Example Cup | winner | Team Blue | — | — |

## category

Synthetic example.

> The category of Example One is History.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Example One | category | History | — | — |

## mixed

Synthetic example.

> The capital of France is Paris. Acme employs 1,200 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| France | capital | Paris | — | — |
| Acme | employment | 1200 | workers | — |

## negative

Synthetic example.

> Acme does not employ 120 workers.

No resolved target claim expected.

## correction

Synthetic example.

> Correction: Acme employed 120 people, not 150, in 2025.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | people | 2025 |

## forecast

Synthetic example.

> Acme is projected to employ 150 people in 2027.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | projected employment | 150 | people | 2027 |

## approximate

Synthetic example.

> Revenue was approximately $1,200.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Revenue | approximate amount | 1200 | $ | — |

## range

Synthetic example.

> Acme employs between 100 and 120 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment range | 100–120 | workers | — |

## relative-time

Synthetic example.

> In 2025, Acme expanded. The following year, it employed 120 people.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | people | 2026 |

## heading-context

Synthetic example.

> Acme — 2025
> 
> The company employed 120 people.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | people | 2025 |

## two-subjects

Synthetic example.

> Acme employs 120 workers. Beta employs 80 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | workers | — |
| Beta | employment | 80 | workers | — |

## same-value

Synthetic example.

> Acme employs 120 workers. Beta employs 120 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | workers | — |
| Beta | employment | 120 | workers | — |

## date-not-count

Synthetic example.

> Acme was founded in 2025.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | founding year | 2025 | year | — |

## url-not-count

Synthetic example.

> Read https://example.org/2025/120 for more information.

No resolved target claim expected.

## no-facts

Synthetic example.

> The company is well known for its friendly service.

No resolved target claim expected.

## noun-negation

Synthetic example.

> The capital of France is not Lyon.

No resolved target claim expected.

## wage-list

Synthetic example.

> Higher paying groups included management ($65.97), legal ($54.16), and computer and mathematical ($51.30).

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| management | reported amount | 65.97 | $ | — |
| legal | reported amount | 54.16 | $ | — |
| computer and mathematical | reported amount | 51.3 | $ | — |

## repeated-quote

Synthetic example.

> Acme employs 120 workers.
> 
> Acme employs 120 workers.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Acme | employment | 120 | workers | — |
| Acme | employment | 120 | workers | — |

## wikipedia-paragraph-4

[Wikipedia:Statistics](https://en.wikipedia.org/wiki/Wikipedia:Statistics), captured 2026-10-29T22:03:34.382231+00:00. Wikipedia contributors; CC BY-SA; see source history/licensing.

> As of 2026, there are 838 active Wikimedia projects of a total of 1032.[3] Of these active projects, 331 are Wikipedias and 169 are Wiktionaries. The largest projects are Wikimedia Commons (150,079,879 files)[4] and Wikidata (123,816,139 items).[5]

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Wikimedia projects | active projects | 838 | projects | 2026 |
| Wikimedia projects | total projects | 1032 | projects | 2026 |
| active Wikimedia projects | Wikipedias | 331 | projects | 2026 |
| active Wikimedia projects | Wiktionaries | 169 | projects | 2026 |
| Wikimedia Commons | file count | 150079879 | files | 2026 |
| Wikidata | item count | 123816139 | items | 2026 |

## wikipedia-paragraph-5

[Wikipedia:Statistics](https://en.wikipedia.org/wiki/Wikipedia:Statistics), captured 2026-10-29T22:03:34.382231+00:00. Wikipedia contributors; CC BY-SA; see source history/licensing.

> The largest Wikipedia is the English language edition (7,256,919 articles). It is followed by the Cebuano (6,116,138 articles) and German (3,162,068 articles) editions. The Cebuano Wikipedia uses bots to create most of its articles.

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| English Wikipedia | article count | 7256919 | articles | — |
| Cebuano Wikipedia | article count | 6116138 | articles | — |
| German Wikipedia | article count | 3162068 | articles | — |
| Wikipedia | largest edition | English language edition | — | — |

## wikipedia-paragraph-28

[Wikipedia:Statistics](https://en.wikipedia.org/wiki/Wikipedia:Statistics), captured 2026-10-29T22:03:34.382231+00:00. Wikipedia contributors; CC BY-SA; see source history/licensing.

> In 2025, people from all over the world made 517 million edits to Wikimedia projects.[29] Wikipedia (in all languages) received 172 million edits[30] and the English Wikipedia 62 million edits.[31]

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| Wikimedia projects | edits | 517000000 | edits | 2025 |
| Wikipedia (all languages) | edits | 172000000 | edits | 2025 |
| English Wikipedia | edits | 62000000 | edits | 2025 |

## wikipedia-paragraph-57

[Wikipedia:Statistics](https://en.wikipedia.org/wiki/Wikipedia:Statistics), captured 2026-10-29T22:03:34.382231+00:00. Wikipedia contributors; CC BY-SA; see source history/licensing.

> As of 2026, the English Wikipedia has around 417,000 encyclopedic biographies about women, while having over 1.6 million about men.[58]

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| English Wikipedia | approximate biographies about women | 417000 | biographies | 2026 |
| English Wikipedia | lower bound biographies about men | 1600000 | biographies | 2026 |

## wikipedia-paragraph-59

[Wikipedia:Statistics](https://en.wikipedia.org/wiki/Wikipedia:Statistics), captured 2026-10-29T22:03:34.382231+00:00. Wikipedia contributors; CC BY-SA; see source history/licensing.

> As of 2026, the most active wikiproject (non-related to Wikipedia maintenance) by number of changes to all its pages in the last 365 days is Women in Red.[60]

| Subject | Fact | Answer | Unit | Time |
|---|---|---|---|---|
| wikiproject excluding maintenance | most active by changes in last 365 days | Women in Red | — | 2026 |

