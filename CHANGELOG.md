# Changelog

All notable changes to Ask. Newest first.

## 1.18.0 - 2026-09-05

### Changed
- Ask no longer reads your answer for military-sounding words. Fog of war is enforced where it can actually be enforced: a request for a live roster is refused before anything is generated, and the tool that returns a roster is never offered to a public session, so a public answer cannot contain live force data whatever its wording. The word-matching pass that sat between those two refused six mechanics answers in a single day, over a table cell that began "No", a "Power" column, and the sentence "Repair is 12 per turn in port". It is gone.
- The one delivery check that remains is a fact about the run rather than a guess about the prose: if an answer for a public asker somehow read a moderator-only tool, it is withheld.

## 1.17.5 - 2026-09-05

### Fixed
- The roster guard now looks for a holder, not for a sentence shape. Two more rules answers were refused for saying "Repair is 12 per turn in port" and "Badly damaged (below 35 integrity) heads to PORT": a number near a military word plus any capitalized word was enough. What marks force intelligence is a country, a demonym, a country code, a possessive, a name that owns or operates something, or a name that is missing or short of one. Everything else is rules and gets answered.

## 1.17.4 - 2026-09-05

### Fixed
- Two more ways a rules answer was being read as force intelligence: a sentence opening on an ordinary capitalized word followed by "is" ("Repair is 12 per turn in port") counted as a country acting, and a table with a "Power" column counted as a table of great powers. Possession marks a holder, a copula does not, and a stat column is not a country. A named force-state claim ("Northland is at 43% readiness") still refuses.

## 1.17.3 - 2026-09-05

### Fixed
- A question about a set now reads widely enough to cover the set. On the default evidence window the search landed in one file and the answer covered whatever that file happened to be about: asked three times what every naval vessel does, Ask returned the hull table, then the repair rules, then the approval model. Coverage questions get the wide window that deep answers get.

## 1.17.2 - 2026-09-05

### Fixed
- A moderator asking for a country's live roster gets the roster. Force composition is the one thing that cannot be reconstructed from the code, so for a staff session it is read directly for every country the question names rather than left to the research model's tool choice.

## 1.17.1 - 2026-09-05

### Fixed
- A moderator asking for a live roster now gets one. The private tools were offered to staff sessions but carried no line in the research playbook, so the scout never reached for them: the answer came back "no roster is visible" while holding the tool that returns it. Every tool a staff session is offered now says when to use it, and a test keeps that true for tools added later.

## 1.17.0 - 2026-09-05

### Added
- Moderators and admins get their moderator access in Discord, not only on the web. The role is read from the game account linked to the Discord id, so the same person gets the same answer on both surfaces, and the fog-of-war guard steps aside for staff as it always has in the browser.
- Answers produced with moderator access are marked as such in the response, so the bot can deliver them privately. Until it does, a staff answer in a channel is visible to that channel.

## 1.16.0 - 2026-09-05

### Changed
- A question that asks for a set gets an answer that covers the set. "Go over each one", "what do the different types of X do", "A vs B vs C" and "list all the ways..." now route to the stronger model and use the long-answer target instead of the standard 220 words, so the answer stops naming two members and moving on. Asking for a concise answer still gets one.
- Every answer is told that the word target is a guide and not a cap: cover everything the question asked about, give each item less room rather than dropping any, and never stop partway through a list.

### Fixed
- A capability table is no longer read as an order of battle. Cells that began "No" and "Kills" were being treated as country names, which refused a naval answer that was pure rules. What marks a roster is the header (country, nation, player, side), a possessive, a country code, or a claim about the live world, and that is now what the guard looks for.

## 1.15.3 - 2026-09-05

### Fixed
- A rules table no longer reads as somebody's order of battle. An answer listing what each ship type costs in berths ("Carrier Strike Group | 3") was being replaced by the roster refusal, because a capitalized unit-type name next to a number looked like a country next to a force count. The guard now looks for the attribution instead of the capital letter: a name that acts ("Northland maintains"), owns ("Northland's fleet"), or qualifies a force ("the German army"), a country code, or a claim about the live world.
- Markdown tables are judged whole rather than line by line, so a header that names the asset still counts against the rows underneath it.

## 1.15.2 - 2026-09-05

### Fixed
- Questions about how a class of military asset works are answered instead of refused. "What is the benefit of aircraft carriers vs screening ships and submarines?", "what do the different types of ships do for navies?" and "how do army logistics work?" are rules questions: they name no country and ask for nothing live, so the answer is mechanics, not somebody's roster. The guard was reading any sentence that put a number next to a ship or a unit as force intelligence.
- Ship and airframe classes (carriers, destroyers, cruisers, frigates, battleships, corvettes, bombers, fighters) are now part of what the guard actually recognizes, so a real roster line about them is caught where it was previously invisible.
- Naming a country still stops an answer: a live count, a country code, or "currently" alongside a named force is refused whatever the question was.

## 1.15.1 - 2026-09-05

### Fixed
- Questions phrased as "does X have Y" are answered again. The guard that keeps live military rosters out of public answers was matching that phrasing on its own, with no military asset needed, so "does declaring war have a stability cost?", "does the Senate have a filibuster?" and "are corporations able to operate overseas?" all came back as a privacy refusal instead of an answer. The guard now needs an actual military asset in the question, and words that are also civilian (units, equipment, personnel, ships) only count when the question is about the military.
- War is an ordinary subject: how wars start, how battles resolve, supply, war weariness, the cost of declaring, what happens at peace, and the public record of who fought whom. Only live force composition, readiness and deployments stay fog of war.

## 1.15.0 - 2026-08-31

### Added
- Flagged answers are free: when a quality check finds problems with an answer, on the spot or in a later audit, the question is credited back to your daily allowance. Inline flags say so under the answer; later discoveries (a failed grounding audit, a staff correction, the answer sampler) also notify you in-game with a link back to Ask.
- Watch alerts now arrive as in-game notifications too, not only with your next answer.

## 1.14.0 - 2026-08-31

### Added
- Watchlists: tell Ask to watch public game state and it alerts you with your next answer. "Watch USD/GBP and tell me when it crosses above 0.5", "let me know when there are new battles involving the US", or "watch for new US bills". Creating, listing ("my watches"), and deleting ("delete watch #3") are instant and free; checks run about every ten minutes. Five watches per player, twenty for staff.

## 1.13.0 - 2026-08-31

### Added
- The research scout now carries a tool playbook: one line per tool saying when to reach for it and the trap that burns people, so tool choice no longer depends on inferring judgment from bare schemas.
- Bar charts for categorical comparisons: datasets comparing entities on one metric now chart as bars instead of falling back to tables, and single-series datasets keyed by their metric name chart correctly.
- Groundwork for a community evidence tier (player Discord discussion as lowest-authority supplemental evidence), dark until its data source is configured.

### Added
- How I researched this: the research phases and tool calls Ask streams while it works are now kept, and every finished answer carries a collapsed timeline of those steps above its sources.
- Per-sentence citation marks: when Ask can match a sentence to a source it actually read, that sentence gets a small superscript number. Tapping it opens the sources panel and highlights the file behind the claim.
- An evidence drawer in the answer footer sums up everything an answer read, files and live game data together, in one compact row.
- A grounding chip next to the model name shows what share of an answer's sentences were matched to the sources it read.

### Changed
- Tables are easier to scan: large raw numbers get thousands separators, and cells that lead with a signed percentage get an up or down marker.
## 1.12.0 - 2026-08-31

### Added
- A sufficient-context gate on the reasoning tiers: before writing, a cheap audit names what the gathered evidence does not contain, and the answer is directed to say so plainly instead of improvising. Flagged answers never enter the shared cache.
- Per-sentence answer attribution: every prose sentence is scored against the exact evidence chunks the model read, deterministically, with live-data blocks counted so live answers are not miscounted as unsupported. Coverage lands in telemetry and the console; fast-tier answers with very low coverage get an honest support note.

## 1.11.1 - 2026-08-31

### Fixed
- Reporting an answer from Discord now has real consequences: the report seeds a staff-review correction draft and evicts every cached variant of that question, exactly like a web report. Previously the Discord confirmation message claimed the issue was queued for review while nothing read it.
- Web and shared-page reports now also evict the reported answer from the shared cache, so a wrong cached answer stops being served the moment someone reports it.

## 1.11.0 - 2026-08-31

### Added
- Ask now acts on its own quality checks instead of only reporting them. When a draft cites a real source file that retrieval never supplied, Ask reads that file and corrects the answer against its actual contents before delivery. When the grounding audit flags an unsupported mechanic claim on the reasoning tiers, Ask rewrites the answer without it and re-audits, keeping the caveat only when the rewrite cannot be verified.
- Questions whose evidence comes back thin, or where the research pass reports a key fact it could not establish, are escalated from the fast tier to the reasoning tier before the answer is written.
- The research scout has an exact calculator for every derived number: growth rates, shares, differences, and per-capita figures are now computed, not predicted.
- Distilled investigation playbooks steer both the research pass and the writer on question classes with known traps: wealth trends, regional economic series, market shares and their denominators, war status under fog of war, disputed elections, causal economy questions, and exchange rates.
- Answers that stop mid-sentence, describe their own evidence instead of answering, or cite files they never read now trigger the repair pass that previously only caught refusals.

### Changed
- The research scout gets a budget matched to the question tier, no longer re-searches files primary retrieval already supplied, and always completes at least one investigation round.
- Exact-symbol search misses now count as strong negative evidence alongside semantic misses.

### Fixed
- Long questions from Discord are trimmed at a word boundary instead of being rejected outright.

## 1.10.1 - 2026-08-31

### Changed
- The composer now puts its answer modes inside one quieter input surface, with a brief explanation that updates when Ask, Verify, Autopsy, or Scenario is selected.
- The question library opens on Ask tools, so the new specialist test questions are visible immediately.

### Fixed
- Question-library categories now occupy their own row above a separate scrolling question list, preventing the category labels from being clipped on mobile.

## 1.10.0 - 2026-08-31

### Added
- The composer now has visible Ask, Verify, Autopsy, and Scenario modes. A selected specialist mode is sent as an explicit request contract, so players do not need to know magic prompt wording.
- The question library has an Ask tools category with strong test questions for claim verification, causal analysis, live corporation diagnosis, and bounded economy scenarios.
- Nine anonymized player-reported failures now run as a permanent replay suite, covering wealth history, military privacy, logistics, National Influence, blockade help, and clean topic pivots.

### Fixed
- Question-library categories now stay visible while the samples scroll, use stronger contrast, and scroll horizontally on narrow mobile screens.
- Wrapped changelog bullets now keep their continuation lines instead of ending in the middle of a sentence.
- Requests for current military rosters now receive the fair-play refusal before streaming, without falsely claiming that a country has no roster.
- A complete short navigation question that names its mechanic, such as where to select Blockade, no longer inherits an unrelated previous answer.
- Army logistics recognizes questions about overextension and answers logistics-unit examples directly. The head-of-government National Influence answer now includes the 2.5 per-turn position bonus and its non-stacking rule.

## 1.9.0 - 2026-08-31

### Added
- Ask now understands army logistics as its own mechanic, including front
  throughput, formation demand, overextension, supply bands, combat effects,
  and what a Logistics Command does and does not control.
- Claim Verifier checks a previous answer claim by claim and labels each point
  supported, contradicted, or unresolved before giving a corrected answer.
- Causal Autopsy traces a reported outcome across live state, game rules, and
  recently shipped changes, including alternatives the evidence rules out.
- Scenario Lab runs bounded, read-only economy projections against live prices.
  It reports the intervention, horizon, outcome, and a clear warning that the
  result is directional rather than the canonical turn engine.

### Fixed
- A complete new question in an existing conversation is now treated as a topic
  pivot. Old mechanics are inherited only by questions that actually refer back
  to the previous turn, preventing an army-logistics question from receiving a
  close-air-support answer.

## 1.8.0 - 2026-08-29

### Added
- Answers now say which live game data they read. A new line above the sources
  names the parts of the running world the answer actually looked at, kept
  separate from the code and docs in the citation list.

### Changed
- Live game data and charts are both ON by default. They were the two most
  interesting things Ask does and you had to go find them in Settings first. If
  you have turned either off, it stays off.
- Response length and reasoning effort are two controls now instead of one.
  Asking for a long answer no longer forces the slow model, and asking for a
  short one no longer makes a hard question cheap. You can have three thorough
  sentences, or a long answer from the fast model.
- A question that never actually read live game data no longer spends your
  live-data allowance. Leaving live mode on costs you nothing on questions
  answered from the code.
- Having live mode on no longer blocks a question when your live-data allowance
  is gone. Only questions that genuinely need the running world are held back;
  everything else is answered from code and docs as normal.

## 1.7.0 - 2026-08-29

### Added
- Charts and maps are open to every player. They used to be a supporter feature, so asking for one got you prose and a note about a tier you had not bought. Everyone now gets a few a day, supporters get more, and the allowance resets at midnight UTC.
- When you ask for a chart and have none left for the day, the answer says so in a line at the end instead of quietly coming back as prose.

### Changed
- A chart only counts against your daily allowance if one was actually drawn. Asking for a chart and getting prose back costs you nothing.

## 1.6.2 - 2026-08-29

### Added
- Ask now works in your timezone. Your browser tells it where you are, and "what changed today", "last night" and "this week" are read against your clock, with change dates shown on it too. If your browser does not report a zone, Ask says how long ago something shipped rather than guessing at your calendar day.

## 1.6.1 - 2026-08-29

### Fixed
- "What changed today?" no longer answers from a UTC calendar day. Asked late in the evening, Ask was calling the whole day's work "yesterday" and reporting that nothing had shipped. Changes are now dated by how long ago they landed, in your day, not the server's.
- Change answers no longer lean on a commit that only touched a shared config file. Every gated feature touches those, so a question about war could come back with the week's freight work.
- An answer that came out as raw tool-call JSON instead of prose is now discarded and retried, and costs you nothing.

## 1.6.0 - 2026-08-28

### Added
- Ask can answer "why did this change?" Questions about something breaking, dropping, getting nerfed, or working differently than it used to now consult the game's shipped change history: what went live, on which date, and what it does to you. Answers name the PR and the day it reached the live game, so you can line it up against when you noticed.
- Where a change shipped with a changelog entry, Ask answers in that entry's own words rather than paraphrasing the code.
- When nothing shipped that explains what you saw, Ask says so plainly and answers from the running world instead — markets move, elections turn, and other players act without anyone touching the code.

## 1.5.3 - 2026-08-28

### Fixed
- "Show how my savings and wealth changed over recent turns" now answers with your actual turn-by-turn numbers, including your single biggest move, instead of describing the formula. Thanks to the player report that caught it.
- Switching to another game no longer shows your A House Divided character and corporation in the header. Your AHD identity belongs on AHD's page.

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
