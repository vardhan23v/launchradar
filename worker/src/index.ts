/**
 * LaunchRadar API on Cloudflare Workers. The Next.js app is frontend only and proxies /api/* here.
 * Same routes and JSON as the previous Python API, so the frontend needs no change.
 *
 * Everything here is anonymous by design (there are no accounts), so the controls are about
 * spend and shared state: a global cap on live runs, a run-sized reservation of the search budget,
 * a bounded copy rate for the recorded example, and size limits on everything a client sends.
 */
import * as config from "./config";
import { listDemos, startDemoRun } from "./demo";
import type { Env } from "./env";
import { asRunView, exportMarkdown } from "./export";
import { ensureSchema, Store } from "./store";
import { encodeEvent, followRunEvents, RETRY_MS, sseResponse } from "./stream";
import type { Run } from "./types";
import { isRecord, makeId, nowMs } from "./utils";

export { ResearchRunner } from "./runner";

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_QUESTION = 300;
const MAX_START_BODY = 16 * 1024;
const MAX_EXPORT_BODY = 2 * 1024 * 1024;
/** copies of the recorded example kept in the database (it can always be replayed) */
const DEMO_KEEP = 10;

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store", // answers are per-run and change by the second; Vercel's CDN honours this
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers } });
}

const error = (status: number, message: string) => json({ error: message }, status);

function text(body: string, status: number, contentType: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, "content-type": contentType, ...headers } });
}

class BodyTooLarge extends Error {}
class NotJson extends Error {}

/**
 * Reads a JSON body without buffering more than `limit` bytes. Returns undefined for invalid JSON.
 * The body must be declared as JSON: a cross-site form can only send text/plain or form encodings
 * without a CORS preflight, so this keeps other sites from starting runs in a visitor's browser.
 */
async function readJson(request: Request, limit: number): Promise<unknown> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new NotJson();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function bodyError(err: unknown): Response | null {
  if (err instanceof BodyTooLarge) return error(413, "Request body is too large");
  if (err instanceof NotJson) return error(415, "Send the body as application/json");
  return null;
}

interface StartRequest {
  question: string;
  region: string;
  demo: string | null;
}

function parseStart(body: unknown): StartRequest | null {
  if (!isRecord(body)) return null;
  // one line of plain text: control characters would break prompt lines and the report's headings
  const question = typeof body.question === "string"
    ? body.question.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
  const region = config.isRegion(body.region) ? body.region.toLowerCase() : "in";
  const demo = typeof body.demo === "string" ? body.demo : null;
  return { question, region, demo };
}

type Route =
  | { kind: "health" } | { kind: "runs" } | { kind: "live" } | { kind: "export-view" }
  | { kind: "run"; runId: string; sub: "view" | "stream" | "export" };

function route(path: string): Route | null {
  if (path === "/api/health") return { kind: "health" };
  if (path === "/api/runs") return { kind: "runs" };
  if (path === "/api/runs/live") return { kind: "live" };
  if (path === "/api/export") return { kind: "export-view" };
  const m = /^\/api\/runs\/([^/]+)(?:\/(stream|export))?$/.exec(path);
  if (!m) return null;
  return { kind: "run", runId: m[1], sub: (m[2] as "stream" | "export" | undefined) ?? "view" };
}

async function startRun(request: Request, env: Env, store: Store): Promise<Response> {
  let body: unknown;
  try {
    body = await readJson(request, MAX_START_BODY);
  } catch (err) {
    const res = bodyError(err);
    if (res) return res;
    throw err;
  }
  const start = parseStart(body);
  if (!start) return error(400, "Invalid JSON body");

  if (start.demo !== null) {
    if (!listDemos().some((d) => d.slug === start.demo)) return error(404, "unknown demo run");
    // the example costs no searches, but every copy writes ~100 rows: past the hourly allowance
    // the newest copy is handed out again instead of writing another
    if ((await store.demoRunsSince(nowMs() - 3_600_000)) >= config.demoRunsPerHour(env)) {
      const reuse = await store.newestDemoRunId();
      if (reuse) return json({ id: reuse, mode: "demo" }, 201);
    }
    const id = await startDemoRun(store, start.demo);
    await store.pruneDemoRuns(DEMO_KEEP);
    return json({ id, mode: "demo" }, 201);
  }
  if (!start.question) return error(400, "question is required");
  if (start.question.length > MAX_QUESTION) return error(400, `question is too long (max ${MAX_QUESTION} characters)`);

  const [ready, reason] = config.pipelineReadiness(env);
  // nothing is created, so nothing can be spent; the reason says which setting is missing
  if (!ready) return error(503, reason ?? "Pipeline is not configured.");
  // refuse before creating anything: a run that cannot finish its searches would only burn LLM calls
  if (config.serpapiMode(env) !== "replay") {
    const blocked = await store.runStartBlock();
    if (blocked) return error(429, blocked);
  }

  const runId = makeId("run");
  const run: Run = {
    id: runId, question: start.question, region: start.region, questionType: null, status: "running", budget: config.runSearchBudget(env),
    searchesUsed: 0, createdAt: nowMs(), finishedAt: null, demo: false, demoLabel: null, rejectedSignals: 0, error: null,
  };
  if (!(await store.createRunIfCapacity(run, config.concurrentRunLimit(env)))) {
    return error(429, "Another research run is in progress. Try again when it finishes (usually within ten minutes).");
  }
  try {
    await env.RUNNER.get(env.RUNNER.idFromName(runId)).start(runId, start.question, start.region);
  } catch (err) {
    const why = "The research job could not be started. Please try again.";
    if (await store.finishIfRunning(runId, { status: "failed", error: why, finishedAt: nowMs() })) {
      await store.appendEvents(runId, [
        { type: "stage", stage: "error", message: why, level: "error" },
        { type: "status", status: "failed" },
        { type: "done", runId, searchesUsed: 0 },
      ]);
    }
    console.error("runner start failed", config.scrubSecrets(err instanceof Error ? err.message : String(err), env));
    return error(503, why);
  }
  return json({ id: runId, mode: "live" }, 201);
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const r = route(path);
  if (!r) return error(404, "Not found");
  const method = request.method;

  if (r.kind === "health") {
    if (method !== "GET" && method !== "HEAD") return error(405, "Method not allowed");
    return json({ ok: true });
  }
  if (r.kind === "live") {
    // the single-request mode existed for hosts that freeze a function after the response; here runs are background jobs
    return error(410, "This host runs research in the background. POST /api/runs and follow /api/runs/{id}/stream.");
  }
  const allowed = r.kind === "export-view" ? ["POST"] : r.kind === "runs" ? ["GET", "POST"] : ["GET"];
  if (!allowed.includes(method)) return error(405, "Method not allowed");

  await ensureSchema(env.DB);
  const store = new Store(env.DB, env);

  if (r.kind === "runs") {
    if (method === "POST") return startRun(request, env, store);
    await store.failStaleRuns();
    const [ready, reason] = config.pipelineReadiness(env);
    const mode = config.serpapiMode(env);
    return json({
      runs: await store.listRuns(),
      demos: listDemos(),
      budget: { run: config.runSearchBudget(env), monthUsed: await store.billedSearchesThisMonth(), monthLimit: config.monthlySearchBudget(env) },
      // never includes a key — only whether a new question can be researched, and why not
      pipeline: { mode, ready, reason, inline: false, quota: ready && mode !== "replay" ? await store.runStartBlock() : null },
    });
  }

  if (r.kind === "export-view") {
    try {
      const body = await readJson(request, MAX_EXPORT_BODY);
      return text(exportMarkdown(asRunView(body)), 200, "text/markdown; charset=utf-8");
    } catch (err) {
      return bodyError(err) ?? error(400, "Send a complete run view as JSON.");
    }
  }

  const { runId, sub } = r;
  if (!RUN_ID.test(runId)) return sub === "view" ? error(404, "Run not found") : text("Run not found", 404, "text/plain; charset=utf-8");

  if (sub === "view") {
    const view = await store.view(runId);
    return view ? json(view) : error(404, "Run not found");
  }
  if (sub === "export") {
    const view = await store.view(runId);
    if (!view) return text("Run not found", 404, "text/plain; charset=utf-8");
    return text(exportMarkdown(view), 200, "text/markdown; charset=utf-8", { "content-disposition": `attachment; filename="launchradar-${runId}.md"` });
  }

  // stream
  if ((await store.getRun(runId)) === null) return text("Run not found", 404, "text/plain; charset=utf-8");
  // EventSource resends the last id it saw; anything that is not a small index starts from the top
  const lastId = request.headers.get("last-event-id") ?? "";
  const fromIndex = /^\d{1,6}$/.test(lastId) ? Number(lastId) + 1 : 0;
  const chunks = (async function* () {
    yield `retry: ${RETRY_MS}\n\n`;
    for await (const item of followRunEvents(store, runId, fromIndex, env, { isCancelled: () => request.signal.aborted })) yield encodeEvent(item);
  })();
  return sseResponse(chunks, request.signal);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const res = await handle(request, env);
      for (const [k, v] of Object.entries(BASE_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    } catch (err) {
      // never echo internals (or anything that could hold a key) to the browser
      console.error("unhandled", config.scrubSecrets(err instanceof Error ? err.message : String(err), env));
      return error(500, "Internal error");
    }
  },
} satisfies ExportedHandler<Env>;
