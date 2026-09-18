# LaunchRadar

A market question goes in; evidence-backed product opportunities come out.
SerpApi is the **only** source of facts — every claim in the output is traceable
to verbatim quotes pinned to a recorded SerpApi search response (see
`files/LAUNCHRADAR_ARCHITECTURE.md`).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · zod v4 · vitest.
State is a JSON file store (`data/store.json`). No database required.

## Setup

```bash
npm install
cp .env.example .env    # optional: live mode keys
npm run dev             # http://localhost:3000
```

The app runs out of the box with **no keys**: `SERPAPI_MODE=replay` replays
recorded responses from `fixtures/`, and `LLM_PROVIDER=demo` uses a demo LLM.
A pre-recorded demo run ("AI tools for college students in India") is listed on
the home page and replays the full research trace over SSE.

## Modes

| `SERPAPI_MODE` | Behaviour                                                    |
| -------------- | ------------------------------------------------------------ |
| `replay`       | Reads hashed responses from `fixtures/serpapi/` (default)    |
| `record`       | Hits SerpApi and writes responses into `fixtures/serpapi/`   |
| `live`         | Hits SerpApi, nothing cached                                 |

- `SERPAPI_API_KEY` is required for `record`/`live`.
- `LLM_PROVIDER` (demo|openai|gemini) selects the LLM backend.
- A run is budget-capped (25 searches · 8/hr · 250/mo, guarded before any
  network cost). Running out throws a `BudgetError`.

## Pipeline

1. **Plan** — classify the question, seed queries from autocomplete, build ~10 discovery queries.
2. **Discover** — up to 12 searches across engines (`google`, `google_news`, `google_trends`, `google_play_product`, …); normalise blocks (organic, related_question, discussion, review, trend_point, …) into evidence rows.
3. **Extract signals** — LLM pulls pain/problem statements; **citation validator** drops any signal whose quote is not a verbatim substring of its cited evidence.
4. **Cluster** — signals grouped into need clusters (weak clusters dropped).
5. **Competitors** — LLM enumerates competitors with evidence-backed complaints.
6. **Verify gaps** — per open cluster: search + classify `served` / `partially-served` / `open`.
7. **Score** — 0–100 weighted opportunity score (pain 20 · momentum 20 · commercial 20 · whitespace 20 · weak rivals 20) + confidence bucket.
8. **Skeptic** — 3 objections per opportunity, each pinned to evidence.

Progress streams to the UI as SSE `steps`; each `search_call` shows engine, query, result count, latency, and budget impact.

## Project layout

```
src/
  lib/
    config.ts            engines, regions, budgets, score weights, routing
    schemas.ts           zod models (Run, Evidence+types, StepEvent)
    serpapi/             typed params, normalise, routing, client (budget/cache/replay/record/live)
    llm/                 prompts + client (demo/openai/gemini)
    validate/citations.ts verbatim-quote verification
    pipeline/            run/live/demo/score
    store.ts             JSON persistence
    stream.ts            SSE replay + encode
    export.ts            markdown export
  app/api/runs/          runs CRUD, run view, SSE stream, markdown export
  app/runs/[id]/         run page (trace, clusters, competitors, opportunities, drawer)
tests/                   vitest (score, citations, normalise, client, demo-fixture integrity)
fixtures/demo/           recorded demo run (used by demo mode + tests)
fixtures/serpapi/        hashed SerpApi responses (replay mode) — populated by record mode
```

## Tests

```bash
npm test          # vitest: score, citation validator, normalise, client, demo fixture integrity
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # production build
```

## Recording a new demo run

Set `SERPAPI_API_KEY` + `SERPAPI_MODE=record`, run research for a question, then
re-package the persisted run (store + fixtures) as a `fixtures/demo/<slug>.json`
and register it in `src/lib/pipeline/demo.ts`.

## Deviations from the design docs

- **No Prisma/SQLite** — a JSON file store keeps the prototype dependency-free; swap `store.ts` for a DB later without touching callers.
- **SerpApi client uses `fetch` directly** (not the official `serpapi` package) to keep the payload → evidence pipeline fully under our control and to make `record`/`replay` symmetric.