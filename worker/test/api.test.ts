import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { startDemoRun } from "../src/demo";
import type { Env } from "../src/env";
import { hashParams, toRawParams } from "../src/engines";
import worker from "../src/index";
import { BudgetExceeded, SerpApiService } from "../src/serpapi";
import { Store } from "../src/store";
import { encodeEvent, followRunEvents, PING } from "../src/stream";
import { nowMs } from "../src/utils";
import { freshStore, jsonResponse, LIVE, makeRun, REPLAY } from "./fakes";

const ORGANIC = { search_metadata: { id: "sim_1" }, organic_results: [{ title: "T", link: "https://a.com", snippet: "S" }] };

const answering = (handler: (url: URL) => Response | Promise<Response>, calls: URL[]) =>
  async (url: string) => {
    const u = new URL(url);
    calls.push(u);
    return handler(u);
  };

/** Calls the Worker with the test bindings, optionally overridden (e.g. an unconfigured pipeline). */
async function api(path: string, init: RequestInit = {}, over: Partial<Env> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://api.test${path}`, init), { ...env, ...over } as Env);
}

const postJson = (path: string, body: unknown, over: Partial<Env> = {}) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, over);

const UNCONFIGURED: Partial<Env> = { SERPAPI_MODE: "replay", SERPAPI_API_KEY: "", LLM_PROVIDER: "demo", LLM_API_KEY: "", LLM_BASE_URL: "", LLM_MODEL: "" };

describe("serpapi service", () => {
  it("budget guard throws before any cost", async () => {
    const store = await freshStore(LIVE);
    const calls: URL[] = [];
    await store.createRun(makeRun({ id: "r1", budget: 1, searchesUsed: 1 }));
    const serp = new SerpApiService(store, LIVE, null, answering(() => jsonResponse(ORGANIC), calls));
    await expect(serp.search("google", { q: "x" }, "r1", "d", 1)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toEqual([]);
    expect((await store.searchCallsFor("r1"))[0].status).toBe("skipped");
  });

  it("replay fails loudly without a fixture and replays one for free", async () => {
    const store = await freshStore(REPLAY);
    await store.createRun(makeRun({ id: "r1" }));
    const fixtures = new Map<string, unknown>();
    const serp = new SerpApiService(store, REPLAY, null, undefined, async (hash) => fixtures.get(hash) ?? null);
    await expect(serp.search("google", { q: "zzz" }, "r1", "d", 1)).rejects.toThrow(/missing fixture/);

    fixtures.set(await hashParams("google", toRawParams("google", { q: "ai tools" }, "in")), ORGANIC);
    const out = await serp.search("google", { q: "ai tools" }, "r1", "d", 2);
    expect(out.evidence[0].id).toBe("E1");
    expect(out.call.billed).toBe(false);
    expect(out.call.serpapiSearchId).toBe("sim_1");
    expect((await store.getRun("r1"))?.searchesUsed).toBe(1);
  });

  it("caches identical searches, localises by region and never persists the key", async () => {
    const settings = { ...LIVE, SERPAPI_API_KEY: "secret-key-123" };
    const store = await freshStore(settings);
    const calls: URL[] = [];
    await store.createRun(makeRun({ id: "r1", region: "us" }));
    const serp = new SerpApiService(store, settings, null, answering(() => jsonResponse(ORGANIC), calls));
    const a = await serp.search("google", { q: "x" }, "r1", "d", 1);
    const b = await serp.search("google", { q: "x" }, "r1", "d", 2);
    expect(calls).toHaveLength(1); // same params twice → one network call
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect((await store.getRun("r1"))?.searchesUsed).toBe(1);
    expect(calls[0].searchParams.get("gl")).toBe("us");
    expect(calls[0].searchParams.get("google_domain")).toBe("google.com");
    expect(calls[0].searchParams.get("api_key")).toBe("secret-key-123"); // the key travels to SerpApi only
    const dump = JSON.stringify((await env.DB.prepare("SELECT data, rows FROM search_calls").all()).results);
    expect(dump).not.toContain("secret-key-123"); // the key is never persisted

    // a unit retried after a crash gets the recorded answer instead of a third search
    const again = await serp.search("google", { q: "x" }, "r1", "d", 2);
    expect(again.call.id).toBe("sc_r1_2");
    expect(again.evidence.map((e) => e.id)).toEqual(b.evidence.map((e) => e.id));
    expect(await store.searchCallsFor("r1")).toHaveLength(2);
  });

  it("retries on 5xx only and scrubs the key from errors", async () => {
    const store = await freshStore(LIVE);
    await store.createRun(makeRun({ id: "r1" }));
    const calls: URL[] = [];
    const answers = [jsonResponse("boom", 503), jsonResponse({})];
    await new SerpApiService(store, LIVE, null, answering(() => answers.shift() as Response, calls)).search("google", { q: "five" }, "r1", "d", 1);
    expect(calls).toHaveLength(2);

    const calls2: URL[] = [];
    const serp = new SerpApiService(store, LIVE, null, answering(() => new Response("bad key api_key=serp-secret", { status: 401 }), calls2));
    await expect(serp.search("google", { q: "four" }, "r1", "d", 2)).rejects.toThrow(/401/);
    expect(calls2).toHaveLength(1);
    const failed = (await store.searchCallsFor("r1")).find((c) => c.status === "failed");
    expect(failed?.billed).toBe(false);
    expect(failed?.error).not.toContain("serp-secret");
    expect(failed?.error).toContain("[redacted]");
  });

  it("counts billed searches against the monthly budget across runs", async () => {
    const settings = { ...LIVE, MONTHLY_SEARCH_BUDGET: "1" };
    const store = await freshStore(settings);
    const calls: URL[] = [];
    await store.createRun(makeRun({ id: "r1" }));
    await store.createRun(makeRun({ id: "r2" }));
    const serp = new SerpApiService(store, settings, null, answering(() => jsonResponse({}), calls));
    await serp.search("google", { q: "one" }, "r1", "d", 1);
    await expect(serp.search("google", { q: "two" }, "r2", "d", 1)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toHaveLength(1);
  });
});

async function collect(store: Awaited<ReturnType<typeof freshStore>>, runId: string, fromIndex = 0, stopAfter: number | null = null) {
  const seen: [number, string][] = [];
  for await (const item of followRunEvents(store, runId, fromIndex, env, { isCancelled: () => stopAfter !== null && seen.length >= stopAfter, windowMs: 10_000, pollMs: 10 })) {
    if (item !== PING) seen.push([item[0], item[1].type]);
  }
  return seen;
}

describe("stream", () => {
  it("never completes a live run", async () => {
    const store = await freshStore(LIVE);
    await store.createRun(makeRun({ id: "r1" }));
    await store.appendEvents("r1", [{ type: "stage", stage: "planner", message: "m", level: "info" }]);
    expect(await collect(store, "r1", 0, 1)).toEqual([[0, "stage"]]);
    expect((await store.getRun("r1"))?.status).toBe("running");
  });

  it("replays a demo, completes it and resumes from Last-Event-ID", async () => {
    const store = await freshStore(LIVE);
    const runId = await startDemoRun(store, "ai-tools-college-india");
    const seen = await collect(store, runId);
    expect((await store.getRun(runId))?.status).toBe("complete");
    expect(seen.map(([i]) => i)).toEqual(seen.map((_, i) => i));
    expect(seen.at(-1)?.[1]).toBe("done");
    expect(await collect(store, runId, seen.length - 2)).toEqual(seen.slice(-2));
  });

  it("hands a slow paced replay over to the reconnect instead of holding one request", async () => {
    const store = await freshStore(LIVE);
    const runId = await startDemoRun(store, "ai-tools-college-india");
    const first: number[] = [];
    for await (const item of followRunEvents(store, runId, 0, env, { windowMs: 1 })) if (item !== PING) first.push(item[0]);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(26);
    expect((await store.getRun(runId))?.status).toBe("running"); // not completed by a cut-off viewer
    const rest = await collect(store, runId, first[first.length - 1] + 1);
    expect(rest.at(-1)?.[1]).toBe("done");
    expect(rest[0][0]).toBe(first[first.length - 1] + 1);
  });

  it("sends heartbeats while a live run is silent and hands over after its window", async () => {
    const store = await freshStore(LIVE);
    await store.createRun(makeRun({ id: "quiet" }));
    await store.appendEvents("quiet", [{ type: "stage", stage: "planner", message: "m", level: "info" }]);
    const seen: string[] = [];
    for await (const item of followRunEvents(store, "quiet", 0, env, { isCancelled: () => seen.length >= 3, heartbeatMs: 5, pollMs: 5 })) seen.push(encodeEvent(item));
    expect(seen[0].startsWith("id: 0\n")).toBe(true);
    expect(seen.slice(1)).toEqual([": ping\n\n", ": ping\n\n"]);
    // the window closes the response so the next reconnect gets a fresh invocation
    const windowed: string[] = [];
    for await (const item of followRunEvents(store, "quiet", 1, env, { windowMs: 30, heartbeatMs: 1000, pollMs: 5 })) windowed.push(encodeEvent(item));
    expect(windowed).toEqual([]);
    expect((await store.getRun("quiet"))?.status).toBe("running");
  });
});

describe("api routes", () => {
  it("validate input, replay the example and export it", async () => {
    await freshStore();
    const home = await (await api("/api/runs", {}, UNCONFIGURED)).json() as { pipeline: { ready: boolean; inline: boolean }; demos: { searches: number }[] };
    expect(home.pipeline.ready).toBe(false);
    expect(home.pipeline.inline).toBe(false);
    expect(home.demos[0].searches).toBe(8);
    expect((await api("/api/runs/nope")).status).toBe(404);
    expect((await api("/api/runs/nope/stream")).status).toBe(404);
    expect((await api("/api/runs/nope/export")).status).toBe(404);
    expect((await api("/api/runs/%2e%2e%2fpackage")).status).toBe(404);
    expect((await postJson("/api/runs", { demo: "../../package" })).status).toBe(404);
    expect((await postJson("/api/runs", { demo: "constructor" })).status).toBe(404);
    expect((await postJson("/api/runs", {})).status).toBe(400);
    expect((await api("/api/runs", { method: "POST", body: "{bad" })).status).toBe(415); // not declared as JSON
    expect((await api("/api/runs", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"demo":"ai-tools-college-india"}' })).status).toBe(415);
    expect((await api("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" })).status).toBe(400);
    expect((await postJson("/api/runs", { question: "x".repeat(301) })).status).toBe(400);
    expect((await postJson("/api/runs", { question: "x".repeat(20_000) })).status).toBe(413);
    expect((await api("/api/runs/live", { method: "POST", body: "{}" })).status).toBe(410);
    expect((await api("/api/health", { method: "DELETE" })).status).toBe(405);
    expect((await api("/api/runs/x", { method: "HEAD" })).status).toBe(405);
    expect((await api("/api/export", { method: "GET" })).status).toBe(405);
    expect((await api("/nope")).status).toBe(404);

    // an unconfigured server refuses before creating anything
    const refused = await postJson("/api/runs", { question: "meal kits", region: "us" }, UNCONFIGURED);
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: string }).error).toContain("LLM_PROVIDER");
    expect(((await (await api("/api/runs")).json()) as { runs: unknown[] }).runs).toEqual([]);

    const demo = await (await postJson("/api/runs", { demo: "ai-tools-college-india" })).json() as { id: string };
    // a resume id that is not a small index starts from the top instead of being trusted
    const huge = await (await api(`/api/runs/${demo.id}/stream`, { headers: { "last-event-id": "99999999999999999999" } })).text();
    expect(huge).toContain("id: 0\n");
    const stream = await api(`/api/runs/${demo.id}/stream`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("cache-control")).toBe("no-cache, no-transform"); // the stream keeps its own
    const body = await stream.text();
    expect((body.match(/^id: /gm) ?? []).length).toBeGreaterThanOrEqual(25);
    expect(body).toContain('"type":"done"');
    const view = await (await api(`/api/runs/${demo.id}`)).json() as { run: { status: string }; evidence: unknown[]; searchCalls: { params: Record<string, unknown> }[] };
    expect(view.run.status).toBe("complete");
    expect(view.evidence).toHaveLength(34);
    expect(view.searchCalls.every((c) => !("__rows" in c.params))).toBe(true);
    const md = await api(`/api/runs/${demo.id}/export`);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toContain(demo.id);
    expect(await md.text()).toContain("## Opportunities (ranked)");

    // the browser can export what it holds, with no run on the server
    const exported = await postJson("/api/export", view);
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain("## Opportunities (ranked)");
    expect((await postJson("/api/export", { nope: 1 })).status).toBe(400);
    expect((await postJson("/api/export", { run: { id: "x", question: "q", region: "in", createdAt: 1, searchesUsed: 0, budget: 1 }, evidence: "no" })).status).toBe(400);
    const run = { id: "x", question: "q\n# injected heading", region: "in", createdAt: 1, finishedAt: null, searchesUsed: 0, budget: 1 };
    expect((await postJson("/api/export", { run, opportunities: Array.from({ length: 2001 }, () => ({})) })).status).toBe(400);
    const oneLine = await (await postJson("/api/export", { run, evidence: [{ id: "E1", title: "a\nb", url: "https://x.test", snippet: "s" }] })).text();
    expect(oneLine).toContain("# LaunchRadar — q # injected heading");
    expect(oneLine).not.toMatch(/^# injected/m);
  });

  it("refuses up front when the hourly quota is used and never caches answers", async () => {
    const store = await freshStore({ ...LIVE, HOURLY_SEARCH_GUARD: "2" });
    const now = nowMs();
    expect(await store.quotaBlock(now)).toBeNull();
    for (const [billed, at] of [[true, now - 50 * 60_000], [true, now - 5 * 60_000], [false, now]] as const) {
      await store.addSearchCall({
        id: `sc_x_${at}`, runId: "x", stage: "d", engine: "google", params: {}, paramsHash: "h", cached: !billed, status: "ok", latencyMs: 0, resultCount: 0, createdAt: at, billed,
      }, null); // cache hits never count
    }
    expect(await store.quotaBlock(now)).toContain("about 10 minutes");

    const over: Partial<Env> = { HOURLY_SEARCH_GUARD: "2" };
    const res = await postJson("/api/runs", { question: "meal kits" }, over);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain("hourly search limit");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await store.listRuns()).toEqual([]); // nothing was created, no LLM call was spent
    const home = await api("/api/runs", {}, over);
    expect(home.headers.get("cache-control")).toBe("no-store");
    expect(((await home.json()) as { pipeline: { quota: string } }).pipeline.quota).toContain("hourly");
    expect((await api("/api/health")).headers.get("cache-control")).toBe("no-store");
    // the recorded example costs nothing, so it still works
    expect((await postJson("/api/runs", { demo: "ai-tools-college-india" }, over)).status).toBe(201);
  });
});

describe("spend and shared-state guards", () => {
  it("lets only one live run in at a time, ignoring runs left behind", async () => {
    const store = await freshStore(LIVE);
    const now = 10_000_000_000;
    expect(await store.createRunIfCapacity(makeRun({ id: "a", createdAt: now }), 1, now)).toBe(true);
    expect(await store.createRunIfCapacity(makeRun({ id: "b", createdAt: now }), 1, now)).toBe(false);
    expect(await store.getRun("b")).toBeNull();
    // a run that has shown nothing for 40 minutes no longer holds the slot
    expect(await store.createRunIfCapacity(makeRun({ id: "c", createdAt: now + 41 * 60_000 }), 1, now + 41 * 60_000)).toBe(true);
    // two simultaneous attempts: exactly one gets in
    const results = await Promise.all(["d", "e"].map((id) => store.createRunIfCapacity(makeRun({ id, createdAt: now + 42 * 60_000 }), 2, now + 42 * 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("reserves a whole run's searches before starting one", async () => {
    const settings = { ...LIVE, MONTHLY_SEARCH_BUDGET: "30", HOURLY_SEARCH_GUARD: "40" };
    const store = await freshStore(settings);
    const now = nowMs();
    const billed = (n: number, at: number) => Promise.all(Array.from({ length: n }, (_, i) => store.addSearchCall({
      id: `sc_x_${at}_${i}`, runId: "x", stage: "d", engine: "google", params: {}, paramsHash: "h", cached: false, status: "ok", latencyMs: 0, resultCount: 0, createdAt: at, billed: true,
    }, null)));
    expect(await store.runStartBlock(now)).toBeNull();
    await billed(10, now - 30 * 60_000);
    expect(await store.runStartBlock(now)).toContain("cannot cover another run"); // 10 + 25 > 30
    const roomy = await freshStore({ ...LIVE, HOURLY_SEARCH_GUARD: "40" });
    await billed(20, now - 50 * 60_000);
    expect(await roomy.runStartBlock(now)).toContain("about 10 minutes"); // 20 + 25 > 40 until 5 expire
    expect(await new Store(env.DB, { ...LIVE, MONTHLY_SEARCH_BUDGET: "0" }).runStartBlock(now)).toContain("used up"); // 0 stops spending
  });

  it("writes a bounded number of copies of the example and keeps every copy working", async () => {
    const store = await freshStore(LIVE);
    const over: Partial<Env> = { DEMO_RUNS_PER_HOUR: "2" };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(((await (await postJson("/api/runs", { demo: "ai-tools-college-india" }, over)).json()) as { id: string }).id);
    expect(new Set(ids).size).toBe(2); // the third request is handed the newest copy
    expect(ids[2]).toBe(ids[1]);
    for (const id of new Set(ids)) {
      const body = await (await api(`/api/runs/${id}/stream`)).text();
      expect(body).toContain('"type":"done"');
      const view = await (await api(`/api/runs/${id}`)).json() as { evidence: { searchCallId: string }[]; searchCalls: { id: string }[] };
      expect(view.evidence).toHaveLength(34);
      expect(view.searchCalls.every((c) => c.id.startsWith(`sc_${id}_`))).toBe(true);
      expect(view.evidence.every((e) => e.searchCallId.startsWith(`sc_${id}_`))).toBe(true);
    }
    // only one ending per run, however many viewers reach it
    const events = await store.eventsFor(ids[0]);
    expect(events.filter(([, e]) => e.type === "done")).toHaveLength(1);
    // old copies are pruned
    await store.pruneDemoRuns(1);
    expect(await store.getRun(ids[0])).toBeNull();
    expect(await store.evidenceFor(ids[0])).toEqual([]);
    expect(await store.getRun(ids[1])).not.toBeNull();
  });

  it("accepts only real regions and one-line questions", async () => {
    const { isRegion, regionName } = await import("../src/config");
    expect(isRegion("constructor")).toBe(false);
    expect(isRegion("__proto__")).toBe(false);
    expect(isRegion("UK")).toBe(true);
    expect(regionName("constructor")).toBe("CONSTRUCTOR");
  });
});
