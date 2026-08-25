# Ask

A grounded question-and-answer service for a live game. Players ask questions in
natural language; Ask answers them from the game's own source code, engineering
docs, and player wiki — with citations, honest "the code doesn't show this" notes,
and optional live game-state lookups.

It is deliberately **not** a general chatbot. Every answer is retrieved against a
real evidence set and checked before it reaches the player.

## What it does

- **Grounded retrieval.** Questions are embedded and matched against indexed
  source, docs, and wiki. The answer model only sees retrieved evidence, and a
  second cheap model flags claims the evidence does not support.
- **Tiered routing.** A router picks a model chain (flash / pro / deep) from the
  question's shape. Cheap lookups stay cheap; multi-system questions get a wider
  evidence window and an agentic scout pass.
- **Live game state, read-only.** When a question is about *current* state ("why
  is my inflation so high"), Ask can call read-only game-state MCP tools. This is
  quota-limited and never writes.
- **Fair-play boundaries.** Answers are scoped to what a player is allowed to see.
  Live lookups run in the player's own context.
- **Citations, conflicts, corrections.** Answers cite their sources, record where
  docs disagree with code (a work queue for stale docs), and carry a staff-curated
  correction memory that is injected when a similar question returns.
- **Shareable transcripts & reports.** Conversations and generated reports get an
  unguessable, revocable share link. The token is the permission; nothing else.

## Architecture

Ask holds **no database of identities and no JWT secret**. It composes two
loopback services:

1. an **identity broker** — resolves an opaque session cookie to *who you are*;
2. an **ops/entitlement service** — resolves *what you're entitled to* (tier, role).

Local state (conversation history, quota accounting, answer cache, corrections,
reports) lives in a single SQLite file. Everything user-facing streams over
Server-Sent Events.

```
browser ──cookie──▶ ask ──▶ identity broker      (who)
                       └──▶ ops/entitlement       (tier/role)
                       └──▶ retrieval index       (code/docs/wiki evidence)
                       └──▶ read-only MCP tools   (live game state)
                       └──▶ LLM providers         (answer + grounding check)
```

### Key modules

| File | Responsibility |
|---|---|
| `server.js` | HTTP surface, routing, SSE streaming, quota gate |
| `auth.js` | session → identity → entitlement; tier budgets |
| `store.js` | SQLite: quota, history, cache, sharing, reports |
| `router.js` / `models.js` | model-chain selection and the scored registry |
| `retrieve.js` | grounded retrieval over the evidence set |
| `grounding.js` | claim-support check, path-invention check, query decompose |
| `mcp.js` / `live-intelligence.js` / `investigate.js` | read-only live-state passes |
| `prompt.js` | system-prompt assembly, styles/lengths |
| `answer-guard.js` / `visualization.js` / `map-visualization.js` | output guards and charts |
| `corrections.js` / `citations.js` | correction memory and citation resolution |
| `page.js` | server-rendered UI |

## Running locally

Requires Node 20+.

```bash
npm install
cp .env.example .env   # fill in broker URLs, MCP token, LLM keys
node server.js
```

The server binds `127.0.0.1` and is intended to sit behind a reverse proxy that
terminates TLS. It boots with a self-check that fails loudly if the rendered
client script is malformed.

### Tests

```bash
node --test
```

Two retrieval tests need a pre-built index (a `source_revisions` table) and are
skipped/red without one; the rest run standalone.

## Security & privacy

- `.env` and `ask.db*` are gitignored and must never be committed — the DB holds
  player questions.
- All state-changing endpoints require a signed-in, entitled session; machine
  callers use a constant-time-compared shared secret.
- Live game-state access is strictly read-only and quota-limited.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). You may use, study, and modify this
for noncommercial purposes. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request.
