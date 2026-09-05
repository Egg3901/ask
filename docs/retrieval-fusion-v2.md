# Retrieval fusion v2

`retrieve.js` runs two retrievers over the chunk index for every question: a
dense pass (query embedding against the in-memory vector matrix) and a lexical
pass (FTS5 with BM25). How their results are combined is selectable per
process or per call so the two behaviours can be A/B tested against each
other on the same index.

## Modes

| `RAG_FUSION` | Behaviour |
|---|---|
| unset (default) | Legacy fusion, byte-for-byte what shipped before the switch existed. |
| `v2` | The fusion described below. |

A call can override the environment with `{ fusion: "legacy" | "v2" }` in the
options of `search()` or `searchMulti()`. The public contract is identical in
both modes: the same signatures, the same `{ context, files, count, hits,
claimType }` result, the same `hits[]` entry shape.

`eval/fusion-legacy-hits.json` pins the legacy output for ten questions
(hit order, scores, files, count, claim type, a hash of the assembled
context). `retrieve-fusion-parity.test.js` replays them with the switch unset
and fails on any difference. The capture is tied to the index revisions it was
made against, so on another index it skips; regenerate it with
`RAG_FUSION_FIXTURE_UPDATE=1` once legacy parity is otherwise known.

## Legacy

- Dense score is `cosine * authority`, top 200 kept.
- The lexical pass runs FTS5 twice (exact identifiers, then rare words),
  orders by BM25, then throws the BM25 value away: every identifier hit gets a
  flat 1.5, every word hit a flat 0.92. The best lexical hit and the eighth
  score the same.
- A chunk both passes found gets `+0.35` on top of its dense score. The two
  scales are never normalised, so that constant means different things on
  different questions.
- Sub-queries (`searchMulti`) merge by MAX score per chunk. One sub-query's
  hits can fill the whole budget, and a chunk that several sub-queries agree
  on gets no credit for the agreement.
- Diversity is a flat cap of two chunks per file. Adjacent chunks of one file
  overlap by 400 characters and both are sent in full.

## v2

1. **Per-query normalisation.** Both candidate lists keep their raw scores
   (cosine; BM25 from FTS5, negated so higher is better). Each list is min-max
   normalised to [0, 1] within the query. A chunk missing from one list
   contributes 0 on that side. A flat list (one candidate, or all tied)
   scores 1: being found counts.
2. **Weighted CombSUM under authority.**
   `score = authority * (w_dense * dense_n + w_lexical * lexical_n)`.
   A chunk both retrievers found gets both terms; that is the dual-hit bonus,
   and it is proportional instead of a constant. The `AUTHORITY` table by
   claim type (code / docs / wiki) is unchanged and stays a multiplier, which
   is why this is min-max fusion and not RRF: rank fusion would erase it.
3. **Identifier routing.** If the question contains an identifier-shaped
   token (`ALL_CAPS_WITH_UNDERSCORES`, `camelCase`, `a/path/like/this.ts`)
   the lexical side gets the larger weight. Plain acronyms such as GDP do not
   qualify. A regex, no model.
4. **Exact-identifier floor.** A chunk found by the exact-identifier FTS pass
   never ranks below the top-5 window. The window holds the best five exact
   hits plus the best remaining candidates in score order; anything after it
   keeps score order. More than five exact hits compete normally for the rest.
5. **Sub-query merge by RRF.** `searchMulti` fuses the per-query ranked lists
   with reciprocal rank fusion (`1 / (k + rank)`, k = 60), rescaled so the best
   chunk scores 1, then re-applies the floor. Consensus across sub-queries now
   counts.
6. **Selection is a priority ladder, not a sort.** Chunks are around 6000
   characters and the default window is 22000, so the character budget binds
   on almost every question and walk order decides what the model reads:
   1. exact identifier hits inside the floor window;
   2. one chunk per query, question first: each sub-query contributes a chunk
      before any contributes a second (a chunk counts for a query when it is
      in that query's top three; looser membership let a consensus chunk
      ranked ninth by a sub-query stand in for its own best hit);
   3. greedy MMR over the fused shortlist for the remaining slots, using the
      chunk vectors already in memory: `lambda * relevance - (1 - lambda) *
      max similarity to anything already picked`.
   The budget walk itself is unchanged: a chunk that does not fit is skipped,
   not a stop, so one oversized chunk cannot drop every smaller one behind it.
7. **Overlap dedupe.** When adjacent chunks of one file are both sent, the
   400-character span they share is cut from whichever block the model reads
   second. The header line the chunker prefixes to each chunk is kept.
   `hits[].text` is the trimmed body, so attribution measures what was sent.

## Knobs

All read per call, so a harness can sweep them without reloading the module.

| Variable | Default | Meaning |
|---|---|---|
| `RAG_FUSION` | unset | `v2` selects the fusion above. |
| `RAG_FUSION_DENSE_W` | `0.6` | Dense weight; lexical is `1 - dense`. |
| `RAG_FUSION_DENSE_W_IDENT` | `0.4` | Dense weight when the question is identifier-shaped. |
| `RAG_FUSION_RRF_K` | `60` | RRF constant for the sub-query merge. |
| `RAG_FUSION_MMR_LAMBDA` | `0.7` | MMR relevance weight; `1` is plain relevance order. |
| `RAG_FUSION_LEX_LIMIT` | `24` | Rows kept from the rare-word FTS pass (legacy keeps 8). Identifier passes keep 5 each. |

## Debug surface

`retrieve.__debug.candidates(question, { claimType, game, fusion })` returns
the per-retriever lists for one question in whichever mode is active:

```
{ mode, claimType, weights, dense: [...], lexical: [...], fused: [...] }
```

Each entry carries `path`, `ord`, `source` and `score`. In v2 the dense list
also carries `cosine` and `authority`, the lexical list `bm25` and `exact`,
and the fused list `dense`, `lexical`, `authority` and `exact`. In legacy
mode `score` is the weighted cosine, the flat boost, or the fused score
respectively. It is a read-only addition; nothing else changes.

## What to watch in the A/B

- Authority under normalisation. Min-max stretches the dense candidates over
  [0, 1], so the same 1.30 / 0.72 code-to-wiki ratio moves ranks less than it
  did on raw cosines, where the top 200 sit within a few tenths of each
  other. If wiki prose starts crowding code out of mechanics answers, the
  multiplier table is where to compensate.
- Wider lexical pool. Normalising over 24 rows instead of 8 gives the top
  lexical hits more headroom and lets lexical-only chunks into the pool that
  legacy never saw.
- `hits` order is the walk order (the priority ladder), not descending score.
  The `relevance` labels in the context are informational either way.
