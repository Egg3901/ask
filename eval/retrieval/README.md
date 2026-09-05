# Retrieval evaluation harness

Offline, reproducible scoring of `retrieve.js` against a labelled gold set. Every retrieval change (fusion rewrite, chunking, weights, budgets) is judged here before it ships.

## The snapshot

Retrieval runs against a fixed copy of the production index, never the live file (which `rag-reindex.timer` rewrites every 15 minutes):

| | |
|---|---|
| file | `/root/misc/ask-remediation/eval/index-v2.snapshot.db` (read-only, journal_mode DELETE, no -wal/-shm) |
| sha256 | `196ecbfdcc044798fe63ab3c9663b92ea7872a81a138e7db22576ea12ae5096c` |
| taken | 2026-09-05 05:27 UTC via `sqlite3 .backup` from `index-v2.db` (generation `6aac9727`, published 2026-09-05T05:21:47Z) |
| contents | 21,473 chunks: code 20,756 (AHDGame `107fc7b01`), docs 343 (ahd-docs `05cafde98`), wiki 374 |

Every gold file and every results file records this hash. `run.mjs` warns when the index it is pointed at does not match the gold set's hash. The gold labels are keyed by `path#ord` with a sidecar (`gold/qrels.sidecar.jsonl`) carrying the chunk `hash` (sha1 of the full chunk text) and `bodySha1` (sha1 of the text after the `[kind] path (part N/M)` header), so a re-chunked index can be re-matched or re-adjudicated instead of silently mis-scored.

## Layout

```
eval/retrieval/
  run.mjs            score one config over the gold set -> results/<label>.json + .run (TREC)
  compare.mjs        paired t-test + permutation test between two result files
  noise.mjs          variance across repeated runs of one config
  build-gold.mjs     gold set pipeline (pool, synth, candidates, adjudicate, finalize, status)
  configs.json       named configs: flash, deep, dense, bm25
  metrics.test.js    hand-computed fixtures for every metric (node --test)
  stats.test.js      closed-form checks for the t-test, CI and permutation test
  lib/               db, metrics, trec, stats, split, muse (LLM lane), curation
  gold/              queries.jsonl, qrels.txt, qrels.sidecar.jsonl, summary.json, authored.json
  cache/             LLM verdict cache, synthetic batches, call ledger (committed: reruns are free)
  results/           committed baselines
```

Candidate pools (`$RAG_EVAL_POOLS`, default `/root/misc/ask-remediation/eval/pools/`) are derived from the snapshot and are not committed.

## Running

```
# tests for the metric and statistics code
node --test --test-concurrency=1 eval/retrieval/metrics.test.js eval/retrieval/stats.test.js

# score a named config on the dev split
node eval/retrieval/run.mjs --config flash --label my-change-flash
node eval/retrieval/run.mjs --config flash --env RAG_FUSION=v2 --label fusion-v2-flash

# compare against the committed baseline
node eval/retrieval/compare.mjs eval/retrieval/results/baseline-2026-09-05-flash.json eval/retrieval/results/fusion-v2-flash.json

# noise floor
node eval/retrieval/noise.mjs results/baseline-2026-09-05-flash.json results/noise-flash-r2.json results/noise-flash-r3.json
```

`run.mjs` applies the config's env (`RAG_TOP_K`, `RAG_MAX_CHARS`, anything passed with `--env`) to `process.env` before it loads `retrieve.js`, points `RAG_DB` at the snapshot, and drives retrieval only through `search()` / `searchMulti()` (used when a query carries stored `subQueries`; none do today because production never persisted them). The `dense` and `bm25` configs use `retrieve.__debug.isolated()`, the one addition made to `retrieve.js`: it returns the dense-only and BM25-only candidate lists computed with the production weights and FTS expressions, and `retrieve.__debug.finish()` runs them through the production budget logic. Nothing on the answer path calls it.

`--fast` derives the delivered list by running the production `finish()` over the ranked hits instead of a second `search()` call (the embedder is the bottleneck on a loaded box). The two are identical by construction and the first 12 queries of every `--fast` run execute both paths and abort on any difference. `retrieve.js` returns null when the embedder fails; the runner retries four times and then records the query as an error excluded from every metric (`errors` in the result file), never as a miss.

Use `--split heldout` only to confirm a change that was tuned on dev. **heldout is never used for tuning.** The split is 70/30, stratified by (real vs synthetic, kind), fixed by a salted hash of the query id (`lib/split.js`).

## Metrics

Per query, retrieval is called twice: once with `topK: 32, maxChars: 1e9` to get the **ranked** list (after the 2-per-file cap, before the char budget), and once with the config's own env to get the **delivered** list (what production would actually send the model). `finish()` drops a chunk that does not fit the budget with `continue`, so a chunk can be ranked 2nd and never be delivered.

| metric | meaning |
|---|---|
| Recall@K (4, 8, 16, 32) | share of judged relevant chunks (grade >= 1) in the top K of the ranked list. Positional: unjudged chunks earn nothing. |
| Success@1 | 1 if the top ranked chunk is relevant. |
| MRR | 1 / rank of the first relevant chunk in the ranked list, 0 if none in 32. |
| nDCG@10 | **condensed-list** form: unjudged chunks are removed from the ranking before scoring, so a retriever that surfaces new material is never scored as if it were wrong. Gains 2^g - 1, log2 discount, ideal from all judged grades. |
| Recall@budget | recall over the delivered list only. This is what the model saw. |
| truncation_loss | Recall@16 (ranked) minus Recall@budget. |
| budget_loss | Recall@configK minus Recall@budget: the budget's own effect, with the K cut removed. |
| recall@8_strict, recall@budget_strict | the same with grade 2 only. |
| unjudged@8 | share of the top 8 the pool never graded. If a change moves this, re-adjudicate before believing its rank metrics. |

Reported overall, by query source (real vs synthetic), by query kind, and at doc level by the gold chunk's `source_kind` and length bucket (`s<800`, `m800-2000`, `l2000-4000`, `xl4000+` chars: the embedder truncates at about 2048 tokens, so the long buckets are where a chunking change will show). Queries with no judged relevant chunk are excluded from rank metrics and counted in `gold.noRelevant`.

Metric implementations are validated by `metrics.test.js` (10 fixtures including score ties, unjudged docs, judged non-relevant docs, docs beyond the nDCG cutoff, duplicate deliveries) and `stats.test.js` (exact p-values at df=1 and df=2, quantiles, permutation null).

## Gold set

`gold/queries.jsonl` has one line per query: `qid`, `text`, `kind`, `source`, `split`, `judged`, `relevant`, and for synthetic queries the `origin` chunk. `gold/qrels.txt` is TREC format (`qid 0 docid grade`), grade 0 lines are judged non-relevant and are what makes the condensed list work.

Kinds: `symbol` (asks by identifier), `mechanic` (one rule or number), `causal` (systems interacting), `navigation` (where to click), `live` (needs live state or a chart; retrieval is secondary), `meta` (about Ask, changelog, opinion).

Composition (built 2026-09-05, `gold/summary.json`):

| | queries | dev / heldout | kinds |
|---|---|---|---|
| real, pool-adjudicated | 272 | 191 / 81 | mechanic 110, live 71, causal 41, navigation 22, symbol 17, meta 11 |
| synthetic | 142 | 100 / 42 | mechanic 75, causal 37, navigation 23, symbol 7; origin chunks code 77, wiki 36, docs 29 |

Real queries come from: the local historical `ask.db` (154 after curation; phrasing only, anonymised, skip list and kinds in `lib/curation.js`), the production downvote replay feed (26), `eval/reported-failures.json`, `eval/general-replay-cases.json`, `eval/corpus-candidates.json`, `eval/ticket-1234-cases.json` (13 not already covered), and 79 hand-written questions in `gold/authored.json`. Each was **pool-adjudicated**: the union of dense-only, BM25-only and hybrid candidates at k=50 each (94 candidates per query on average, 8,936 distinct chunks in total) was graded 0/1/2 in one listwise LLM call per query, candidates shuffled, each shown as path plus an excerpt. Verdicts are cached by (query hash, chunk hash) in `cache/verdicts.jsonl`, one line per query, grade 0 stored explicitly. Result: 25,826 judged pairs, 5.0 relevant chunks per real query on average, 20 real queries with no relevant chunk in any pool (opinion and "most interesting map" style questions, plus a few true misses; they are excluded from rank metrics and counted in `gold.noRelevant`).

Excerpt rule (`EXCERPT_VERSION` 2 in `build-gold.mjs`): the first 400 chars of the chunk, except when the question names a code identifier (a CONSTANT_NAME or camelCase function), in which case the header plus a 320-char window around the identifier's first occurrence is shown. Version 1 showed only the first 400 chars and graded the defining constants chunk 0 for two symbol queries because the definition sat further down the file; the 16 identifier queries were regraded with `--regrade ids`. Questions without identifiers see the same excerpt under both versions, so their verdicts were kept.

Synthetic queries: 200 chunks sampled stratified by source kind and length bucket (tests, fixtures, data tables, region images and typings excluded; `cache/synth-sample.json`), the LLM wrote one player question per chunk in batches of six and returned null for 58 unusable chunks, and the originating chunk is the single gold positive. Other relevant chunks are unjudged for these queries, so read real and synthetic separately.

LLM lane: `muse exec` on the owner's subscription (`muse-spark-1.3-contributor`, minimal effort). Every call is appended to `cache/llm-calls.jsonl`: **322 calls total** (34 synthetic, 272 adjudication, 16 regrade), 0 failures, 0 retries, 3 to 20 s each.

<!-- BASELINE -->
