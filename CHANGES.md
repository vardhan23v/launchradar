# Changes against the design docs

Reference: `../files/LAUNCHRADAR_ARCHITECTURE.md` (ARCH) and `../files/LAUNCHRADAR_IMPLEMENTATION.md` (IMPL).

## SerpApi facts corrected (IMPL B0 rule 10 — checked against serpapi.com docs, Sept 2026)

- `google_trends` TIMESERIES: points are `timeline_data[].{date, timestamp, values[].{query, extracted_value}}`.
  The normaliser read `formattedTime` / `value`, so every point was 0 and had no date — Momentum was always 0.
- `google_trends` RELATED_QUERIES: rising queries live at `related_queries.rising[]`, not `rising_related_queries`.
- `google_news`: `iso_date` is preferred; `date` is `"01/02/2026, 10:30 PM, +0700 +07"`, which `Date.parse` rejects,
  so the "≥2 news items < 90 days" bonus never fired. Story clusters (`stories[]`) are now flattened.
- Trends `geo` for the UK is `GB` (not `UK`).
- `discussions_and_forums`: answer snippets (the actual user voice) are now captured, not just the thread title.

## Defects fixed

| Area | Problem | Fix |
|---|---|---|
| SSE stream | Opening a **live** run's stream replayed what existed, then marked the run `complete` mid-flight | Stream follows the event log until the pipeline finishes; only demo runs are completed by the stream |
| SSE stream | Finished runs showed an empty trace; reconnects and React double-effects duplicated rows; listeners leaked | Always replays persisted events; events carry ids; `Last-Event-ID` resume; real effect cleanup |
| Run start | Any new question failed unless `SERPAPI_MODE=live`; `record` and `replay` never ran the pipeline | One readiness check; all three modes run the same pipeline; clear guidance when a key is missing |
| Env | `.env.example` named `OPENAI_API_KEY`/`GEMINI_API_KEY`, code read only `LLM_API_KEY` | `LLM_API_KEY` documented; provider-specific names accepted as fallbacks |
| Region | Client hard-coded region `in` for every search | Region comes from the run (ARCH §1 #11) |
| Budget | "Monthly" guard counted the current run's calls; hourly guard unused; a full run needed 26 searches for a budget of 25 | Billed searches are timestamped; real monthly + hourly guards; seeds come out of discovery's 12; per-stage allowances |
| Retry | 5xx was never retried (dead `"status" in err` check) | Typed `SerpApiHttpError`: one retry on 5xx/timeout/network, none on 4xx |
| Cache | No TTL; only consulted in `live`; FNV-32 hash | 24 h TTL, `live` + `record`, sha256 per ARCH §3 |
| Failures | Failed searches were not persisted | Stored as `failed`/`skipped` rows, shown in the trace, never billed |
| Signals | Signal ids collided across batches; cluster prompt used positional ids that did not match stored ids | Ids assigned after validation; clusters reference real ids; a signal lives in ≤1 cluster |
| Competitors | Accepted if any cited id existed — LLM-memory products passed; complaints unvalidated; not tied to clusters | Name must appear in a cited row; complaint quotes pass the citation validator; `clusterIds`; merged by name |
| Gaps | Unknown cluster/evidence ids persisted; `served` accepted without a found product; segment hard-coded to "students" | Ids validated; `served` requires a product resolving to kill-query evidence; segment from the cluster's signals |
| Opportunities | Card/sceptic prompts received no evidence, so citations could not be real | Evidence rows supplied; unknown `[E..]` ids stripped before persisting |
| Planner | Engine list hard-coded; one unknown engine failed the plan; no domain-term guard | Routing from question type; unknown engines → `google`; off-topic queries dropped; template fallback |
| LLM client | Gemini had no JSON mode, key in URL, no HTTP/timeout handling, no trace events | `responseMimeType`, header auth, status checks, 90 s timeout, fence-tolerant parse, `llm` step events |
| Store | One instance per route bundle in Next; crash on read-only disk | `globalThis` singleton; falls back to temp dir, then memory |
| API | Unknown run → 500; demo slug unchecked (path traversal); cache payload leaked to browser | 404s; slug allow-list; `__rows` stripped from responses |
| UI | Quote never highlighted in the drawer; only 2 signals per cluster; served gaps hidden; month meter double-counted | All fixed; "Crowded" panel added; meter uses billed searches this month |

## Frontend redesign

Token-driven theme (light + dark), one teal accent, no gradients; IBM Plex Sans/Mono for UI and data,
Instrument Serif for headlines; radar mark that sweeps while a run is live; pipeline stepper derived from
the event log; two-line trace rows so full queries are readable.

## Backend moved from Node.js to Python

By request, the whole backend was ported from Next.js route handlers (TypeScript) to **FastAPI** in `backend/`.
Next.js is now frontend only and proxies `/api/*` to the Python API; the URL contract and JSON shapes are unchanged,
so the UI needed no behavioural change. Every fix listed above was carried over, and the tests were ported to pytest
(16 tests, including the golden pipeline run with stubbed SerpApi and LLM).

Notes for the port:

- Discovery searches run on a 3-thread pool; budget guards and store writes are lock-protected so
  concurrent searches cannot overspend or collide on evidence ids.
- The store writes atomically (temp file + rename), so a crash never leaves a half-written `store.json`.
- The pipeline runs in a background thread of the API process; the SSE endpoint follows the persisted event log.
- `compress: false` in `next.config.ts` keeps the proxied event stream incremental.
- Cached search fixtures recorded by the old build would not match: the hash is the same sha256 scheme,
  but none had been recorded yet, so nothing is lost.

## First live run (2026-09-18) — what real data exposed

The first run against real SerpApi and a real LLM completed (24 searches, 56 cited signals, 5 verified gaps,
5 opportunities, every citation resolving to stored evidence). It also exposed problems the stubbed tests could not:

| Problem seen live | Fix |
|---|---|
| Two `google_news` searches returned 156 rows — more than all other evidence — forcing 7 extractor batches | News capped at 15 rows per search; extractor input is prioritised by voice-of-customer block type and capped at 120 rows (≤3 batches) |
| The planner wrote descriptions ("Quora question: best AI note-taking app…") instead of searches | `clean_query` strips labels and lead-ins, keeps the site hint as a keyword; the prompt now says so explicitly |
| Free-tier LLM rate limits (HTTP 429) would have failed the run | Client waits (honouring `retry-after`) and retries up to 5 times; each wait is shown in the trace |
| Competitor query came out as "best best AI study tool app" | Leading "best/top" and trailing "app" are stripped from the cluster keyword first |
| Restarting the API mid-run would leave the run "running" forever | Interrupted live runs are marked failed on startup, with guidance |

Also added: OpenAI-compatible gateways via `LLM_BASE_URL` (Groq, OpenRouter, local servers), `LLM_JSON_MODE`,
and `LLM_REASONING_EFFORT` for reasoning models.

## Frontend redesign, second pass — "clean and smooth"

Replaces the dense instrument look. Same data, same API, no behaviour removed.

- **Visual language:** one typeface (Geist, mono only for digits), neutral surfaces, soft shadows, 16 px radii,
  no background grid; still one accent and no gradients; light and dark from the same tokens.
- **Run page:** question as the headline, a summary strip (searches, evidence, cited signals, rejected, competitors,
  gaps) with the pipeline progress bar, results in tabs (Opportunities · Problems · Competitors), and a live
  Activity rail that follows the newest step. Opportunity cards lead with the pitch and score; the cited evidence,
  kill-query findings and sceptic's objections expand on demand.
- **Motion:** staggered entrance, animated score ring and bars, easing progress segments, sliding evidence drawer
  (closes on Escape), skeleton loaders instead of "Loading…". All of it is disabled under `prefers-reduced-motion`.
- **Home:** centred hero, one question box (Enter to run), example prompts, recorded and recent runs.

## Frontend redesign, third pass — a research report, not a template

The second pass still looked generated: centred two-tone hero, pill chips, shadowed rounded cards, stat tiles and a
"how it works" strip. This pass gives the product its own voice. It reads like a typeset analyst report.

- **Type:** Newsreader (serif) for questions, findings and prose; Instrument Sans for the interface; mono only for
  figures, ids and the research log.
- **Structure by rules, not boxes:** hairline rules and a strong baseline; no shadows, no pills, no rounded cards.
  Paper and ink, with one vermilion used only for findings, references and the primary action.
- **Citations as footnotes:** `[E70]` markers render as raised references that open the source panel, with the quoted
  words highlighted.
- **Words instead of widgets:** the run summary is a sentence ("24 searches returned 528 results. 56 signals passed
  the word-for-word quote check and 1 was thrown out."), status is a word with a square marker, the score is a large
  numeral beside a ruled table of its five parts, ruled-out gaps are struck through.
- **Home:** the headline is the question label; the input is a single ruled line; runs are a plain ledger; the
  marketing strip is replaced by one paragraph on method.
- Motion is functional only: content appearing, bars filling, the source panel moving.

Also fixed from a real failure: two live runs used the 40-searches-per-hour guard, and a third run started, spent LLM
calls, and failed blaming the question. A run is now refused up front (HTTP 429) with the reason and a wait time, the
home page shows it, and a run whose searches were skipped reports the guard rather than "try a broader question".

## Deployment setup (Antideploy)

Added `Dockerfile`, `.dockerignore`, `scripts/start.sh` (runs the API and the frontend together, exits if either dies),
`.antideploy.json` (application link, no secrets) and `scripts/antideploy.py` (check / secrets / deploy / status / logs).
The production entry point was verified locally: both processes start, the API binds to 127.0.0.1 only, SSE streams
through the frontend, and killing the API stops the container. The Docker image itself was not built locally (no Docker
on this machine). Nothing has been deployed yet, and no secrets have been sent to the platform.
