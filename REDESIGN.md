# The `/v2` triage board (retired)

> Status: **retired.** `/v2` and `/v2/runs/[id]` are permanent redirects (HTTP 308, set in
> `next.config.mjs`) to the radar dashboard at `/` and `/runs/[id]`. This file is kept as the
> historical record of the triage board; the code it describes has been deleted.

## What it was

A second interface, shipped additively alongside the original report view and never linked from
it: a triage board for the same runs (shortlist / dismiss, a density toggle, a theme toggle,
local Markdown/JSON/CSV exports). It lived in `src/app/v2` (with its own scoped stylesheet
`lr.css`), `src/components/v2` (pure `HomeScreen`, `RunScreen`, `ResearchLog`, `primitives`, and
the `HomeV2` / `RunV2` hosts that fetched data for them) and `src/lib/v2` (`adapter.ts`, the one
place that mapped the API's JSON into the board's view models, and `viewModel.ts`).

The board was designed blind, without repo access, and then corrected against the real code:
inline citations (`[E1,E2]`) in opportunity prose, publication dates versus retrieval dates, the
tri-state gap status (`open` / `partially-served` / `served`) and skipped stages in budget-capped
runs were the four assumptions that had to be fixed in the adapter.

## Why it was retired

The production-readiness audit of 11 October 2026 (`AUDIT.md`, section 4) compared the three
interfaces and found that only the radar dashboard showed linked footnotes, verbatim signal and
complaint quotes, sub-scores, confidence, gap status and proper error, empty and partial states.
The board had drifted from the backend it was built for:

- its "270 s budget" chip, countdown ring and copy described a serverless host that no longer
  exists (runs on the Worker take seven minutes or more);
- it presented raw search snippets under "Sources, quoted word for word" and "Sources (verbatim)",
  when the validated quotes never reached it;
- it dropped competitors and confidence altogether;
- it overflowed horizontally at 360 px;
- its blocked-state text blamed missing credentials whatever the real cause;
- and it was a third copy of the stage list, sub-score table and region list.

Rather than maintain three copies of the same logic, the dashboard became the only product and
the two older views became redirects (see `CHANGES.md`, "One interface").

## What carried over

- Deep links: `/v2/runs/<id>` opens the same run at `/runs/<id>`.
- The shortlist star: the board's choices are read by the dashboard.
- The design corrections listed above live on in the dashboard's feed logic
  (`src/lib/v3/feed.ts`) and in `src/lib/evidence.ts`.
