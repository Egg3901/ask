# Changelog

All notable changes to Ask. Newest first.

## 1.5.2 - 2026-08-28

### Added
- War questions now get real answers. Who is at war, which countries are on each side, who holds how much of the front, the latest battle verdicts with casualties, the wider campaigns like Vietnam and Berlin, and the cold-war tension meter all come from the live public record.
- Trend questions about a state or region ("how has unemployment in California changed", "is poverty in Lazio improving") now answer from the recorded turn-by-turn history instead of just the current number.

### What stays unanswered, on purpose
- Army strength rankings and force composition. The game shows commanders coarse bands ("stronger force", "evenly matched"), never numbers, and Ask sees exactly what a non-belligerent player sees. Ask will now say that instead of guessing.

## 1.5.1 - 2026-08-27

### Added
- Ask will now suggest which corporations are worth buying. It reads the live public exchange, names the companies and the figures behind each one, and says plainly that markets move. It used to decline this as "investment advice", which made no sense: these are fictional companies and every number it uses is already on the stock market page you can open yourself.

### Changed
- Buy and investment questions now pull the live exchange rankings instead of explaining how to read the stock list.

Planning trades to damage a specific player is still off the table, as is anything using non-public figures.

## 1.5.0 - 2026-08-27

### Fixed
- Ask no longer tells you what it was handed instead of answering your question. It used to say things like "the supplied source does not include that" even when it had already looked up the live data, which read as a refusal on questions it could answer.
- Rankings, counts, distributions and candidate maps now work. Asking for the ten largest public companies, active player counts by country, or a map of Senate candidates used to get "that data isn't available"; the data was always there.
- Corporation names now resolve the way you type them. "Tinky corp", "meyer corp" and misspellings all find the right company instead of "could not be found". When two companies genuinely match, Ask asks which one you meant rather than guessing.
- "Where do I find it" questions are answered from the game's real menus, with the real labels, instead of a guess at what a button might be called.
- Answers no longer cut off mid-sentence.
- A chart is only shown when it is about what you asked. A chart of something else could previously appear above an answer.
- Figures about a person or company now say whose they are, so a wrong lookup is obvious rather than silent.
- Ask no longer states what is true in the world today based on how the world started. It used to say a tied state senate was impossible while one was tied.
- When you ask for a number, you get the number, not the formula for it.

### Known gaps
- Questions about active wars and military strength still cannot be answered. That data has no read-only lookup yet.

## 1.4.2 - 2026-08-27

### Changed
- Removed the answer-model picker. Ask now always routes each question automatically, degrading through free capacity before paid, so answers stay fast without anyone having to pick a backend.
- The answer header shows just the model that answered, without the duplicate tier badge next to it.

## 1.4.1 - 2026-08-27

### Changed
- The A House Divided logo is now the site's mark: browser tab icon, header, landing page, and shared pages.
- A visual refresh across the app: subtle depth and grain instead of flat black, gradient hairlines on the composer and dialogs, questions styled as headlines, and a more dimensional send button.
- Light mode fixes: the loading shimmer is now visible and card shadows render correctly.

## 1.4.0 - 2026-08-27

### Added
- Reporting an answer now opens a proper form with reason choices instead of a browser popup, on the app and on shared pages.
- Conversation history is grouped by day: Today, Yesterday, Previous 7 days, and older.
- A "Jump to latest" button appears when you scroll up during a long answer.
- The send button becomes a stop button while an answer is generating.
- A character counter appears as a question approaches the 500-character limit.
- Ask has a browser tab icon, and the tab title follows the conversation you are reading.

### Changed
- Deleting a conversation now asks for a confirming second tap, so a stray click never loses a thread.

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
