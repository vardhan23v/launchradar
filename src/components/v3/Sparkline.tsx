"use client";

/** A small line of search interest over time (the idea's Google Trends series), drawn inline in the current text colour. */

import { useId } from "react";

import type { TrendSeries } from "@/lib/v3/trends";

/** The direction of a trend line, in plain words. */
export const DIRECTION_LABEL: Record<TrendSeries["direction"], string> = {
  up: "going up",
  down: "going down",
  flat: "about the same",
};

/** One sentence a screen reader can read instead of the line. */
export function trendSummary(series: TrendSeries): string {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  return `Search interest for “${series.label}” over the last 12 months: ${DIRECTION_LABEL[series.direction]}. ${series.points.length} points, from ${Math.round(first.value)} to ${Math.round(last.value)} out of 100.`;
}

export default function Sparkline({ series, width = 120, height = 32, className }: { series: TrendSeries; width?: number; height?: number; className?: string }) {
  const id = useId();
  const { points } = series;
  const n = points.length;
  const pad = 2; // room for the stroke and the end dot
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad));
  const y = (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  const lastX = x(n - 1);
  const lastY = y(points[n - 1].value);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`} focusable="false" className={className}>
      <title id={`${id}-title`}>{`Search interest over the last 12 months: ${DIRECTION_LABEL[series.direction]}`}</title>
      <desc id={`${id}-desc`}>{trendSummary(series)}</desc>
      <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={2} fill="currentColor" />
    </svg>
  );
}
