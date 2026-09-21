# LaunchRadar — v2 triage interface (shipped additively under `/v2`)

> Status: **integrated and verified.** This file started as a blind redesign spec; the facts below
> replace its assumptions, which were written without repo access and have since been checked
> against the real code (the redesign predated the knowledge that runs already had deep links at
> `/runs/[id]`, and it guessed at payload shapes that `src/lib/types.ts` defines exactly).

## 0. What actually shipped

The redesigned triage board lives **alongside** the original report interface, never replacing it:

| Route | Component | Interface |
| --- | --- | --- |
| `/` and `/runs/[id]` | `src/components/HomeClient.tsx`, `src/components/RunClient.tsx` | The original report view — unchanged |
| `/v2` | `src/app/v2/page.tsx` → `src/components/v2/HomeV2.tsx` → `HomeScreen.tsx` | The triage board |
| `/v2/runs/[id]` | `src/app/v2/runs/[id]/page.tsx` → `src/components/v2/RunV2.tsx` → `RunScreen.tsx` | Same run, triage layout (id may be a real run id, a saved run id, or `live`) |

Pure screens and the layers that adapt real data to them:

- `src/components/v2/{HomeScreen,RunScreen,ResearchLog,primitives}.tsx` — pure: no fetch, no
  storage, no router. All I/O arrives via props; every effect is a callback.
- `src/lib/v2/adapter.ts` — the only place that knows both vocabularies (`src/lib/types.ts` → view
  models). Also owns region codes, browser prefs (theme/density/triage ids) and `viewToRunVM`.
- `src/lib/v2/viewModel.ts` — view models, tolerant mappers, `diffRuns` change view, exports
  (Markdown/JSON/CSV generated locally from the browser's own copy).
- `src/app/v2/lr.css` — scoped design system: every class `lr-`, every token `--lr-*`; imported
  once by `src/app/v2/layout.tsx`, so `/` keeps `globals.css` untouched.

## 1. Wiring facts (verified against the code)

- Serverless runs are **one streaming `POST /api/runs/live`** whose frames include
  `{ type: "view", view }` snapshots, so no second request is ever needed. The live session is a
  **module-level singleton** in `src/lib/live.ts`: duplicate POSTs would spend the search budget
  twice, so components only subscribe and `ensureLiveRun()` starts at most one run.
- Finished runs persist in `localStorage` (`src/lib/history.ts`, newest 6). Restoration prefers the
  browser's copy because a serverless instance may have recycled and forgotten the run.
- When a live run finishes, `live.ts` rewrites the address to the real run id. The prefix is
  configurable (`setRunPathPrefix`): the v2 hosts set `/v2/runs/` while mounted and restore
  `/runs/` on unmount, so v2 navigation can never leak into the original UI's addresses. Choices
  made during the stream (shortlist/dismiss, keyed `live`) are carried to the finished id.
- Regions: the form shows names, the backend takes short codes — converted in `adapter.ts`
  (`codeForLabel`/`labelForCode`), defaults `in`.
- Exports in v2 are generated client-side from the run view (`fileExports`); the original view's
  `POST /api/export` endpoint is untouched.

## 2. Adapter accuracy notes (bugs found in the blind design and fixed)

1. **Citations in prose.** Opportunity prose cites sources inline as `[E1,E2]`. The blind design
   only gathered evidence ids from found-products and skeptic objections. `opportunityVM` now also
   parses the prose with `citeGroups` from `src/lib/evidence.ts`.
2. **Dates are not retrieval timestamps.** `Evidence.date` is the source's publication date. The
   view model field is `sourceDate` and the evidence card says "published …" — the blind design's
   `retrievedAt`/("checked …") mislabelled it.
3. **Partially-served gaps.** `Gap.status` is a tri-state (`open`/`partially-served`/`served`).
   The blind design collapsed it to a boolean; `GapVM` keeps the real status and the UI shows
   "Partially served" as its own answer, distinct from "Still open".
4. **Skipped stages.** A budget-capped run can still end `complete` with stages skipped: the
   backend reports those as warn-level stage events whose message mentions a skip
   (`backend/app/pipeline.py`). `stagesFromEvents` marks a stage `skipped` (with the reason) when
   it left nothing behind in the run, keeps `done` with the reason when only part of it was
   skipped, and marks stages a failed run never reached as `skipped` rather than `done`.

## 3. Verification performed

- `tsc --noEmit` clean; `eslint src` clean; `next build` produces `/`, `/runs/[id]`, `/v2`,
  `/v2/runs/[id]`; backend `pytest` — 24 passed.
- Fixture checks against `viewToRunVM`/`stagesFromEvents` covering the four adapter notes above.
- `next start` smoke test: `/`, `/v2`, `/v2/runs/live`, unknown run ids and the original
  `/runs/abc` all serve 200; `/v2` HTML carries the scoped `lr-root` shell.

## 4. Known limits

- Keyboard palette/shortcuts and theme are per-interface: v2 keeps its prefs under `lr:v2:*`
  storage keys, the original view keeps its own.
- A re-run of a recorded demo is not possible by design (fixtures are fixed); the run screen's
  "Re-run this question" always starts a fresh live run for real runs.
