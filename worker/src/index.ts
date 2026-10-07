/**
 * LaunchRadar API on Cloudflare Workers. The Next.js app is frontend only and proxies /api/* here.
 * Same routes and JSON as the previous Python API, so the frontend needs no change.
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
const MAX_EXPORT_BODY = 4 * 1024 * 1024;

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

/** Reads a JSON body without buffering more than `limit` bytes. Returns undefined for invalid JSON. */
async function readJson(request: Request, limit: number): Promise<unknown> {
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

interface StartRequest {
  question: string;
  region: string;
  demo: string | null;
}

function parseStart(body: unknown): StartRequest | null {
  if (!isRecord(body)) return null;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const region = config.isRegion(body.region) ? body.region.toLowerCase() : "in";
  const demo = typeof body.demo === "string" ? body.demo : null;
  return { question, region, demo };
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/api/")) return error(404, "Not found");
  await ensureSchema(env.DB);
  const store = new Store(env.DB, env);
  const method = request.method;

  if (path === "/api/health") {
    if (method !== "GET" && method !== "HEAD") return error(405, "Method not allowed");
    return json({ ok: true });
  }

  if (path === "/api/runs") {
    if (method === "GET") {
      await store.failStaleRuns();
      const [ready, reason] = config.pipelineReadiness(env);
      const mode = config.serpapiMode(env);
      return json({
        runs: await store.listRuns(),
        demos: listDemos(),
        budget: { run: config.runSearchBudget(env), monthUsed: await store.billedSearchesThisMonth(), monthLimit: config.monthlySearchBudget(env) },
        // never includes a key — only whether a new question can be researched, and why not
        pipeline: { mode, ready, reason, inline: false, quota: mode !== "replay" ? await store.quotaBlock() : null },
      });
    }
    if (method !== "POST") return error(405, "Method not allowed");
    let body: unknown;
    try {
      body = await readJson(request, MAX_START_BODY);
    } catch (err) {
      if (err instanceof BodyTooLarge) return error(413, "Request body is too large");
      throw err;
    }
    const start = parseStart(body);
    if (!start) return error(400, "Invalid JSON body");

    if (start.demo !== null) {
      if (!listDemos().some((d) => d.slug === start.demo)) return error(404, "unknown demo run");
      return json({ id: await startDemoRun(store, start.demo), mode: "demo" }, 201);
    }
    if (!start.question) return error(400, "question is required");
    if (start.question.length > MAX_QUESTION) return error(400, `question is too long (max ${MAX_QUESTION} characters)`);

    // refuse before creating anything: a run that cannot search would only burn LLM calls and fail
    if (config.serpapiMode(env) !== "replay") {
      const blocked = await store.quotaBlock();
      if (blocked) return error(429, blocked);
    }

    const runId = makeId("run");
    const run: Run = {
      id: runId, question: start.question, region: start.region, questionType: null, status: "running", budget: config.runSearchBudget(env),
      searchesUsed: 0, createdAt: nowMs(), finishedAt: null, demo: false, demoLabel: null, rejectedSignals: 0, error: null,
    };
    await store.createRun(run);
    const [ready, reason] = config.pipelineReadiness(env);
    if (!ready) {
      // fail fast with guidance instead of leaving a run that never progresses
      const why = reason ?? "Pipeline is not configured.";
      await store.updateRun(runId, { status: "failed", error: why, finishedAt: nowMs() });
      await store.appendEvents(runId, [
        { type: "stage", stage: "error", message: why, level: "error" },
        { type: "status", status: "failed" },
        { type: "done", runId, searchesUsed: 0 },
      ]);
      return json({ id: runId, mode: "failed" }, 201);
    }
    try {
      await env.RUNNER.get(env.RUNNER.idFromName(runId)).start(runId, start.question, start.region);
    } catch (err) {
      const why = "The research job could not be started. Please try again.";
      await store.updateRun(runId, { status: "failed", error: why, finishedAt: nowMs() });
      await store.appendEvents(runId, [{ type: "stage", stage: "error", message: why, level: "error" }, { type: "status", status: "failed" }, { type: "done", runId, searchesUsed: 0 }]);
      console.error("runner start failed", err instanceof Error ? err.message : String(err));
      return error(503, why);
    }
    return json({ id: runId, mode: "live" }, 201);
  }

  if (path === "/api/runs/live") {
    // the single-request mode existed for hosts that freeze a function after the response; here runs are background jobs
    return error(410, "This host runs research in the background. POST /api/runs and follow /api/runs/{id}/stream.");
  }

  if (path === "/api/export") {
    if (method !== "POST") return error(405, "Method not allowed");
    try {
      const body = await readJson(request, MAX_EXPORT_BODY);
      return text(exportMarkdown(asRunView(body)), 200, "text/markdown; charset=utf-8");
    } catch (err) {
      if (err instanceof BodyTooLarge) return error(413, "Request body is too large");
      return error(400, "Send a complete run view as JSON.");
    }
  }

  const m = /^\/api\/runs\/([^/]+)(?:\/(stream|export))?$/.exec(path);
  if (!m) return error(404, "Not found");
  const [, runId, sub] = m;
  if (method !== "GET" && method !== "HEAD") return error(405, "Method not allowed");
  if (!RUN_ID.test(runId)) return sub === "export" ? text("Run not found", 404, "text/plain; charset=utf-8") : error(404, "Run not found");

  if (sub === undefined) {
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
  const lastId = Number.parseInt(request.headers.get("last-event-id") ?? "", 10); // EventSource resends the last id it saw
  const fromIndex = Number.isFinite(lastId) ? lastId + 1 : 0;
  const chunks = (async function* () {
    yield `retry: ${RETRY_MS}\n\n`;
    for await (const item of followRunEvents(store, runId, fromIndex, env, { isCancelled: () => request.signal.aborted })) yield encodeEvent(item);
  })();
  void ctx;
  return sseResponse(chunks, request.signal);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const res = await handle(request, env, ctx);
      for (const [k, v] of Object.entries(BASE_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    } catch (err) {
      // never echo internals (or anything that could hold a key) to the browser
      console.error("unhandled", err instanceof Error ? err.message : String(err));
      return error(500, "Internal error");
    }
  },
} satisfies ExportedHandler<Env>;
