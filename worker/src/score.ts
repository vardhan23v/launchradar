/** Deterministic Opportunity Score (ARCH §5). Pure function — no LLM, no I/O. */
import { SCORE_WEIGHTS as W } from "./config";
import type { SubScores } from "./types";

export interface ScoreInput {
  signals: { intensity: number; domains: string[] }[];
  trendSlope: number | null;
  recentNewsCount: number;
  adsCount: number;
  hasPricedCompetitors: boolean;
  jobsCount: number;
  gapStatus: string;
  directCompetitors: number;
  weakCompetitorShare: number;
  evidenceCount: number;
  distinctDomains: number;
  blockTypeCount: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function computeScore(i: ScoreInput): { total: number; subScores: SubScores; confidence: string } {
  const domains = new Set(i.signals.flatMap((s) => s.domains).filter(Boolean));
  const avgIntensity = i.signals.length ? i.signals.reduce((a, s) => a + s.intensity, 0) / i.signals.length : 0;
  const pain = i.signals.length ? Math.min(1, domains.size / 6) * (avgIntensity / 5) : 0;

  // missing inputs score 0 — never imputed
  let momentum = 0;
  if (i.trendSlope !== null) momentum = (clamp(i.trendSlope, -0.5, 1.0) + 0.5) / 1.5;
  if (i.recentNewsCount >= 2) momentum = Math.min(1, momentum + 0.2);

  const commercial = 0.5 * Math.min(1, i.adsCount / 4) + 0.3 * (i.hasPricedCompetitors ? 1 : 0) + 0.2 * Math.min(1, i.jobsCount / 10);

  const factor = i.gapStatus === "open" ? 1.0 : i.gapStatus === "partially-served" ? 0.5 : 0.1;
  const whitespace = factor * Math.max(0, 1 - Math.min(1, i.directCompetitors / 8));

  const parts: SubScores = { pain, momentum, commercial, whitespace, weakRivals: i.weakCompetitorShare };
  const total = (Object.keys(parts) as (keyof SubScores)[]).reduce((a, k) => a + W[k] * parts[k], 0);

  let confidence = "Low";
  if (i.evidenceCount >= 30 && i.distinctDomains >= 4 && i.blockTypeCount >= 3) confidence = "High";
  else if (i.evidenceCount >= 12 && i.distinctDomains >= 2 && i.blockTypeCount >= 2) confidence = "Med";

  return {
    total: Math.min(100, Math.floor(total + 0.5)),
    subScores: {
      pain: r1(W.pain * pain), momentum: r1(W.momentum * momentum), commercial: r1(W.commercial * commercial),
      whitespace: r1(W.whitespace * whitespace), weakRivals: r1(W.weakRivals * i.weakCompetitorShare),
    },
    confidence,
  };
}
