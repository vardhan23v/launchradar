/**
 * The 12-month Google Trends line behind an idea's "Getting popular" score, read from the search's
 * own trend_point results (worker/src/normalise.ts): each row is one point in time, and its
 * `meta.values` holds the search interest of every keyword the lookup compared, keyed by the
 * lower-cased query. Pure functions only.
 */

import type { Opportunity, RunView } from "@/lib/types";

export interface TrendSeries {
  label: string;
  points: { date: string; value: number }[];
  direction: "up" | "down" | "flat";
}

/** Fewer points than this and the line says nothing: no series at all. */
const MIN_POINTS = 4;
/** The last third must differ from the first third by more than this share to count as a change. */
const FLAT_BAND = 0.1;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Points are sorted by time; an unreadable date keeps its reading order and sorts by text. */
function timeOf(date: string): number {
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : Number.NaN;
}

function mean(points: { value: number }[]): number {
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}

function directionOf(points: { value: number }[]): TrendSeries["direction"] {
  const third = Math.max(1, Math.floor(points.length / 3));
  const first = mean(points.slice(0, third));
  const last = mean(points.slice(-third));
  if (first <= 0) return last > 0 ? "up" : "flat";
  const change = (last - first) / first;
  if (change > FLAT_BAND) return "up";
  if (change < -FLAT_BAND) return "down";
  return "flat";
}

/**
 * The search-interest line for one idea: the series of the keyword its complaint group was
 * looked up by, otherwise the series with the most points. Null when the search made no trend
 * lookup, or it came back with fewer than 4 points.
 */
export function trendFor(view: RunView, opportunity: Opportunity): TrendSeries | null {
  const byKey = new Map<string, { date: string; value: number }[]>();
  for (const e of view.evidence) {
    if (e.blockType !== "trend_point" || typeof e.date !== "string" || !e.date) continue;
    const values = isObj(e.meta) && isObj(e.meta.values) ? e.meta.values : null;
    if (!values) continue;
    for (const [key, raw] of Object.entries(values)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const k = key.trim().toLowerCase();
      if (!k) continue;
      const list = byKey.get(k) ?? [];
      list.push({ date: e.date, value: raw });
      byKey.set(k, list);
    }
  }
  if (byKey.size === 0) return null;

  // the complaint group this idea came from, and the keyword the trends lookup used for it
  const clusterId = opportunity.clusterId ?? view.gaps.find((g) => g.id === opportunity.gapId)?.clusterId;
  const cluster = clusterId ? view.clusters.find((c) => c.id === clusterId) : undefined;
  const keyword = (cluster?.searchKeyword ?? "").trim();
  let key = keyword.toLowerCase();
  if (!key || !byKey.has(key)) {
    key = "";
    let most = 0;
    for (const [k, list] of byKey) {
      if (list.length > most) {
        most = list.length;
        key = k;
      }
    }
  }
  const raw = byKey.get(key);
  if (!raw || raw.length < MIN_POINTS) return null;

  // one point per date, in time order (a repeated lookup must not draw the line twice)
  const byDate = new Map<string, { date: string; value: number }>();
  for (const p of raw) byDate.set(p.date, p);
  const points = [...byDate.values()].sort((a, b) => {
    const ta = timeOf(a.date);
    const tb = timeOf(b.date);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    return ta - tb;
  });
  if (points.length < MIN_POINTS) return null;

  return { label: key === keyword.toLowerCase() && keyword ? keyword : key, points, direction: directionOf(points) };
}
