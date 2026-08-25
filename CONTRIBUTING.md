# Contributing

Thanks for taking an interest. Ask is open source under a noncommercial license so
players can read exactly how their questions are answered. Contributions are
welcome; a few things keep the bar where it needs to be.

## Ground rules

- **Never commit secrets or data.** `.env` and `ask.db*` are gitignored for a
  reason — the database contains real player questions. If you add a config value,
  add it to `.env.example` with an empty/placeholder value, never a real one.
- **Grounding is the product.** Any change to retrieval, prompting, or the answer
  path must keep answers tied to evidence. A change that lets the model assert
  things the evidence doesn't support is a regression, even if answers "read"
  better.
- **Live access stays read-only.** The MCP integration must never call a
  state-changing tool. Read-only, quota-limited, in the player's own context.
- **Respect fair play.** Do not add paths that would surface another player's
  private state. Entitlement and context scoping are load-bearing.

## Workflow

1. Open an issue describing the change first for anything non-trivial.
2. Branch, make the change, keep the diff focused.
3. Run the tests: `node --test`. Add tests for new behavior — this repo tests the
   guards (grounding, routing, answer-guard, store) heavily; match that.
4. Open a PR with a short, plain description of *what* changed and *why*. No
   generated changelogs, no filler.

## Style

- CommonJS, Node 20+, no build step. Match the surrounding code's density and
  naming; the files are terse and comment the *why*, not the *what*.
- Keep user-facing copy plain. No dramatics, no em/en dashes.
- New endpoints: validate input, cap body size, fail closed on auth, `no-store`
  on anything per-user.

## Reporting bugs

Bugs and security issues: see [SECURITY.md](SECURITY.md). Include reproduction
steps, the affected file, and expected vs actual behavior. For grounding failures,
paste the question and the wrong claim — that is what we act on.
