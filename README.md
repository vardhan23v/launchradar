# LaunchRadar

[![Live on Vercel](https://img.shields.io/website?url=https%3A%2F%2Flaunchradar-psi.vercel.app&up_message=live&down_message=down&label=launchradar-psi.vercel.app&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app)
[![Deployed with Vercel](https://img.shields.io/badge/frontend-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Tests: pytest](https://img.shields.io/badge/tests-pytest-0A9EDC?logo=pytest&logoColor=white)](backend/tests)
[![Facts: SerpApi only](https://img.shields.io/badge/facts-SerpApi_only-c2410c)](https://serpapi.com)

**Live:** https://launchradar-psi.vercel.app

A market question goes in; evidence-backed product opportunities come out.
SerpApi is the **only** source of facts — every claim in the output is traceable
to verbatim quotes pinned to a recorded SerpApi search response (see
`files/LAUNCHRADAR_ARCHITECTURE.md`).

## Stack

- **Backend: Python** — FastAPI + Uvicorn + HTTPX in `backend/`. It owns everything server-side:
  SerpApi access, the LLM calls, the pipeline, scoring, the JSON store, SSE and the Markdown export.
- **Frontend: Next.js 16** (App Router) · TypeScript · Tailwind v4. It holds no server logic and no keys;
  `next.config.ts` proxies `/api/*` to the Python API.
- State is a JSON file store (`data/store.json`). No database required.

## Setup

```bash
# backend (Python 3.9+)
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt

# frontend
npm install

cp .env.example .env    # optional: live mode keys, read by the Python API
```

Run both, in two terminals:

```bash
npm run api             # Python API on http://127.0.0.1:8000
```

```bash
npm run dev             # frontend on http://localhost:3000
```

The app runs out of the box with **no keys**: `SERPAPI_MODE=replay` replays
recorded responses from `fixtures/`, and `LLM_PROVIDER=demo` replays the recorded run.
A pre-recorded demo run ("AI tools for college students in India") is listed on
the home page and replays the full research trace over SSE.

## Modes

| `SERPAPI_MODE` | Behaviour                                                    |
| -------------- | ------------------------------------------------------------ |
| `replay`       | Reads hashed responses from `fixtures/serpapi/` (default)    |
| `record`       | Hits SerpApi and writes responses into `fixtures/serpapi/`   |
| `live`         | Hits SerpApi; identical params within 24 h come from the store cache |

- `SERPAPI_API_KEY` is required for `record`/`live`.
- `LLM_PROVIDER` (demo|openai|gemini) selects the LLM backend; `LLM_API_KEY` and
  optional `LLM_MODEL` configure it. Researching a **new** question needs a real
  provider — `demo` only replays the recorded run. The home page says what is missing.
- Budgets are guarded **before** any network cost and throw `BudgetExceeded`:
  25 searches per run, 40 billed searches per hour, 250 per calendar month.
  Cache hits and fixture replays are never counted as billed.
- Per-run split: discovery 12 (including 2 autocomplete seeds) · trends 2 ·
  competitors 6 · gap verification 5.

## Pipeline

1. **Plan** — classify the question, seed queries from autocomplete, build ~10 discovery queries.
2. **Discover** — up to 12 searches across engines (`google`, `google_news`, `google_trends`, `google_play_product`, …); normalise blocks (organic, related_question, discussion, review, trend_point, …) into evidence rows.
3. **Extract signals** — LLM pulls pain/problem statements; **citation validator** drops any signal whose quote is not a verbatim substring of its cited evidence.
4. **Cluster** — signals grouped into need clusters (weak clusters dropped).
5. **Competitors** — LLM enumerates competitors with evidence-backed complaints.
6. **Verify gaps** — per open cluster: search + classify `served` / `partially-served` / `open`.
7. **Score** — 0–100 weighted opportunity score (pain 30 · momentum 20 · commercial 20 · whitespace 20 · weak rivals 10) + confidence bucket.
8. **Skeptic** — 3 objections per opportunity, each pinned to evidence.

Served gaps never become opportunity cards; they stay on the page as **Crowded**, with the products the kill query found.

Progress streams to the UI as SSE step events (persisted events first, then live ones, resumable via `Last-Event-ID`); each `search_call` shows engine, query, result count, latency, and budget impact.

## Project layout

```
backend/
  app/
    main.py        FastAPI routes: runs CRUD, single-request runs (serverless), SSE stream, stateless export
    config.py      env, engines, regions, budgets, score weights, routing, readiness check
    serpapi.py     the ONLY module that reaches SerpApi: budget → cache → call → normalise → persist → event
    engines.py     region defaults, sha256 param hash, key redaction
    normalise.py   raw SerpApi JSON → evidence rows (every block optional)
    llm.py         provider-agnostic JSON-mode client (gemini/openai), one repair retry
    prompts.py     runtime prompts (IMPLEMENTATION Part C)
    pipeline.py    plan → discover → extract → cluster → trends → competitors → gaps → verify → score
    citations.py   verbatim-quote validator
    score.py       deterministic 0–100 score (pure function)
    stream.py      SSE follow + resume, demo pacing
    store.py       JSON persistence
    demo.py        recorded demo runs
    export.py      markdown export
  tests/           pytest: units, client, stream, API routes, golden pipeline run (stubbed network)
api/index.py       Vercel entry point for the Python function (imports backend/app)
requirements.txt   what Vercel installs for that function
vercel.json        function limits and bundled files
src/
  app/             pages only (home, run)
  components/      HomeClient, RunClient, ui primitives
  lib/types.ts     TypeScript shapes of the API's JSON
  lib/live.ts      a run streamed over one request (serverless), started exactly once
  lib/history.ts   finished runs kept in the browser
fixtures/demo/     recorded demo run
fixtures/serpapi/  hashed SerpApi responses (replay mode) — populated by record mode
```

## Tests

```bash
npm test          # pytest — no network, no quota: units + a golden end-to-end pipeline run
npm run typecheck # tsc --noEmit (frontend)
npm run lint      # eslint (frontend)
npm run build     # frontend production build
```

## Deploying (Vercel)

The GitHub repository is connected to Vercel, so **every push to `main` deploys**. One Vercel project serves both halves:

| Part | Where it runs on Vercel | Source |
|---|---|---|
| Frontend | Next.js build | `src/` |
| API | one Python serverless function (FastAPI over ASGI) | `api/index.py` → `backend/app`, dependencies from `requirements.txt` |

`next.config.mjs` rewrites `/api/*` to that function on Vercel, and to `npm run api` (127.0.0.1:8000) everywhere else.
`vercel.json` gives the function its 300-second limit and bundles `backend/app` and `fixtures/demo` with it.

### Environment variables (Vercel → Project Settings → Environment Variables)

Without them the site works and the recorded example replays; new questions stay switched off, and the home page says why.

| Name | Value |
|---|---|
| `SERPAPI_MODE` | `live` |
| `SERPAPI_API_KEY` | your SerpApi key |
| `LLM_PROVIDER` | `openai` (for Groq or any OpenAI-compatible gateway) or `gemini` |
| `LLM_API_KEY` | your LLM key |
| `LLM_BASE_URL` | e.g. `https://api.groq.com/openai/v1` (omit for OpenAI itself or Gemini) |
| `LLM_MODEL` | e.g. `openai/gpt-oss-120b` |
| `LLM_REASONING_EFFORT` | `low` (reasoning models only) |

Redeploy after changing them; a deployment reads its variables when it is built.

### How a run executes: two modes, one codebase

A serverless function is frozen the moment its response ends, and requests share no disk. So the app has two modes,
chosen automatically (`VERCEL` is set on Vercel; `LAUNCHRADAR_INLINE=1` forces it anywhere):

| | Long-lived server (local, containers) | Serverless (Vercel) |
|---|---|---|
| Start | `POST /api/runs`, pipeline in a background thread | `POST /api/runs/live`, pipeline runs **inside that one streaming request** |
| Progress | resumable SSE: `GET /api/runs/{id}/stream` (`Last-Event-ID`) | the same events on the same response, plus `view` frames carrying the results so far |
| Where a finished run lives | `data/store.json` | **the browser** (`localStorage`, last 6 runs); the server may forget it at any time |
| Refresh mid-run | safe | the run is lost (the request is the run) |
| Time limit | none | 270 s budget: optional steps are skipped so the run completes with what it has |
| Export | `POST /api/export` — the browser sends the run it holds, so it works in both modes | |

Limits to know on Vercel: the monthly and hourly search guards count per function instance, so they are best-effort
there (the 25-searches-per-run cap always holds); and a free-tier LLM that rate-limits heavily may hit the time budget,
in which case the run finishes early with its problems and competitors but fewer opportunities.

### Other hosts

`scripts/start.sh` (`npm start`) runs the API and the frontend together in one container, and
`deploy/container-image.txt` is a ready Dockerfile for that (copy it to `./Dockerfile`).

## Recording a new demo run

Set `SERPAPI_API_KEY` + `SERPAPI_MODE=record`, run research for a question, then
re-package the persisted run (store + fixtures) as a `fixtures/demo/<slug>.json`
and add its slug to `DEMO_SLUGS` in `backend/app/demo.py`.

## Deviations from the design docs

- **Python backend instead of Next.js route handlers** — the design docs specify a single Next.js deployable; the backend was moved to FastAPI by request. Module boundaries follow ARCH §8 one to one. On Vercel it still ships as one project.
- **No Prisma/SQLite** — a JSON file store keeps the prototype dependency-free; swap `store.py` for a DB later without touching callers.
- **SerpApi client uses HTTPX directly** (not the official `serpapi` package) to keep the payload → evidence pipeline fully under our control and to make `record`/`replay` symmetric.
- **Validation is hand-written** rather than zod/pydantic models: each LLM stage has a small validator that drops malformed items and fails the stage loudly when the shape is unusable.
- **No shadcn/ui** — the UI is a small set of token-driven primitives in `src/components/ui.tsx` (light + dark, motion and shadows all from CSS variables in `globals.css`).
- **Raw SerpApi JSON is not persisted** — only normalised rows plus `search_metadata.id`, to keep the JSON store small. `record` mode keeps the full raw response as a fixture.
- **Review engines that need a product id** (`google_play_product`, `apple_reviews`, `google_maps_reviews`) are typed and normalised but not yet called by the pipeline.

See `CHANGES.md` for what was fixed against the design docs.
