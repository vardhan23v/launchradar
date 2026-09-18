import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SerpApiService, BudgetError, makeId } from "../src/lib/serpapi/client";
import { hashParams, toRawParams } from "../src/lib/serpapi/engines";
import type { Run } from "../src/lib/schemas";
import { Store } from "../src/lib/store";

const OLD = { ...process.env };

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lr-test-"));
  store = new Store(join(dir, "store.json"));
  process.env.SERPAPI_MODE = "replay";
  process.env.SERPAPI_API_KEY = "";
});

afterEach(() => {
  process.env = { ...OLD };
});

function run(): Run {
  return {
    id: makeId("run"),
    question: "test",
    region: "in",
    questionType: null,
    status: "running",
    budget: 25,
    searchesUsed: 0,
    createdAt: Date.now(),
    finishedAt: null,
    demo: false,
    demoLabel: null,
    rejectedSignals: 0,
    error: null,
  };
}

describe("SerpApiService", () => {
  it("throws BudgetExceeded BEFORE any network cost when the run budget is spent", async () => {
    store.createRun({ ...run(), budget: 1, searchesUsed: 1 });
    const serp = new SerpApiService(store);
    await expect(
      serp.search("google", { q: "anything" }, { runId: store.listRuns()[0].id, stage: "x", order: 1 }),
    ).rejects.toThrow(BudgetError);
  });

  it("in replay mode a missing fixture fails loudly with a recording hint", async () => {
    store.createRun(run());
    const id = store.listRuns()[0].id;
    const serp = new SerpApiService(store);
    await expect(
      serp.search("google", { q: "zzz-nonexistent" }, { runId: id, stage: "x", order: 1 }),
    ).rejects.toThrow("missing fixture");
  });

  it("replays a recorded fixture deterministically and persists call + evidence", () => {
    const params = { q: "ai tools for college students" };
    const raw = toRawParams("google", params, "in");
    const hash = hashParams("google", raw);
    const fixture = {
      search_metadata: { id: "sim_1" },
      organic_results: [
        { position: 1, title: "T", link: "https://a.com", snippet: "S" },
      ],
    };
    writeFileSync(join(dir, `${hash}.json`), JSON.stringify(fixture));
    store.createRun(run());
    const id = store.listRuns()[0].id;
    const serp = new SerpApiService(store, undefined, dir);
    const ctx = { runId: id, stage: "discovery", order: 1 };

    return serp.search("google", params, ctx).then((out) => {
      expect(out.evidence).toHaveLength(1);
      expect(out.evidence[0].id).toBe("E1");
      expect(store.getRun(id)?.searchesUsed).toBe(1);
      expect(store.searchCallsFor(id)).toHaveLength(1);
      // api_key must never appear in persisted params
      const persisted = store.searchCallsFor(id)[0].params;
      expect(JSON.stringify(persisted)).not.toContain("api_key");
    });
  });
});