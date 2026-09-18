import { CONFIG } from "../config";
import type { Confidence, SubScores } from "../schemas";
import type { GapStatus } from "../schemas";

export interface ScoreInput {
  signals: {
    intensity: number;
    domains: string[];
  }[];
  trendSlope: number | null; // -1..+inf (fraction of baseline)
  recentNewsCount: number;
  adsCount: number;
  hasPricedCompetitors: boolean;
  jobsCount: number;
  gapStatus: GapStatus;
  directCompetitors: number;
  weakCompetitorShare: number; // 0..1
  evidenceCount: number;
  distinctDomains: number;
  blockTypeCount: number;
}

export interface ScoreResult {
  total: number;
  subScores: SubScores;
  confidence: Confidence;
  inputs: ScoreInput;
}

const W = CONFIG.score;

export function computeScore(input: ScoreInput): ScoreResult {
  const pain =
    Math.min(1, input.signals.length === 0 ? 0 : countDomains(input) / 6) *
    (avgIntensity(input) / 5);

  let momentum = 0;
  if (input.trendSlope !== null) {
    const slope = clamp(input.trendSlope, -0.5, 1.0);
    momentum = (slope + 0.5) / 1.5;
  }
  if (input.recentNewsCount >= 2) momentum = Math.min(1, momentum + 0.2);

  const commercial =
    0.5 * Math.min(1, input.adsCount / 4) +
    0.3 * (input.hasPricedCompetitors ? 1 : 0) +
    0.2 * Math.min(1, input.jobsCount / 10);

  const whitespaceFactor =
    input.gapStatus === "open" ? 1.0
    : input.gapStatus === "partially-served" ? 0.5
    : 0.1;
  const crowdPenalty = 1 - Math.min(1, input.directCompetitors / 8);
  const whitespace = whitespaceFactor * Math.max(0, crowdPenalty);

  const weakRivals = input.weakCompetitorShare;

  const weighted =
    W.pain * pain +
    W.momentum * momentum +
    W.commercial * commercial +
    W.whitespace * whitespace +
    W.weakRivals * weakRivals;

  const subScores: SubScores = {
    pain: round(W.pain * pain),
    momentum: round(W.momentum * momentum),
    commercial: round(W.commercial * commercial),
    whitespace: round(W.whitespace * whitespace),
    weakRivals: round(W.weakRivals * weakRivals),
  };

  const confidence = confidenceOf(input);

  return {
    total: Math.min(100, Math.round(weighted)),
    subScores,
    confidence,
    inputs: input,
  };
}

function countDomains(input: ScoreInput): number {
  return new Set(input.signals.flatMap((s) => s.domains).filter(Boolean)).size;
}

function avgIntensity(input: ScoreInput): number {
  const sum = input.signals.reduce((a, s) => a + s.intensity, 0);
  return input.signals.length === 0 ? 0 : sum / input.signals.length;
}

function confidenceOf(input: ScoreInput): Confidence {
  const srcTypes = input.blockTypeCount;
  if (input.evidenceCount >= 30 && input.distinctDomains >= 4 && srcTypes >= 3) {
    return "High";
  }
  if (input.evidenceCount >= 12 && input.distinctDomains >= 2 && srcTypes >= 2) {
    return "Med";
  }
  return "Low";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}