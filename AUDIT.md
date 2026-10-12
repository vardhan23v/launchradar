# LaunchRadar production-readiness audit (Phase 1)

Date: 11 October 2026. Scope: repository `main` at commit `304b01d`, live site
https://launchradar-psi.vercel.app, Worker API https://launchradar-api.launchradar-worker.workers.dev.
**Status (12 October 2026): every confirmed defect in section 1 and every test gap in section 3 is fixed; see `CHANGES.md` → "Audit fixes". Section 2 risks remain open.**

Method: full read of `worker/src`, `worker/test`, `src/`; all project checks run locally; live API probed
with curl; live pages inspected in a browser at desktop and 360 px widths. **No code was changed.**

## 0. What already works (verified, not assumed)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run typecheck:api`, `npm test` (33 tests), `npm run build` | all pass locally |
| Live site `/`, `/v2`, `/report`, `/v3` (307 → `/`) | 200 |
| `/api/health` through Vercel and directly on the Worker | `{"ok":true}`, `Cache-Control: no-store` |
| Pipeline readiness on the live Worker | `mode: live, ready: true` (keys are set) |
| Input validation on `POST /api/runs` | blank question 400 · missing body 400 · form encoding 415 · 20 KB body 413 · 3000-char question 400 ("max 300 characters") · unknown route 404 · unknown run 404 · bad `Last-Event-ID` 404 |
| Concurrency claim, parameterised SQL, key redaction, body/size limits, terminal `done` events | confirmed in code by the Worker audit |
| Live research works end to end | one real run (`run_1a11fd254e7f55h5r`, "D2C skincare brands in India") completed in 424.7 s with 7 billed searches |

## 1. Confirmed defects, by priority

### P0 — the live product gives empty answers

**A. SerpApi searches time out at 20 s and the run still reports success.**
In the only real run on the live database, 9 of 16 searches failed with "SerpApi timed out"
(`worker/src/config.ts:65` `SEARCH_TIMEOUT_MS = 20_000`, one retry at `serpapi.ts:144`). The surviving
Google search took 31 s. Result: 5 signals, 3 clusters, **0 competitors, 0 gaps, 0 opportunities**.
The run page shows a green "Complete" badge, every stage ticked, the sentence "7 searches returned
112 results", and "This run did not get far enough to produce opportunities." Nothing tells the user
that more than half of the research failed, and the log count (16) disagrees with the summary (7).
Expected: a longer timeout for Google engines; a run whose discovery lost most searches should be
labelled "completed with limited evidence" and say why; the summary should count failed searches.
Related risk: a search that SerpApi finishes after our 20 s abort is billed upstream but recorded
`billed:false` (`serpapi.ts:108`), so the monthly counter can under-count by up to 2 per event.

**B. Stale time-budget copy on `/v2` describes a host that no longer exists.**
`src/lib/v2/adapter.ts:24` `RUN_BUDGET_SECONDS = 270` is shown as a "270s budget" chip
(`HomeScreen.tsx:256`), in the copy "capped at 25 searches and 270 seconds" (`:468`), and drives a
countdown ring (`RunScreen.tsx:420`) that reaches "0s left" while real Worker runs take 7+ minutes.
This is the exact "internal limit presented as a user-facing duration" problem, and the number is wrong.

### P1 — reliability and trust

1. **`HOURLY_SEARCH_GUARD=0` crashes the API.** `store.ts:259-261`: with limit 0,
   `results[results.length - 0]` is `undefined` → TypeError → `GET /api/runs` returns 500 and every
   billed search fails with "An internal error interrupted this step". README documents 0 as "stops
   all billed searches". Untested (the monthly=0 case is).
2. **Citation validator accepts unknown evidence ids listed after a valid one.** `citations.ts:24-28`
   returns true on the first matching id and never inspects the rest; `pipeline.ts:387,397` stores
   `evidenceIds` unfiltered, so a signal can ship `["E3","E9999"]` and footnote lookups fail.
3. **`foundProducts` names are never evidence-checked, yet they decide gap status.**
   `pipeline.ts:680-688` only requires a real kill-query evidence id; an invented product name with any
   id makes a gap "served" (card suppressed) or downgrades "open" → "partially-served", and inflates
   `directCompetitors` in the score (`:733`). Competitors do get the name check (`:529-532`).
4. **Stuck-run watchdog only runs from `GET /api/runs`.** `index.ts:204` is the sole caller of
   `failStaleRuns`. A run whose Durable Object alarm dies stays "running" on its page forever
   (EventSource reconnects every 24 s) until someone loads the home page. The 40-minute cut-off is
   based on `created_at`, not last progress, so a slow-but-alive run (LLM 429 waits) is killed as
   "Interrupted" and its alarm stops on the next tick (`runner.ts:30-33`).
5. **Run page shows "Researching" forever when disconnected.** `src/components/v3/RunPage.tsx:244,
   307-318`: fetch errors become `null`, `onerror` only acts on `CLOSED`, the 2 s poll swallows
   failures; the badge follows `run.status` only. No "connection lost, retrying" state. Same in
   `RunV2.tsx:162` and `RunClient.tsx:521`.
6. **In-progress and failed runs are invisible on the home page.** `Dashboard.tsx:113` keeps only
   `status === "complete"`, although the dialog promises "you can leave the page and come back"
   (`NewResearchDialog.tsx:138`). No link back to a running run; failed runs and their error are
   never listed.
7. **LLM spend is unbounded when searches come from the cache.** Guards count only `billed=1`
   rows (`store.ts:215,241,257`); the cache is global with a 24 h TTL. Re-submitting the same
   question costs 0 billed searches but ~15-20 Groq calls per run, and holds the single global run
   slot. No per-IP, per-origin or LLM-call budget exists.
8. **`/v2` labels raw search snippets as verbatim quotes.** `src/lib/v2/adapter.ts:238`
   `quote: e.snippet || e.text || e.title` under the heading "Sources, quoted word for word"
   (`RunScreen.tsx:840`) and "### Sources (verbatim)" in export (`viewModel.ts:689`). The validated
   `Signal.quote` and competitor complaints never reach `/v2`.
9. **Legacy run pages hang on a skeleton when the API is down.** `RunV2.tsx:107-129` and
   `RunClient.tsx:448-488`: `fetchView` has no catch, so neither "not found" nor an error renders.
10. **Starting the demo from the empty radar fails silently.** `Dashboard.tsx:339` calls `start`
    but the error is only rendered inside the (closed) dialog (`:388-398`).
11. **Duplicate side effects on alarm retry.** `runner.ts:35-37` writes D1 rows before saving DO
    state; a failed `storage.put` re-runs the unit: searches are idempotent, but `addSignals`,
    `addCompetitors` and `rejectedSignals` are append-only → duplicate rows and double LLM spend.
12. **`/v2` at 360 px overflows horizontally** (page scroll width 592 px vs 360 px viewport; the top
    bar's "Live searches / Search ⌘K / Data" row does not wrap). `/` and `/runs/[id]` are fine.
13. **`/v2` blocked-state text is wrong.** `HomeV2.tsx:90` folds quota, API-down and not-ready into
    one flag; the page then says "no search or model credentials" even when the real cause is the
    hourly/monthly quota or a run in progress, and the top bar reads "Recorded demo".

### P2 — polish, consistency, hygiene

14. Network failure on `/runs/[id]` is reported as "The research server has no run with this id"
    with no retry (`RunPage.tsx:288-290, 403-413`).
15. HTTP 500 surfaces as the bare string "Internal error" (`hooks.ts:81-86`, `index.ts:258`).
16. Demo run pages show the replay time as the research date (`RunPage.tsx:446,478`;
    `feed.ts:230` acknowledges it).
17. Dead code from the previous serverless host: `src/lib/live.ts` (posts to `/api/runs/live`,
    which is always 410), `setRunPathPrefix` no-ops, `pipeline.inline` branches in four components,
    `/runs/live` routes in all three UIs, and unused exports in `viewModel.ts`.
18. SerpApi error bodies (200 chars) reach the public research log (`serpapi.ts:147-156`,
    `pipeline.ts:119`), contrary to the README's claim; codified by `api.test.ts:93-99`.
19. `searchesUsed` is inconsistent: cache hits are not charged, fixture replays are
    (`serpapi.ts:122-125` vs `:173`).
20. Demo runs can be left "running" with no watchdog (demos excluded at `store.ts:159`); beyond 6
    copies per hour the reused copy replays un-paced; any visitor can "complete" a running demo with a
    large `Last-Event-ID`.
21. Markdown export heading injection via an unknown `region` value (`export.ts:43`, `config.ts:78`).
22. `/v2` "Auto" theme is always dark (no `prefers-color-scheme` rule in `lr.css`).
23. `/v2` re-run swallows 429/503 and just navigates home; "Delete run" removes only the browser
    copy and the server row reappears (`RunV2.tsx:272-291`).
24. IME Enter can start a paid run in the two legacy forms (`HomeClient.tsx:110`,
    `HomeScreen.tsx:235`); `busy` resets after `router.push`, reopening a double-submit window
    (`HomeClient.tsx:77`, `HomeV2.tsx:116`). The primary dialog is correct.
25. `/report` export fails silently (`RunClient.tsx:559-569`); its Sources drawer is `aria-modal`
    without focus management (`:390`); `/report` run list does not label replayed demo rows.
26. Unguarded `JSON.parse` of SSE frames in all three run views (`RunPage.tsx:296`, `RunV2.tsx:151`,
    `RunClient.tsx:510`).
27. Dev-only wording shown to visitors: "Start it with: npm run api" (`HomeClient.tsx:17`, `HomeV2.tsx:29`).
28. Score sub-components are shown but nowhere explained (what Pain / Momentum / Commercial /
    Whitespace / Weak rivals measure); skeptic evidence ids are added to the Sources list but never
    footnoted (`feed.ts:104` vs `DetailPanel.tsx:141-155`); missing competitor pricing reads
    "Not found" / "n/a" instead of "Not verified", and wording differs per view.
29. Metadata: no `metadataBase`, Open Graph or Twitter tags, no per-run titles (`generateMetadata`),
    no `robots.txt`/sitemap; `/report` and `/v2` are indexable duplicates; `public/` still holds the
    create-next-app SVGs.
30. Three copies of stage lists, sub-score tables and region lists across `RunClient.tsx`,
    `adapter.ts`, `feed.ts`, `viewModel.ts`, `HomeClient.tsx`.

## 2. Risks that need verification (not confirmed defects)

- Durable Object alarm retry semantics after an uncaught exception (`runner.ts:24-39` has no try/catch).
- Worst-case wall clock of one LLM unit (6 fetches × 90 s + 429 waits, doubled by the repair retry ≈ 28 min) against DO limits and the 40-minute stale cut-off.
- `CONCURRENT_RUN_LIMIT > 1` makes every check-then-act guard racy; safe at the default of 1.
- Crash between `chargeSearch` and `addSearchCall` (`serpapi.ts:173-176`) → paid search unrecorded.
- Competitor name check accepts 2-character substrings ("AI", "Go") (`pipeline.ts:529`).
- `PipelineState` size against the DO storage value limit on long runs.
- Verbatim quotes may straddle the title/snippet boundary because fields are joined with a space (`citations.ts:14`).
- Workers.dev URL is directly reachable, so any Vercel-side rate limiting would be bypassable.
- Browser copy of a finished run is preferred over the server and never revalidated.
- Dashboard fetches up to 12 full run views per visit with no caching.

## 3. Test gaps (33 existing tests pass)

Missing: hourly guard = 0; mixed valid/unknown evidence ids; `foundProducts` name check; a failing
unit ending in `failed` + `done` through the Durable Object; alarm retry idempotency; LLM invalid-JSON
repair path and timeout; SerpApi timeout; stream of a failed run; `Last-Event-ID` on a live run;
`failStaleRuns` via `GET /api/runs`; cache-hit runs bypassing guards; normalise for maps / jobs /
youtube / play / apple / shopping engines; any browser-level test.

## 4. Which interface is primary

`/` and `/runs/[id]` (`src/components/v3`, `src/lib/v3/feed.ts`) are the only views with linked
numbered footnotes, verbatim signal and complaint quotes, sub-scores, confidence, gap status, proper
modals and error/empty/partial states. `/report` is close in content but weaker on errors and
accessibility. `/v2` drops competitors, confidence and verbatim quotes and shows stale budget copy.
Recommendation: keep v3 as the product; redirect `/v2` and `/report` to it (after checking shared
links) rather than maintain three copies of the same logic.

## 5. Proposed order of work

| Phase | Items | Done when |
|---|---|---|
| 1 Reliability | P0-A, P1-1, 4, 5, 6, 9, 10, 11 + regression tests | a run is never silently empty or silently stuck; stuck runs close on their own; home lists running/failed runs |
| 2 Trust | P1-2, 3, 8; P2-18, 19, 28 | every id in the output resolves; served/partial status is evidence-backed; scores are explained; "Not verified" used |
| 3 UX | P0-B, P1-13; P2-14, 15, 16, 23, 24, 25, 27 | messages are accurate and actionable; no stale host copy |
| 4 Safety | P1-7; P2-20, 21; decide public vs private runs | LLM spend bounded; demo and export edge cases closed |
| 5 Polish | P1-12; P2-17, 22, 26, 29, 30 | 360 px clean on every route; metadata; one copy of shared logic |
