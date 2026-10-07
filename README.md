<div align="center">

# 📡 LaunchRadar

**Market signal, with receipts.**

A market question goes in; evidence-backed product opportunities come out.
SerpApi is the **only** source of facts — every claim in the output is traceable
to verbatim quotes pinned to a recorded SerpApi search response (see
`files/LAUNCHRADAR_ARCHITECTURE.md`).

[![Live app](https://img.shields.io/badge/Live-launchradar--psi.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app)
[![v2 triage board](https://img.shields.io/badge/%2Fv2-Triage_Board-0E9F76?style=for-the-badge&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app/v2)
[![Report view](https://img.shields.io/badge/%2Freport-Report_view-c2410c?style=for-the-badge&logo=vercel&logoColor=white)](https://launchradar-psi.vercel.app/report)
[![App Status](https://img.shields.io/website?url=https%3A%2F%2Flaunchradar-psi.vercel.app&style=for-the-badge&label=App&up_message=online&down_message=offline&up_color=0E9F6E)](https://launchradar-psi.vercel.app)
[![Last Commit](https://img.shields.io/github/last-commit/vardhan23v/launchradar/main?style=for-the-badge&color=111827&label=Last%20Commit)](https://github.com/vardhan23v/launchradar/commits/main)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![API on Cloudflare Workers](https://img.shields.io/badge/API_host-Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![CI](https://img.shields.io/github/actions/workflow/status/vardhan23v/launchradar/ci.yml?style=for-the-badge&label=CI)](https://github.com/vardhan23v/launchradar/actions/workflows/ci.yml)
[![Facts: SerpApi only](https://img.shields.io/badge/Facts-SerpApi_only-c2410c?style=for-the-badge&logo=googlechrome&logoColor=white)](https://serpapi.com/)

[Live app](https://launchradar-psi.vercel.app) · [Triage board](https://launchradar-psi.vercel.app/v2) · [Interfaces](#interfaces) · [Setup](#setup) · [Modes](#modes) · [Pipeline](#pipeline) · [Project layout](#project-layout) · [Tests](#tests) · [Deploying](#deploying-site-on-vercel-api-on-cloudflare-workers)

</div>

---

## Interfaces

Everything linked from the home page uses one design: dark (zinc-950), Geist, indigo actions, emerald for open gaps.

| Page | Route | What it shows |
|---|---|---|
| **Home: the radar** | `/` (old `/v3` links redirect here) | Every opportunity from every finished run in one ranked feed: #1 featured card with the sub-score pentagon, grid/list toggle, sticky filters (research question, gap status, confidence, region, date, shortlist), search with ⌘K / Ctrl+K, sort by score / momentum / newest, a detail panel with numbered source footnotes. |
| **A research run** | `/runs/[id]` | Live progress (seven stages, research log), then the run's opportunities, problems with verbatim quotes, competitors with pricing, rating and complaints, the research log and every search result, plus Markdown export. |

Two earlier designs are still served for anyone with a link, but nothing in the new design links to them:
`/report` and `/report/runs/[id]` (the original print-like report view) and `/v2` (the triage board). The shortlist is shared
between `/`, `/runs/[id]` and `/v2`. The new design lives in `src/components/v3`, `src/lib/v3/feed.ts` and the route group
`src/app/(radar)` with its own stylesheet, so the older views' styles are untouched. See `REDESIGN.md` for the `/v2` record.

## Stack

- **API: a Cloudflare Worker** (TypeScript) in `worker/`. It owns everything server-side: SerpApi access, the LLM calls,
  the pipeline, scoring, persistence, SSE and the Markdown export. Runs live in **D1** (Cloudflare's SQLite), and each
  research run is driven by a **Durable Object** that performs one unit of work (one search, one LLM call) per alarm.
  No dependencies beyond the Workers runtime.
- **Frontend: Next.js 16** (App Router) · TypeScript · Tailwind v4. It holds no server logic and no keys;
  `next.config.mjs` proxies `/api/*` to the Worker.

## Setup

```bash
npm install                 # frontend
npm --prefix worker install # API (wrangler, vitest)
```

Run both, in two terminals:

```bash
npm run api             # the Worker on http://127.0.0.1:8787 (wrangler dev, local D1 + Durable Objects)
```

```bash
npm run dev             # frontend on http://localhost:3000
```

The app runs out of the box with **no keys**: the recorded demo run ("AI tools for college students in India") is listed
on the home page and replays the full research trace over SSE. To research a **new** question locally, create
`worker/.dev.vars` (git-ignored) with `SERPAPI_API_KEY=…` and `LLM_API_KEY=…`; the other settings have defaults in
`worker/wrangler.jsonc` (`SERPAPI_MODE=live`, Groq's OpenAI-compatible endpoint with `openai/gpt-oss-120b`).

## Modes

| `SERPAPI_MODE` | Behaviour                                                    |
| -------------- | ------------------------------------------------------------ |
| `replay`       | Answers only from a fixture source (tests) — a missing fixture fails loudly |
| `live`         | Hits SerpApi; identical params within 24 h come from the D1 cache (default in `wrangler.jsonc`) |

- `SERPAPI_API_KEY` is required for `live`.
- `LLM_PROVIDER` (demo|openai|gemini) selects the LLM backend; `LLM_API_KEY` and
  optional `LLM_MODEL` / `LLM_BASE_URL` / `LLM_REASONING_EFFORT` configure it. Researching a **new** question needs a real
  provider — `demo` only replays the recorded run. The home page says what is missing.
- Budgets are guarded **before** any network cost:
  25 searches per run, 40 billed searches per hour, 250 per calendar month (`RUN_SEARCH_BUDGET`, `HOURLY_SEARCH_GUARD`,
  `MONTHLY_SEARCH_BUDGET`). Cache hits and fixture replays are never counted as billed. The counters live in D1, so they
  survive deploys.
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

### How a run executes

`POST /api/runs` creates the run in D1 and starts its Durable Object. Every alarm of that object performs **one unit** of
the pipeline — one search, one LLM call or one bookkeeping step — persists the pipeline state and schedules the next
alarm. Each unit is its own invocation, so it has the free plan's full CPU, subrequest and query budget to itself, and a
browser that closes the tab cannot stop a run. A unit that is retried after a crash finds its search already recorded
(the call id is deterministic) and does not search again.

`GET /api/runs/{id}/stream` replays the persisted log, then follows a running run for up to 24 s (with a `: ping` every
10 s of silence) and closes; the browser's `EventSource` reconnects with `Last-Event-ID`, so no single request ever
follows a ten-minute run. A finished run replays its whole log and the response ends. The recorded example is paced by the
stream itself, so its trace animates.

## Project layout

```
worker/
  src/
    index.ts       routes: runs, SSE stream, stateless export, health
    runner.ts      Durable Object: one pipeline unit per alarm
    pipeline.ts    the resumable step machine: plan → discover → extract → cluster → trends → competitors → gaps → verify → score
    store.ts       D1 persistence (runs, events, search calls + cache, evidence, entities)
    stream.ts      SSE follow + resume, heartbeats, demo pacing
    serpapi.ts     the ONLY module that reaches SerpApi: budget → cache → call → normalise → persist → event
    engines.ts     region defaults, sha256 param hash, key redaction
    normalise.ts   raw SerpApi JSON → evidence rows (every block optional)
    llm.ts         provider-agnostic JSON-mode client (gemini/openai), one repair retry, 429 patience
    prompts.ts     runtime prompts (IMPLEMENTATION Part C)
    citations.ts   verbatim-quote validator
    score.ts       deterministic 0–100 score (pure function)
    config.ts      settings, engines, regions, budgets, score weights, routing, readiness check
    demo.ts        recorded demo runs
    export.ts      markdown export
  fixtures/demo/   recorded demo run
  test/            vitest inside the Workers runtime: units, API routes, stream, golden pipeline run (stubbed network)
  wrangler.jsonc   the Worker's config: D1 and Durable Object bindings, non-secret settings
src/
  app/             pages only (home, run, and the /v2 triage board)
  app/v2/lr.css    the triage board's scoped design system (imported only by /v2)
  app/(radar)/     the home page (radar dashboard) and its radar.css: font, page colour, keyframes
  app/(radar)/runs/ the new-design run page
  app/report/      the original report view (home and runs), no longer linked
  components/      HomeClient, RunClient, ui primitives (report view)
  components/v2/   HomeV2, RunV2 hosts + pure HomeScreen, RunScreen, ResearchLog, primitives
  components/v3/   radar dashboard: Dashboard host, TopNav, Cards, FilterPanel, DetailPanel, NewResearchDialog
  lib/types.ts     TypeScript shapes of the API's JSON
  lib/history.ts   finished runs kept in the browser
  lib/v2/          adapter (real API -> view models, prefs) and viewModel (types, exports)
  lib/v3/feed.ts   pure feed logic: runs -> ranked opportunities, filters, facets, source footnotes
```

## Tests

```bash
npm test          # the Worker's vitest suite, run inside the Workers runtime: no network, no quota
npm run typecheck # tsc --noEmit (frontend); npm run typecheck:api for the Worker
npm run lint      # eslint (frontend)
npm run build     # frontend production build
```

## Deploying: site on Vercel, API on Cloudflare Workers

Both are free and both deploy from GitHub, so **every push to `main` redeploys both**. Neither sleeps.

| Part | Host | Builds from | How |
|---|---|---|---|
| Frontend | Vercel | repository root | Next.js build of `src/` |
| API | Cloudflare Workers (free plan) | `worker/` only | Workers Builds runs `wrangler deploy` |

The site reaches the API through its own domain: with `API_URL` set on Vercel, `next.config.mjs` rewrites
`/api/*` to `${API_URL}/api/*`. The browser never talks to the Worker directly, so no CORS is needed. Every API
answer carries `Cache-Control: no-store`, so Vercel's CDN never caches one.

### 1. Create the API on Cloudflare

1. Sign up at dash.cloudflare.com (email and password; the Workers Free plan is the default, no card).
2. **Storage & Databases → D1 → Create** a database named `launchradar`. Copy its **Database ID** into
   `worker/wrangler.jsonc` (`database_id`) and push. The tables are created by the Worker itself on first use.
3. **Workers & Pages → Create → Import a repository** → choose `launchradar`. Set the **root directory** to `worker`,
   leave the build command empty and the deploy command as `npx wrangler deploy`. The Worker name must be
   `launchradar-api` (it is read from `wrangler.jsonc`).
4. When the first build finishes, open the Worker → **Settings → Variables and Secrets** and add two **secrets**:
   `SERPAPI_API_KEY` and `LLM_API_KEY`. Everything else is already in `wrangler.jsonc`:

| Name | Value |
|---|---|
| `SERPAPI_MODE` | `live` |
| `LLM_PROVIDER` | `openai` (Groq speaks the OpenAI format) |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `LLM_REASONING_EFFORT` | `low` |

5. Open `https://launchradar-api.<your-subdomain>.workers.dev/api/health`; it answers `{"ok":true}`.

Secrets are never written to the repository or printed by the Worker. Change one later in the same **Variables and
Secrets** tab; the next request uses it.

### 2. Point the site at it on Vercel

Vercel → Project Settings → Environment Variables → set `API_URL` = `https://launchradar-api.<your-subdomain>.workers.dev`
(no trailing slash, no `/api`). Then **Redeploy**: rewrites are fixed when the site is built. The LLM and SerpApi
variables are not needed on Vercel.

### What the free plans give

- **Workers**: 100,000 requests a day, 10 ms of CPU per request (waiting on SerpApi or the LLM does not count), no
  sleeping, no cold start to speak of. A run uses about 60 invocations.
- **D1**: 5 million rows read and 100,000 rows written a day, 5 GB. A run writes about 500 rows.
- **Durable Objects**: 100,000 requests and 13,000 GB-seconds a day; a ten-minute run costs about 75 GB-seconds.
- **SerpApi**: 250 searches a month on the free plan, which the monthly guard mirrors — about ten runs.

## Recording a new demo run

Run research for a question on a local Worker with real keys, export the run as JSON from `GET /api/runs/{id}`, add the
`events` from `GET /api/runs/{id}/stream`, save it as `worker/fixtures/demo/<slug>.json` and add the slug to `DEMOS` in
`worker/src/demo.ts`.

## Deviations from the design docs

- **A Cloudflare Worker instead of Next.js route handlers** — the design docs specify a single Next.js deployable; the backend is a separate deployable so it can run on an always-on free host. Module boundaries follow ARCH §8 one to one.
- **D1 (SQLite) instead of Prisma** — plain SQL in `store.ts`; the schema is created by the Worker on first use.
- **SerpApi client uses fetch directly** (not the official `serpapi` package) to keep the payload → evidence pipeline fully under our control.
- **Validation is hand-written** rather than zod models: each LLM stage has a small validator that drops malformed items and fails the stage loudly when the shape is unusable.
- **No shadcn/ui** — the UI is a small set of token-driven primitives in `src/components/ui.tsx` (light + dark, motion and shadows all from CSS variables in `globals.css`).
- **Raw SerpApi JSON is not persisted** — only normalised rows plus `search_metadata.id`, to keep the database small.
- **Review engines that need a product id** (`google_play_product`, `apple_reviews`, `google_maps_reviews`) are typed and normalised but not yet called by the pipeline.

See `CHANGES.md` for what was fixed against the design docs.

---

<div align="center">

Every claim carries the exact words it came from. 📡

</div>
