import { describe, expect, it } from "vitest";
import { computeScore, type ScoreInput } from "../src/lib/pipeline/score";

function base(over: Partial<ScoreInput>): ScoreInput {
  return {
    signals: [{ intensity: 4, domains: ["reddit.com", "play.google.com"] }],
    trendSlope: null,
    recentNewsCount: 0,
    adsCount: 0,
    hasPricedCompetitors: false,
    jobsCount: 0,
    gapStatus: "open",
    directCompetitors: 0,
    weakCompetitorShare: 0,
    evidenceCount: 10,
    distinctDomains: 2,
    blockTypeCount: 2,
    ...over,
  };
}

describe("computeScore", () => {
  it("scores an open, high-pain whitespace gap well", () => {
    const r = computeScore(
      base({
        signals: [
          { intensity: 5, domains: ["a.com", "b.com", "c.com", "d.com"] },
          { intensity: 4, domains: ["a.com"] },
        ],
        gapStatus: "open",
        trendSlope: 0.8,
        recentNewsCount: 2,
        adsCount: 4,
        hasPricedCompetitors: true,
        evidenceCount: 30,
        distinctDomains: 4,
        blockTypeCount: 3,
      }),
    );
    expect(r.total).toBeGreaterThan(60);
    expect(r.subScores.whitespace).toBe(20);
    expect(r.confidence).toBe("High");
  });

  it("a served gap scores whitespace at 0.1, not 1.0", () => {
    const open = computeScore(base({ gapStatus: "open" }));
    const served = computeScore(base({ gapStatus: "served" }));
    const part = computeScore(base({ gapStatus: "partially-served" }));
    expect(open.subScores.whitespace).toBeGreaterThan(part.subScores.whitespace);
    expect(part.subScores.whitespace).toBeGreaterThan(served.subScores.whitespace);
    expect(served.subScores.whitespace).toBeCloseTo(2, 5);
  });

  it("missing inputs score zero for that term and lower confidence", () => {
    const minimal = computeScore(
      base({
        signals: [],
        trendSlope: null,
        recentNewsCount: 0,
        adsCount: 0,
        jobsCount: 0,
        evidenceCount: 3,
        distinctDomains: 1,
        blockTypeCount: 1,
      }),
    );
    expect(minimal.subScores.momentum).toBe(0);
    expect(minimal.subScores.commercial).toBe(0);
    expect(minimal.confidence).toBe("Low");
  });

  it("weak rivals counts competitors rated below 4.0", () => {
    const r = computeScore(
      base({ weakCompetitorShare: 0.5 }),
    );
    expect(r.subScores.weakRivals).toBeCloseTo(5, 5);
  });

  it("is a pure function (same inputs, same result)", () => {
    const input = base({ gapStatus: "partially-served" });
    expect(computeScore(input)).toEqual(computeScore(input));
  });
});