/**
 * The /v3 dashboard's data layer: every opportunity from every finished run, as one feed.
 *
 * Pure functions only (no fetch, no storage, no clock), so the screen can be tested and reasoned
 * about. Nothing here is invented: each field comes from the run view the API returned. There are
 * no upvotes, makers or launch dates in LaunchRadar, so the feed does not pretend to have them:
 * the ranking number is the opportunity score, and "trending" is the momentum sub-score, which
 * comes from Google Trends data gathered during the run.
 */

import type { Evidence, GapStatus, Opportunity, RunView } from "@/lib/types";
import { CITE_RE, citeGroups } from "@/lib/evidence";

export type SortKey = "score" | "momentum" | "newest";
export type DateRange = "today" | "week" | "all";
export type ViewMode = "grid" | "list";

export const SUB_SCORES: { key: keyof Opportunity["subScores"]; label: string; short: string; max: number }[] = [
  { key: "pain", label: "Pain", short: "Pain", max: 30 },
  { key: "momentum", label: "Momentum", short: "Mom.", max: 20 },
  { key: "commercial", label: "Commercial intent", short: "Comm.", max: 20 },
  { key: "whitespace", label: "Whitespace", short: "White.", max: 20 },
  { key: "weakRivals", label: "Weak rivals", short: "Rivals", max: 10 },
];

export const REGIONS: { code: string; label: string }[] = [
  { code: "in", label: "India" },
  { code: "us", label: "United States" },
  { code: "uk", label: "United Kingdom" },
];

export const regionLabel = (code: string) => REGIONS.find((r) => r.code === code)?.label ?? code.toUpperCase();

export const GAP_LABEL: Record<GapStatus, string> = {
  open: "Open gap",
  "partially-served": "Partly served",
  served: "Already served",
};

export function confidenceLabel(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith("h")) return "High";
  if (v.startsWith("m")) return "Medium";
  if (v.startsWith("l")) return "Low";
  return value || "Unknown";
}

export interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
}

export interface FeedItem {
  /** runId:opportunityId, unique across the feed */
  key: string;
  runId: string;
  opportunity: Opportunity;
  title: string;
  tagline: string;
  score: number;
  momentum: number;
  confidence: string;
  gapStatus: GapStatus | null;
  region: string;
  question: string;
  demo: boolean;
  createdAt: number;
  /** Every source the opportunity's text cites, in first-cited order, one per URL. */
  sources: Source[];
  /** Evidence ids cited, mapped to their 1-based footnote number in `sources`. */
  footnotes: Record<string, number>;
}

/** Remove [E1,E2] citation markers from prose (they become footnotes in the detail panel). */
export function stripCites(text: string): string {
  return text.replace(new RegExp(`\\s*${CITE_RE.source}`, "g"), "").replace(/\s+([.,;:])/g, "$1").trim();
}

function firstSentence(text: string, max = 160): string {
  const clean = stripCites(text);
  const m = /^(.+?[.!?])(\s|$)/.exec(clean);
  const s = m ? m[1] : clean;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function citedIds(o: Opportunity, view: RunView): string[] {
  const prose = [o.problem, o.existingSolutions, o.gap, o.pitch, o.firstValidationStep, ...o.mvpScope];
  const ids: string[] = [];
  for (const t of prose) for (const g of citeGroups(t ?? "")) ids.push(...g.ids);
  for (const s of o.skeptic ?? []) {
    for (const g of citeGroups(s.basis ?? "")) ids.push(...g.ids);
    ids.push(...(s.evidenceIds ?? []));
  }
  const gap = view.gaps.find((g) => g.id === o.gapId);
  for (const p of gap?.foundProducts ?? []) ids.push(p.evidenceId);
  return ids;
}

function sourcesFor(o: Opportunity, view: RunView): { sources: Source[]; footnotes: Record<string, number> } {
  const byId = new Map<string, Evidence>(view.evidence.map((e) => [e.id, e]));
  const sources: Source[] = [];
  const byUrl = new Map<string, number>();
  const footnotes: Record<string, number> = {};
  for (const id of citedIds(o, view)) {
    if (footnotes[id]) continue;
    const e = byId.get(id);
    if (!e) continue; // the citation validator already rejects unknown ids; stay tolerant anyway
    let n = byUrl.get(e.url);
    if (!n) {
      sources.push({ id: e.id, title: e.title, url: e.url, domain: e.domain });
      n = sources.length;
      byUrl.set(e.url, n);
    }
    footnotes[id] = n;
  }
  return { sources, footnotes };
}

/**
 * One feed from many runs. Only finished runs count, and only the newest run of each
 * question + region (examples and real runs kept apart), so re-running a question replaces its older findings instead of doubling them.
 */
export function buildFeed(views: RunView[]): { items: FeedItem[]; runs: RunView[] } {
  const newest = new Map<string, RunView>();
  for (const v of views) {
    if (v.run.status !== "complete") continue;
    // the recorded example never replaces a real run of the same question, or the other way round
    const k = `${v.run.demo ? "example" : "real"}|${v.run.question.trim().toLowerCase()}|${v.run.region}`;
    const prev = newest.get(k);
    if (!prev || v.run.createdAt > prev.run.createdAt) newest.set(k, v);
  }
  const runs = [...newest.values()].sort((a, b) => b.run.createdAt - a.run.createdAt);
  const items: FeedItem[] = [];
  for (const v of runs) {
    for (const o of v.opportunities) {
      const { sources, footnotes } = sourcesFor(o, v);
      items.push({
        key: `${v.run.id}:${o.id}`,
        runId: v.run.id,
        opportunity: o,
        title: stripCites(o.title),
        tagline: firstSentence(o.pitch || o.problem),
        score: o.score,
        momentum: o.subScores?.momentum ?? 0,
        confidence: confidenceLabel(o.confidence),
        gapStatus: v.gaps.find((g) => g.id === o.gapId)?.status ?? null,
        region: v.run.region,
        question: v.run.question,
        demo: v.run.demo,
        createdAt: v.run.createdAt,
        sources,
        footnotes,
      });
    }
  }
  return { items, runs };
}

export interface Filters {
  search: string;
  regions: string[];
  gaps: GapStatus[];
  confidence: string[];
  questions: string[];
  date: DateRange;
  shortlistedOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  search: "",
  regions: [],
  gaps: [],
  confidence: [],
  questions: [],
  date: "all",
  shortlistedOnly: false,
};

export function activeFilterCount(f: Filters): number {
  return f.regions.length + f.gaps.length + f.confidence.length + f.questions.length + (f.date !== "all" ? 1 : 0) + (f.shortlistedOnly ? 1 : 0);
}

const DAY = 24 * 60 * 60 * 1000;

function inRange(createdAt: number, range: DateRange, now: number): boolean {
  if (range === "all") return true;
  if (range === "week") return now - createdAt < 7 * DAY;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return createdAt >= start.getTime();
}

function matches(item: FeedItem, q: string): boolean {
  if (!q) return true;
  const o = item.opportunity;
  const hay = [item.title, item.tagline, o.target, o.problem, o.gap, item.question].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export function applyFilters(items: FeedItem[], f: Filters, shortlist: Set<string>, now: number): FeedItem[] {
  return items.filter(
    (it) =>
      matches(it, f.search.trim()) &&
      (!f.regions.length || f.regions.includes(it.region)) &&
      (!f.gaps.length || (it.gapStatus !== null && f.gaps.includes(it.gapStatus))) &&
      (!f.confidence.length || f.confidence.includes(it.confidence)) &&
      (!f.questions.length || f.questions.includes(it.question)) &&
      inRange(it.createdAt, f.date, now) &&
      (!f.shortlistedOnly || shortlist.has(it.key)),
  );
}

export function sortItems(items: FeedItem[], sort: SortKey): FeedItem[] {
  const out = [...items];
  const byScore = (a: FeedItem, b: FeedItem) => b.score - a.score || b.createdAt - a.createdAt;
  if (sort === "score") out.sort(byScore);
  if (sort === "momentum") out.sort((a, b) => b.momentum - a.momentum || byScore(a, b));
  if (sort === "newest") out.sort((a, b) => b.createdAt - a.createdAt || byScore(a, b));
  return out;
}

/** Counts per filter value over all items, so a filter never offers a choice that shows nothing. */
export function facetCounts(items: FeedItem[]) {
  const count = <T extends string>(pick: (i: FeedItem) => T | null) => {
    const m = new Map<T, number>();
    for (const i of items) {
      const v = pick(i);
      if (v !== null) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  return {
    regions: count((i) => i.region),
    gaps: count((i) => i.gapStatus),
    confidence: count((i) => i.confidence),
    questions: count((i) => i.question),
  };
}

export function relativeDay(ts: number, now: number): string {
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ts)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A stable hue per title, so an opportunity keeps the same monogram colour everywhere. */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function monogram(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
}
