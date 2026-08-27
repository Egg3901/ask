# Changelog

All notable changes to Ask. Newest first.

## 1.3.0 — 2026-08-27

### Added
- Budget & inflation questions ("what's pushing US inflation", "what's the deficit") now answer with the live fiscal breakdown — revenue, spending, debt, credit rating — not the formula.
- "Show my net worth" returns your live wealth snapshot: cash, savings, net worth, and bonds held.
- Legislation questions ("what bills are on the floor") return the live bill list with status, sponsor, and vote tally.
- Estimation questions ("how much would X cost", "how long until Y") now calculate the number from the formula and current values instead of just quoting the formula.
- The "answer with live data" prompt now says what you'll get — "See your live net worth", "See the live fiscal numbers".

## 1.2.2 — 2026-08-27

### Fixed
- More ways of asking about your own wealth ("how rich am I", "am I richer than…", "my holdings") now reach your live figures instead of a generic answer.

## 1.2.1 — 2026-08-27

### Fixed
- Ask now catches itself when it declines a question that live data could have answered, and keeps that answer out of the shared cache.

## 1.2.0 — 2026-08-27

### Added
- Reported and flagged answers now become draft fixes automatically, so recurring wrong answers get corrected faster.

## 1.1.1 — 2026-08-27

### Added
- Automated answer quality checks: a sample of answers is re-read to catch cases where Ask dodged or refused a question it could have answered.

## 1.1.0 — 2026-08-27

### Added
- Player wealth answers: ask "show my net worth" or "how rich am I" and get your live savings, holdings, and rank.
- Public corporation rankings and live analytics datasets behind charts and maps.
- Rich answers: tables for comparisons, headings for multi-part answers, and callouts for the key takeaway.
- This changelog, linked from the sidebar.

### Changed
- Live game data now routes by intent, not keyword guesses, so more questions reach the right data.
- Answers use live evidence when it is present instead of hedging.

### Fixed
- "My" questions resolve to your own character, not world-level totals.
- Charts no longer stand in for questions that wanted a written answer.
