<div align="center">

# 📡 LaunchRadar

**Market signal, with receipts.**

A market question goes in; evidence-backed product opportunities come out.
SerpApi is the **only** source of facts — every claim in the output is traceable
to verbatim quotes pinned to a recorded SerpApi search response (see
`files/LAUNCHRADAR_ARCHITECTURE.md`).

[![Live app](https://img.shields.io/badge/Live-launchradar--psi.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app)
[![v2 triage board](https://img.shields.io/badge/%2Fv2-Triage_Board-0E9F76?style=for-the-badge&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app/v2)
[![App Status](https://img.shields.io/website?url=https%3A%2F%2Flaunchradar-psi.vercel.app&style=for-the-badge&label=App&up_message=online&down_message=offline&up_color=0E9F6E)](https://launchradar-psi.vercel.app)
[![Last Commit](https://img.shields.io/github/last-commit/vardhan23v/launchradar/main?style=for-the-badge&color=111827&label=Last%20Commit)](https://github.com/vardhan23v/launchradar/commits/main)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![API on Koyeb](https://img.shields.io/badge/API_host-Koyeb-121212?style=for-the-badge&logo=koyeb&logoColor=white)](https://www.koyeb.com/)
[![Tests](https://img.shields.io/github/actions/workflow/status/vardhan23v/launchradar/python-package.yml?style=for-the-badge&label=Tests)](https://github.com/vardhan23v/launchradar/actions/workflows/python-package.yml)
[![Facts: SerpApi only](https://img.shields.io/badge/Facts-SerpApi_only-c2410c?style=for-the-badge&logo=googlechrome&logoColor=white)](https://serpapi.com/)

[Live app](https://launchradar-psi.vercel.app) · [Triage board](https://launchradar-psi.vercel.app/v2) · [Two interfaces](#two-interfaces-one-app) · [Setup](#setup) · [Modes](#modes) · [Pipeline](#pipeline) · [Project layout](#project-layout) · [Tests](#tests) · [Deploying](#deploying-site-on-vercel-api-on-koyeb)

</div>

---

## Two interfaces, one app

The app ships two complete frontends over the same API, pipeline and history:

| Interface | Routes | Character |
|---|---|---|
| **Report view** (original) | `/` and `/runs/[id]` | An editorial, print-like report: findings prose with inline `[E1,E2]` citations, problems, competitors, the research log, Markdown export. |
| **Triage board** (`/v2`, new) | `/v2` and `/v2/runs/[id]` | A working board for the same runs: score ring and five-part breakdowns, shortlist/dismiss with persistence, change view versus a previous run, ⌘K palette, dark/light themes, Markdown/JSON/CSV export. |

Both share the run lifecycle exactly (one streaming request on serverless,
browser-persisted finished runs, saved-first restoration) and you can move
between them freely: `/v2/runs/<id>` opens the same run as `/runs/<id>`. The
v2 screens live in `src/components/v2`, with the real-data mapping isolated in
`src/lib/v2/adapter.ts` and its own scoped stylesheet `src/app/v2/lr.css`
(every class `lr-`, every token `--lr-*`), so the report view's styles are
untouched. See `REDESIGN.md` for the integration record.

## Stack

- **Backend: Python** — FastAPI + Uvicorn + HTTPX in `backend/`. It owns everything server-side:
  SerpApi access, the LLM calls, the pipeline, scoring, the JSON store, SSE and the Markdown export.
- **Frontend: Next.js 16** (App Router) · TypeScript · Tailwind v4. It holds no server logic and no keys;
  `next.config.mjs` proxies `/api/*` to the Python API.
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
recorded responses from `backend/fixtures/`, and `LLM_PROVIDER=demo` replays the recorded run.
A pre-recorded demo run ("AI tools for college students in India") is listed on
the home page and replays the full research trace over SSE.

## Modes

| `SERPAPI_MODE` | Behaviour                                                    |
| -------------- | ------------------------------------------------------------ |
| `replay`       | Reads hashed responses from `backend/fixtures/serpapi/` (default) |
| `record`       | Hits SerpApi and writes responses into `backend/fixtures/serpapi/` |
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
  fixtures/demo/   recorded demo run
  fixtures/serpapi/ hashed SerpApi responses (replay mode) — populated by record mode
  tests/           pytest: units, client, stream, API routes, golden pipeline run (stubbed network)
  Procfile         start command for a Python buildpack host (Koyeb)
  .python-version  Python version for that buildpack
api/index.py       Vercel entry point for the Python function (imports backend/app)
requirements.txt   what Vercel installs for that function
vercel.json        function limits and bundled files
src/
  app/             pages only (home, run, and the /v2 triage board)
  app/v2/lr.css    the triage board's scoped design system (imported only by /v2)
  components/      HomeClient, RunClient, ui primitives (report view)
  components/v2/   HomeV2, RunV2 hosts + pure HomeScreen, RunScreen, ResearchLog, primitives
  lib/types.ts     TypeScript shapes of the API's JSON
  lib/live.ts      a run streamed over one request (serverless), started exactly once
  lib/history.ts   finished runs kept in the browser
  lib/v2/          adapter (real API -> view models, prefs) and viewModel (types, exports)
```

`backend/` is self-contained (code, fixtures, requirements, start command), so a host can build that folder on its own.

## Tests

```bash
npm test          # pytest — no network, no quota: units + a golden end-to-end pipeline run
npm run typecheck # tsc --noEmit (frontend)
npm run lint      # eslint (frontend)
npm run build     # frontend production build
```

## Deploying: site on Vercel, API on Koyeb

Both deploy from GitHub, so **every push to `main` redeploys both**.

| Part | Host | Builds from | How |
|---|---|---|---|
| Frontend | Vercel | repository root | Next.js build of `src/` |
| API | Koyeb, free instance | `backend/` only | Python buildpack: `requirements.txt`, `.python-version`, start command in `Procfile` |

The site reaches the API through its own domain: with `API_URL` set on Vercel, `next.config.mjs` rewrites
`/api/*` to `${API_URL}/api/*`. The browser never talks to Koyeb directly, so no CORS is needed. Every API
answer carries `Cache-Control: no-store`, so Vercel's CDN never caches one.

### 1. Create the API service on Koyeb

1. Sign in at koyeb.com, then **Create Web Service → GitHub**. Install the Koyeb GitHub app for the `launchradar` repository.
2. **Builder:** Buildpack. **Work directory:** `backend`. Leave the build and run commands empty (the `Procfile` has the start command).
3. **Instance:** Free. **Region:** Frankfurt (the closest free region to India).
4. **Ports:** `8000`, HTTP, path `/`. **Health check:** HTTP on port `8000`, path `/api/health`.
5. **Environment variables:** the table below. Use Koyeb **secrets** for the two keys.
6. **Deploy.** When it is healthy, open `https://<service>.koyeb.app/api/health`; it answers `{"ok":true}`.

| Name | Value |
|---|---|
| `SERPAPI_MODE` | `live` |
| `SERPAPI_API_KEY` | your SerpApi key |
| `LLM_PROVIDER` | `openai` (for Groq or any OpenAI-compatible gateway) or `gemini` |
| `LLM_API_KEY` | your LLM key |
| `LLM_BASE_URL` | e.g. `https://api.groq.com/openai/v1` (omit for OpenAI itself or Gemini) |
| `LLM_MODEL` | e.g. `openai/gpt-oss-120b` |
| `LLM_REASONING_EFFORT` | `low` (reasoning models only) |

Without the keys the API still starts and the recorded example replays; new questions stay switched off, and the home page says why.

### 2. Point the site at it on Vercel

Vercel → Project Settings → Environment Variables → add `API_URL` = `https://<service>.koyeb.app` (no trailing slash,
no `/api`). Then **Redeploy**: rewrites are fixed when the site is built. The LLM and SerpApi variables are not needed on
Vercel any more.

### How a run executes

On Koyeb the API is an ordinary long-lived process, so a run works like it does locally:

| | Long-lived server (Koyeb, local) | Serverless fallback (Vercel function, no `API_URL`) |
|---|---|---|
| Start | `POST /api/runs`, pipeline in a background thread | `POST /api/runs/live`, pipeline runs **inside that one streaming request** |
| Progress | resumable SSE: `GET /api/runs/{id}/stream` (`Last-Event-ID`), with a `: ping` comment every 15 s of silence so proxies keep it open | the same events on the same response, plus `view` frames |
| Where a finished run lives | the server's store, and the browser (`localStorage`, last 6 runs) | **the browser** only |
| Refresh mid-run | safe | the run is lost (the request is the run) |
| Time limit | none (the stream reconnects if a proxy cuts it) | 270 s budget: optional steps are skipped |

The mode is chosen automatically: `VERCEL` is set only inside Vercel functions; `LAUNCHRADAR_INLINE=1` forces it anywhere.

Limits of Koyeb's free instance (512 MB RAM, 0.1 vCPU):
- It **sleeps after an hour without traffic**. The first visit after that waits while it wakes.
- Its disk is **temporary**. A redeploy or a sleep clears the server's store, and with it the hourly and monthly search
  counters, so those two guards are best-effort. The 25-searches-per-run cap always holds, and SerpApi enforces your plan's
  own monthly limit. Finished runs stay in the browser.
- A run in progress when the service restarts is marked failed.

### Fallback: everything on Vercel

Remove `API_URL` on Vercel and redeploy. The site then uses the Python function in `api/index.py` again (`vercel.json` gives
it 300 s and bundles `backend/app` and `backend/fixtures/demo`); set the LLM and SerpApi variables on Vercel for that.

### Other hosts

Any Python host can run `backend/` with the `Procfile` command. `scripts/start.sh` (`npm start`) runs the API and the
frontend together on one machine.

## Recording a new demo run

Set `SERPAPI_API_KEY` + `SERPAPI_MODE=record`, run research for a question, then
re-package the persisted run (store + fixtures) as a `backend/fixtures/demo/<slug>.json`
and add its slug to `DEMO_SLUGS` in `backend/app/demo.py`.

## Deviations from the design docs

- **Python backend instead of Next.js route handlers** — the design docs specify a single Next.js deployable; the backend was moved to FastAPI by request. Module boundaries follow ARCH §8 one to one. It deploys to Koyeb; the site stays on Vercel.
- **No Prisma/SQLite** — a JSON file store keeps the prototype dependency-free; swap `store.py` for a DB later without touching callers.
- **SerpApi client uses HTTPX directly** (not the official `serpapi` package) to keep the payload → evidence pipeline fully under our control and to make `record`/`replay` symmetric.
- **Validation is hand-written** rather than zod/pydantic models: each LLM stage has a small validator that drops malformed items and fails the stage loudly when the shape is unusable.
- **No shadcn/ui** — the UI is a small set of token-driven primitives in `src/components/ui.tsx` (light + dark, motion and shadows all from CSS variables in `globals.css`).
- **Raw SerpApi JSON is not persisted** — only normalised rows plus `search_metadata.id`, to keep the JSON store small. `record` mode keeps the full raw response as a fixture.
- **Review engines that need a product id** (`google_play_product`, `apple_reviews`, `google_maps_reviews`) are typed and normalised but not yet called by the pipeline.

See `CHANGES.md` for what was fixed against the design docs.

---

<div align="center">

Every claim carries the exact words it came from. 📡

</div>
