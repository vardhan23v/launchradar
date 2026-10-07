import { describe, expect, it } from "vitest";

import { validateSignals, verifyQuote } from "../src/citations";
import * as config from "../src/config";
import { loadFixture } from "../src/demo";
import { hashParams, toRawParams } from "../src/engines";
import { LlmClient, LlmError, parseJson } from "../src/llm";
import { normalise } from "../src/normalise";
import { cleanQuery, MAX_EXTRACT_ROWS, selectForExtraction, trendSlope } from "../src/pipeline";
import { computeScore, type ScoreInput } from "../src/score";
import { INTERRUPTED } from "../src/store";
import type { Evidence, StepEvent } from "../src/types";
import { citeGroups, keepKnownCitations, parseSerpDate } from "../src/utils";
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
    expect(config.pipelineReadiness(base)).toEqual([false, "LLM_BASE_URL is set, so LLM_MODEL must name a model that gateway serves."]);
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
    expect(waits).toEqual([2000, 10000]); // honours retry-after, otherwise backs off
    expect(events.filter((e) => e.type === "stage" && e.level === "warn")).toHaveLength(2);

    // a provider that never recovers fails loudly instead of hanging the run
    const stuck = new LlmClient(settings, null, async () => jsonResponse("slow down", 429));
    stuck.sleepImpl = async () => {};
    await expect(stuck.complete("selftest", "d", "p", (v) => v)).rejects.toThrow(/429/);
    await expect(stuck.complete("selftest", "d", "p", (v) => v)).rejects.toBeInstanceOf(LlmError);
  });
});

describe("store", () => {
  it("closes interrupted live runs after the stale window, not demos or finished runs", async () => {
    const store = await freshStore(LIVE);
    const now = 10_000_000_000;
    await store.createRun(makeRun({ id: "live1", createdAt: now - 41 * 60_000 }));
    await store.createRun(makeRun({ id: "fresh", createdAt: now - 5 * 60_000 }));
    await store.createRun(makeRun({ id: "demo1", demo: true, createdAt: now - 41 * 60_000 }));
    await store.createRun(makeRun({ id: "old", status: "complete", createdAt: now - 41 * 60_000 }));
    expect(await store.failStaleRuns(now)).toBe(1);
    const live1 = await store.getRun("live1");
    expect(live1?.status).toBe("failed");
    expect(live1?.error).toBe(INTERRUPTED);
    expect((await store.eventsFor("live1")).at(-1)?.[1].type).toBe("done");
    expect((await store.getRun("fresh"))?.status).toBe("running");
    expect((await store.getRun("demo1"))?.status).toBe("running");
    expect((await store.getRun("old"))?.status).toBe("complete");
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
