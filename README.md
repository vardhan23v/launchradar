# LaunchRadar

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
    main.py        FastAPI routes: runs CRUD, run view, SSE stream, markdown export
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
src/
  app/             pages only (home, run)
  components/      HomeClient, RunClient, ui primitives
  lib/types.ts     TypeScript shapes of the API's JSON
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

## Deploying (Antideploy)

The app ships as **one container running two processes** (`Dockerfile`, `scripts/start.sh`): the Next.js frontend on
`$PORT`, and the Python API on `127.0.0.1:8000`, reachable only through the frontend's `/api/*` proxy. If either
process exits, the container exits so the platform restarts it.

`.antideploy.json` links this folder to the `launchradar` application. `scripts/antideploy.py` does the rest; it reads
the account token from `~/.antideploy/config.json` and the keys from `.env`, and never prints either.

```bash
npm run deploy:check     # what would be uploaded, and which platform secrets are still missing
npm run deploy:secrets   # send SERPAPI_API_KEY, LLM_* from .env to the platform (write-only there)
npm run deploy           # upload, then follow the build until it is live or failed
npm run deploy:status    # recent deployments and health
npm run deploy:logs      # running container output
```

Things to know:

- **Runs do not survive a deploy.** The platform replaces the container's disk on every deploy, and the app keeps its
  state in a JSON file (`STORE_PATH=/tmp/launchradar/store.json`). Export a run as Markdown if you need to keep it.
  Moving `store.py` to the platform's Postgres (`DATABASE_URL`) is the fix when this matters.
- The server always runs `SERPAPI_MODE=live`; `record` is for local use.
- `.env`, local run data, recorded SerpApi fixtures, tests and dependencies are never uploaded.
- Accounts younger than 24 hours cannot use a Dockerfile on Antideploy. If the deploy is refused for that reason, wait
  it out; `scripts/start.sh` can also bootstrap the Python side itself when the platform detects the build instead.
- The free plan allows 10 successful deploys a month.

## Recording a new demo run

Set `SERPAPI_API_KEY` + `SERPAPI_MODE=record`, run research for a question, then
re-package the persisted run (store + fixtures) as a `fixtures/demo/<slug>.json`
and add its slug to `DEMO_SLUGS` in `backend/app/demo.py`.

## Deviations from the design docs

- **Python backend instead of Next.js route handlers** — the design docs specify a single Next.js deployable; the backend was moved to FastAPI by request. Module boundaries follow ARCH §8 one to one.
- **No Prisma/SQLite** — a JSON file store keeps the prototype dependency-free; swap `store.py` for a DB later without touching callers.
- **SerpApi client uses HTTPX directly** (not the official `serpapi` package) to keep the payload → evidence pipeline fully under our control and to make `record`/`replay` symmetric.
- **Validation is hand-written** rather than zod/pydantic models: each LLM stage has a small validator that drops malformed items and fails the stage loudly when the shape is unusable.
- **No shadcn/ui** — the UI is a small set of token-driven primitives in `src/components/ui.tsx` (light + dark, motion and shadows all from CSS variables in `globals.css`).
- **Raw SerpApi JSON is not persisted** — only normalised rows plus `search_metadata.id`, to keep the JSON store small. `record` mode keeps the full raw response as a fixture.
- **Review engines that need a product id** (`google_play_product`, `apple_reviews`, `google_maps_reviews`) are typed and normalised but not yet called by the pipeline.

See `CHANGES.md` for what was fixed against the design docs.
