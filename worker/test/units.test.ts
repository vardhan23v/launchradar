import { describe, expect, it } from "vitest";

import { knownIds, validateSignals, verifyQuote } from "../src/citations";
import * as config from "../src/config";
import { loadFixture } from "../src/demo";
import { hashParams, toRawParams } from "../src/engines";
import { LlmClient, LlmError, parseJson } from "../src/llm";
import { normalise } from "../src/normalise";
import { cleanQuery, MAX_EXTRACT_ROWS, selectForExtraction, summariseOutcome, trendSlope } from "../src/pipeline";
import { computeScore, type ScoreInput } from "../src/score";
import { ensureSchema, INTERRUPTED, resetSchemaCache, Store } from "../src/store";
import type { Evidence, StepEvent } from "../src/types";
import { citeGroups, keepKnownCitations, parseSerpDate } from "../src/utils";
import { PipelineError, publicMessage } from "../src/pipeline";
import { BudgetExceeded } from "../src/serpapi";
import { env } from "cloudflare:test";

import { freshStore, jsonResponse, LIVE, makeRun } from "./fakes";

const EV = [{ id: "E1", title: "Thread", snippet: "The app   glitches on Indian school content", text: null }];

describe("citations", () => {
  it("reject unknown ids and paraphrases", () => {
    expect(verifyQuote(["E1"], "glitches on indian SCHOOL content", EV)[0]).toBe(true); // case/whitespace normalised
    expect(verifyQuote(["E404"], "glitches", EV)[0]).toBe(false);
    expect(verifyQuote(["E1"], "crashes on school content", EV)[0]).toBe(false);
    expect(verifyQuote(["E1"], "  ", EV)[0]).toBe(false);
    const [valid, rejected] = validateSignals([{ evidenceIds: ["E1"], quote: "glitches" }, { evidenceIds: ["E9"], quote: "x" }], EV);
    expect(valid).toHaveLength(1);
    expect(rejected).toBe(1);
  });

  it("ignores unknown ids wherever they appear, but never lets them through", () => {
    // a real id with a fabricated one beside it: the quote is still checked against the real row
    expect(verifyQuote(["E1", "E9999"], "glitches on Indian school content", EV)[0]).toBe(true);
    expect(verifyQuote(["E9999", "E1"], "glitches on Indian school content", EV)[0]).toBe(true);
    expect(verifyQuote(["E1", "E9999"], "crashes on school content", EV)[0]).toBe(false);
    expect(verifyQuote(["E9999", "E8888"], "glitches", EV)).toEqual([false, "unknown evidence id E9999, E8888"]);
    expect(verifyQuote([], "glitches", EV)[1]).toBe("no evidence id given");
    // what gets stored is only what the run contains
    expect(knownIds(["E9999", "E1", 7, "E1"], EV)).toEqual(["E1", "E1"]);
  });

  it("does not let a quote straddle the title and the snippet", () => {
    // "Thread" ends the title and "The app" starts the snippet: joined text once read "thread the app"
    expect(verifyQuote(["E1"], "Thread The app", EV)[0]).toBe(false);
    expect(verifyQuote(["E1"], "Thread", EV)[0]).toBe(true);
    expect(verifyQuote(["E1"], "The app glitches", EV)[0]).toBe(true);
  });
});

describe("run outcome", () => {
  const call = (stage: string, status: "ok" | "failed" | "skipped", error?: string) => ({ stage, status, error });
  const timedOut = (n: number) => Array.from({ length: n }, () => call("discovery", "failed", "The web lookup took too long"));
  const fine = (n: number, stage = "discovery") => Array.from({ length: n }, () => call(stage, "ok"));

  it("says plainly when searches failed and nothing was found", () => {
    const r = summariseOutcome([...timedOut(9), ...fine(7)], [], 0, 2, 5, 424_700);
    expect(r).toMatchObject({ outcome: "empty", searchCalls: 16, failedSearches: 9, level: "warn" });
    expect(r.message).toBe("Done, but with less proof than usual: 9 of 16 lookups didn't work (the web lookup took too long), so 0 ideas found.");
    // one opportunity, one failed discovery search → limited
    const one = summariseOutcome([...timedOut(1), ...fine(15)], [{ status: "open" }], 1, 0, 5, 1000);
    expect(one.outcome).toBe("limited");
    expect(one.message).toBe("Done, but with less proof than usual: 1 of 16 lookups didn't work (the web lookup took too long), so 1 idea found.");
    // the validator throwing away most signals is limited evidence too
    const rejected = summariseOutcome(fine(16), [{ status: "open" }], 2, 9, 4, 1000);
    expect(rejected.outcome).toBe("limited");
    expect(rejected.message).toBe("Done, but with less proof than usual: 9 of 13 complaints were dropped because we couldn't find their exact words on the page, so 2 ideas found.");
    // mixed reasons name the most common one
    const mixed = summariseOutcome([...timedOut(2), call("competitors", "failed", "The web lookup service said no (429): too many lookups."), ...fine(5)], [], 1, 0, 3, 1000);
    expect(mixed.message).toContain("3 of 8 lookups didn't work (the web lookup took too long, among other reasons)");
  });

  it("is full when every evidence search answered, and explains an empty result", () => {
    const full = summariseOutcome(fine(16), [{ status: "open" }], 2, 1, 5, 1000);
    expect(full).toMatchObject({ outcome: "full", failedSearches: 0, level: "ok" });
    expect(full.message).toBe("Done in 1.0s: 2 ideas from 16 lookups.");
    // a lost kill query or trends call does not limit the evidence, but it is counted
    const verify = summariseOutcome([...fine(15), call("verify", "failed", "The web lookup took too long")], [{ status: "open" }], 1, 0, 5, 1000);
    expect(verify.outcome).toBe("full");
    expect(verify.message).toBe("Done in 1.0s: 1 idea from 16 lookups (1 didn't work).");
    const served = summariseOutcome(fine(16), [{ status: "served" }, { status: "served" }], 0, 0, 5, 2500);
    expect(served.outcome).toBe("empty");
    expect(served.message).toBe("Done in 2.5s, but no idea was found: someone already solves each one.");
    expect(summariseOutcome(fine(16), [], 0, 0, 5, 2500).message).toContain("we couldn't work out what's missing");
  });
});

function score(over: Partial<ScoreInput> = {}) {
  return computeScore({
    signals: [{ intensity: 4, domains: ["reddit.com", "play.google.com"] }], trendSlope: null, recentNewsCount: 0, adsCount: 0,
    hasPricedCompetitors: false, jobsCount: 0, gapStatus: "open", directCompetitors: 0, weakCompetitorShare: 0, evidenceCount: 10,
    distinctDomains: 2, blockTypeCount: 2, ...over,
  });
}

describe("score", () => {
  it("matches the table", () => {
    const strong = score({
      signals: [{ intensity: 5, domains: ["a.com", "b.com", "c.com", "d.com"] }, { intensity: 4, domains: ["a.com"] }],
      trendSlope: 0.8, recentNewsCount: 2, adsCount: 4, hasPricedCompetitors: true, evidenceCount: 30, distinctDomains: 4, blockTypeCount: 3,
    });
    expect(strong.total).toBeGreaterThan(60);
    expect(strong.confidence).toBe("High");
    // missing inputs score 0 for that term — never imputed
    expect(score().subScores.momentum).toBe(0);
    expect(score().subScores.commercial).toBe(0);
    expect(score({ signals: [] }).subScores.pain).toBe(0);
    // whitespace: open > partially-served > served, and crowding shrinks it
    expect(["open", "partially-served", "served"].map((s) => score({ gapStatus: s }).subScores.whitespace)).toEqual([20, 10, 2]);
    expect(score({ directCompetitors: 8 }).subScores.whitespace).toBe(0);
    expect(score({ trendSlope: 5 }).subScores.momentum).toBe(20); // clamped
    expect(score().confidence).toBe("Low");
    expect(Object.values(config.SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("normalise", () => {
  it("treats every block as optional", () => {
    expect(normalise("google", {})).toEqual([]);
    expect(normalise("google", { organic_results: "nonsense", related_questions: null })).toEqual([]);
    expect(normalise("google_trends", { interest_over_time: [] })).toEqual([]);
    const rows = normalise("google", {
      organic_results: [{ position: 1, title: "T", link: "https://www.a.com/x", snippet: "S" }],
      related_questions: [{ question: "Why?", snippet: "Because", link: "https://b.com" }],
      discussions_and_forums: [{ title: "Thread", link: "https://reddit.com/r/x", answers: [{ snippet: "It broke for me" }] }],
      ads: [{ title: "Ad", link: "https://ad.com", snippet: "Buy" }],
    });
    expect(rows.map((r) => r.blockType)).toEqual(["organic", "related_question", "forum", "ad"]);
    expect(rows[0].domain).toBe("a.com");
    expect(rows[2].snippet).toBe("It broke for me");
  });

  it("reads trends and news in the documented shape", () => {
    const rows = normalise("google_trends", {
      interest_over_time: { timeline_data: [{ date: "Sep 1 – 7, 2025", timestamp: "1756684800", values: [{ query: "AI Tutor", value: "38", extracted_value: 38 }] }] },
      related_queries: { rising: [{ query: "ai tutor for board exams", value: "+250%", extracted_value: 250 }] },
    });
    expect(rows[0].meta.values).toEqual({ "ai tutor": 38 });
    expect(parseSerpDate(rows[0].date)).toBe(1756684800000);
    expect(rows[1].blockType).toBe("rising_query");
    const news = normalise("google_news", { news_results: [{ title: "Cluster", stories: [{ title: "A", link: "https://x.com/a", iso_date: "2026-01-02T15:30:13Z" }] }] });
    expect(news[0].title).toBe("A");
    expect(news[0].date).toBe("2026-01-02T15:30:13Z");
    expect(normalise("google_news", { news_results: Array.from({ length: 80 }, (_, i) => ({ title: `N${i}`, link: `https://n.com/${i}` })) })).toHaveLength(15);
  });
});

describe("engines", () => {
  it("hashes params without the key and seeds region defaults", async () => {
    const a = await hashParams("google", { q: "x", gl: "in", api_key: "k1" });
    expect(a).toBe(await hashParams("google", { gl: "in", q: "x", api_key: "k2", __rows: [1] }));
    expect(a).toHaveLength(16);
    expect(toRawParams("google_trends", { q: "x" }, "uk").geo).toBe("GB");
    expect(toRawParams("google", { q: "x", gl: "de" }, "us").gl).toBe("de"); // explicit params win
    expect(toRawParams("youtube", { search_query: "x" }, "us")).not.toHaveProperty("google_domain");
  });
});

describe("helpers", () => {
  it("parse dates, slopes, loose JSON and citations", () => {
    const now = Date.UTC(2026, 8, 18);
    expect(parseSerpDate("01/02/2026, 10:30 PM, +0700 +07")).toBe(Date.UTC(2026, 0, 2, 22, 30));
    expect(parseSerpDate("3 days ago", now)).toBe(now - 3 * 86_400_000);
    expect(parseSerpDate("Mar 5, 2026")).not.toBeNull();
    expect(parseSerpDate("2026-03-05T10:00:00+05:30")).toBe(Date.UTC(2026, 2, 5, 4, 30));
    expect(parseSerpDate("not a date")).toBeNull();

    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `E${i}`, runId: "r", searchCallId: "s", blockType: "trend_point", title: "", url: "", domain: "", snippet: "", position: i,
      date: new Date(Date.UTC(2025, i, 1)).toISOString(), meta: { values: { "ai tutor": i < 3 ? 20 : i > 8 ? 40 : 30 } },
    })) as Evidence[];
    expect(Math.abs((trendSlope(rows, "AI Tutor") as number) - 1.0)).toBeLessThan(1e-9);
    expect(trendSlope(rows, "unknown")).toBeNull();

    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here: {"a":2} thanks')).toEqual({ a: 2 });
    expect(parseJson("nonsense")).toBeNull();

    expect(citeGroups("x [E1,E22] y")[0].ids).toEqual(["E1", "E22"]);
    // letter-suffixed ids (the recorded example splits some results into E9 and E9b) and spaces
    expect(citeGroups("x [E9,E9b] y [E10b, E2]")[0].ids).toEqual(["E9", "E9b"]);
    expect(citeGroups("x [E9,E9b] y [E10b, E2]")[1].ids).toEqual(["E10b", "E2"]);
    expect(keepKnownCitations("Fact [E9, E9b, E77].", new Set(["E9", "E9b"]))).toBe("Fact [E9,E9b].");
    expect(keepKnownCitations("Fact [E1,E99]. Other [E98].", new Set(["E1"]))).toBe("Fact [E1]. Other.");
  });

  it("cleans planner queries and favours user voice for extraction", () => {
    expect(cleanQuery("Quora question: best AI note‑taking app for engineering students")).toBe("best AI note-taking app for engineering students quora");
    expect(cleanQuery("Reddit discussion on AI plagiarism detection tools")).toBe("AI plagiarism detection tools reddit");
    expect(cleanQuery("Google News: recent regulation on AI in higher education")).toBe("recent regulation on AI in higher education");
    expect(cleanQuery("ai tools for students reddit")).toBe("ai tools for students reddit"); // already a real query

    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `E${i}`, blockType: "news", position: i }));
    rows.push({ id: "F1", blockType: "forum", position: 1 }, { id: "Q1", blockType: "related_question", position: 1 });
    const picked = selectForExtraction(rows);
    expect(picked).toHaveLength(MAX_EXTRACT_ROWS);
    expect(picked.slice(0, 2).map((r) => r.id)).toEqual(["F1", "Q1"]);
  });
});

describe("demo fixture", () => {
  it("is internally consistent", () => {
    const f = loadFixture("ai-tools-college-india");
    expect(f).not.toBeNull();
    const ev = f!.evidence as Evidence[];
    expect(validateSignals(f!.signals, ev)[1]).toBe(0);
    for (const c of f!.competitors) for (const x of c.complaints) expect(verifyQuote([x.evidenceId], x.quote, ev)[0]).toBe(true);
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    const signalIds = new Set(f!.signals.map((s) => s.id));
    expect(f!.clusters.every((c) => c.signalIds.every((i) => signalIds.has(i)))).toBe(true);
    const clusterIds = new Set(f!.clusters.map((c) => c.id));
    expect(f!.gaps.every((g) => clusterIds.has(g.clusterId))).toBe(true);
    expect(loadFixture("../../package")).toBeNull();
    expect(loadFixture("constructor")).toBeNull();
  });
});

describe("llm client", () => {
  it("speaks to an OpenAI-compatible gateway with the key in a header", async () => {
    const base = { LLM_PROVIDER: "openai", LLM_API_KEY: "sk-test", LLM_BASE_URL: "https://gateway.example/v1/" };
    expect(config.pipelineReadiness(base)).toEqual([false, "The writing helper has an address but no model name (LLM_BASE_URL is set, so LLM_MODEL is needed too)."]);
    const settings = { ...base, LLM_MODEL: "some-model" };
    expect(config.pipelineReadiness(settings)).toEqual([true, null]); // replay mode needs no SerpApi key

    const seen: { url: string; auth: string; body: Record<string, unknown> } = { url: "", auth: "", body: {} };
    const client = new LlmClient(settings, null, async (url, init) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).authorization;
      seen.body = JSON.parse(String(init.body));
      return jsonResponse({ choices: [{ message: { content: '{"type": "b2b"}' } }] });
    });
    expect(await client.complete("planner", "d", "p", (v) => (v as { type: string }).type)).toBe("b2b");
    expect(seen.url).toBe("https://gateway.example/v1/chat/completions");
    expect(seen.auth).toBe("Bearer sk-test");
    expect(seen.body.model).toBe("some-model");
    expect(seen.body).toHaveProperty("response_format");

    const off = new LlmClient({ ...settings, LLM_JSON_MODE: "off" }, null, async (_url, init) => {
      seen.body = JSON.parse(String(init.body));
      return jsonResponse({ choices: [{ message: { content: '{"type": "b2b"}' } }] });
    });
    await off.complete("planner", "d", "p", (v) => (v as { type: string }).type);
    expect(seen.body).not.toHaveProperty("response_format");
  });

  it("waits and retries on rate limits, then fails loudly", async () => {
    const settings = { LLM_PROVIDER: "openai", LLM_API_KEY: "gsk_test" };
    const ok = () => jsonResponse({ choices: [{ message: { content: '{"ok": true}' } }] });
    const answers = [jsonResponse("slow down", 429, { "retry-after": "2" }), jsonResponse("slow down", 429), ok()];
    const waits: number[] = [], events: StepEvent[] = [];
    const client = new LlmClient(settings, (e) => { events.push(e); }, async () => answers.shift() as Response);
    client.sleepImpl = async (ms) => { waits.push(ms); };
    expect(await client.complete("selftest", "d", "p", (v) => (v as { ok: boolean }).ok)).toBe(true);
    // honours retry-after, otherwise backs off; up to half a second of jitter keeps runs out of lockstep
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(waits[0]).toBeLessThan(2500);
    expect(waits[1]).toBeGreaterThanOrEqual(10000);
    expect(waits[1]).toBeLessThan(10500);
    expect(events.filter((e) => e.type === "stage" && e.level === "warn")).toHaveLength(2);

    // a provider that never recovers fails loudly instead of hanging the run
    const stuck = new LlmClient(settings, null, async () => jsonResponse("slow down", 429));
    stuck.sleepImpl = async () => {};
    await expect(stuck.complete("selftest", "d", "p", (v) => v)).rejects.toThrow(/429/);
    await expect(stuck.complete("selftest", "d", "p", (v) => v)).rejects.toBeInstanceOf(LlmError);
  });
});

describe("store", () => {
  it("closes runs silent for 15 minutes: live ones as interrupted, examples as complete", async () => {
    const store = await freshStore(LIVE);
    const now = 10_000_000_000;
    await store.createRun(makeRun({ id: "live1", createdAt: now - 16 * 60_000 }));
    // old but alive: its last event is recent, so it keeps running (an LLM 429 wait is not a death)
    await store.createRun(makeRun({ id: "slow", createdAt: now - 41 * 60_000 }));
    await store.appendEvents("slow", [{ type: "stage", stage: "planner", message: "m", level: "info" }]);
    expect((await store.getRun("slow"))?.lastProgressAt).toBeGreaterThan(now - 60_000);
    await env.DB.prepare("UPDATE runs SET last_progress_at = ? WHERE id = 'slow'").bind(now - 5 * 60_000).run();
    await store.createRun(makeRun({ id: "fresh", createdAt: now - 14 * 60_000 }));
    await store.createRun(makeRun({ id: "demo1", demo: true, createdAt: now - 16 * 60_000 }));
    await store.createRun(makeRun({ id: "old", status: "complete", createdAt: now - 41 * 60_000 }));
    expect(await store.failStaleRuns(now)).toBe(2);
    const live1 = await store.getRun("live1");
    expect(live1?.status).toBe("failed");
    expect(live1?.error).toBe(INTERRUPTED);
    expect(live1?.outcome).toBeNull();
    expect((await store.eventsFor("live1")).at(-1)?.[1].type).toBe("done");
    expect((await store.getRun("slow"))?.status).toBe("running");
    expect((await store.getRun("fresh"))?.status).toBe("running");
    // the example has every result already; its trace just stops animating
    const demo1 = await store.getRun("demo1");
    expect(demo1?.status).toBe("complete");
    expect(demo1?.error).toBeNull();
    expect((await store.eventsFor("demo1")).map(([, e]) => e.type)).toEqual(["stage", "status", "done"]);
    expect((await store.getRun("old"))?.status).toBe("complete");
    expect(await store.failStaleRuns(now)).toBe(0); // nothing is closed twice
  });

  it("adds the progress column to a database created before the watchdog, keeping old runs readable", async () => {
    await freshStore(LIVE);
    await env.DB.batch(["runs"].map((t) => env.DB.prepare(`DROP TABLE ${t}`)));
    await env.DB.prepare("CREATE TABLE runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)").run();
    const { lastProgressAt: _p, searchCalls: _c, failedSearches: _f, outcome: _o, ...legacy } = makeRun({ id: "legacy", createdAt: 5_000 });
    await env.DB.prepare("INSERT INTO runs (id, created_at, status, demo, data) VALUES (?, ?, ?, 0, ?)").bind("legacy", 5_000, "running", JSON.stringify(legacy)).run();
    resetSchemaCache(env.DB);
    await ensureSchema(env.DB);
    const cols = (await env.DB.prepare("PRAGMA table_info(runs)").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols).toContain("last_progress_at");
    const store = new Store(env.DB, LIVE);
    expect(await store.getRun("legacy")).toMatchObject({ lastProgressAt: 5_000, searchCalls: 0, failedSearches: 0, outcome: null });
    expect(await store.failStaleRuns(5_000 + 16 * 60_000)).toBe(1);
    resetSchemaCache(env.DB);
    await ensureSchema(env.DB); // a second pass finds the column and changes nothing
  });

  it("assigns dense evidence ids and event indexes in the database", async () => {
    const store = await freshStore(LIVE);
    await store.createRun(makeRun({ id: "r1" }));
    const row = { blockType: "organic", title: "t", url: "", domain: "", snippet: "s", position: 1, meta: {} };
    const [a, b] = await Promise.all([store.addEvidence("r1", "sc_a", [row, row]), store.addEvidence("r1", "sc_b", [row])]);
    expect(new Set([...a, ...b].map((e) => e.id)).size).toBe(3);
    expect((await store.evidenceFor("r1")).map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
    await Promise.all([store.appendEvents("r1", [{ type: "status", status: "running" }]), store.appendEvents("r1", [{ type: "status", status: "running" }])]);
    expect((await store.eventsFor("r1")).map(([i]) => i)).toEqual([0, 1]);
    await store.updateRun("r1", { questionType: "b2b" });
    await Promise.all([store.chargeSearch("r1"), store.chargeSearch("r1")]);
    expect(await store.getRun("r1")).toMatchObject({ questionType: "b2b", searchesUsed: 2 });
    await expect(store.updateRun("nope", { status: "failed" })).rejects.toThrow(/run not found/);
  });
});

describe("secrets never reach a run record", () => {
  it("keeps provider error bodies out of LLM errors", async () => {
    const settings = { LLM_PROVIDER: "openai", LLM_API_KEY: "gsk_live_secret_value_123" };
    const client = new LlmClient(settings, null, async () => jsonResponse({ error: { message: "Invalid API Key gsk_live_secret_value_123 for Bearer gsk_live_secret_value_123" } }, 401));
    const err = await client.complete("planner", "d", "p", (v) => v).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toBe("The writing helper said no (HTTP 401, check LLM_API_KEY).");
  });

  it("shows only messages the pipeline wrote, scrubbed; anything else becomes a fixed sentence", () => {
    const settings = { SERPAPI_API_KEY: "serp_key_abcdef", LLM_API_KEY: "gsk_another_secret_99" };
    expect(publicMessage(new PipelineError("We found only 3 web results"), settings)).toBe("We found only 3 web results");
    expect(publicMessage(new BudgetExceeded("This search has used all its lookups (25 of 25)."), settings)).toBe("This search has used all its lookups (25 of 25).");
    expect(publicMessage(new LlmError("echo gsk_another_secret_99 and api_key=serp_key_abcdef"), settings)).not.toMatch(/gsk_another|serp_key/);
    expect(publicMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), settings)).toBe("Something went wrong on our side during this step.");
    expect(publicMessage(new Error("D1_ERROR: no such table: runs"), settings)).toBe("Something went wrong on our side during this step.");
  });

  it("only uses OPENAI_API_KEY against OpenAI and only sends keys over https", () => {
    expect(config.llmApiKey({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-real" })).toBe("sk-real");
    expect(config.llmApiKey({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-real", LLM_BASE_URL: "https://gateway.example/v1" })).toBe("");
    const base = { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_MODEL: "m" };
    expect(config.pipelineReadiness({ ...base, LLM_BASE_URL: "http://gateway.example/v1" })[0]).toBe(false);
    expect(config.pipelineReadiness({ ...base, LLM_BASE_URL: "http://127.0.0.1:11434/v1" })[0]).toBe(true);
    expect(config.pipelineReadiness({ LLM_PROVIDER: "gsk_pasted_by_mistake", LLM_API_KEY: "k" })[1]).not.toContain("gsk_pasted");
  });
});

describe("links", () => {
  it("keeps only absolute http(s) result links", () => {
    const rows = normalise("google", { organic_results: [
      { title: "a", link: "javascript:alert(1)", snippet: "s" },
      { title: "b", link: "//evil.test/x", snippet: "s" },
      { title: "c", link: "https://ok.test/page", snippet: "s" },
    ], ads: [{ title: "d", displayed_link: "shop.test/offer", snippet: "s" }] });
    expect(rows.map((r) => r.url)).toEqual(["", "", "https://ok.test/page", ""]);
  });
});
