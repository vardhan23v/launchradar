"use client";

import type { GapStatus } from "@/lib/schemas";

export function BudgetMeter({
  used,
  limit,
  month,
  monthLimit,
}: {
  used: number;
  limit: number;
  month: number;
  monthLimit: number;
}) {
  const runPct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <div title={`Run searches: ${used}/${limit}`}>
        <span className="font-semibold text-foreground">{used}</span>/{limit} searches
      </div>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-accent" style={{ width: `${runPct}%` }} />
      </div>
      <div title={`Month searches: ${month}/${monthLimit}`}>
        <span className="font-semibold text-foreground">{month}</span>/{monthLimit} month
      </div>
    </div>
  );
}

export function ScoreRing({
  score,
  size = 56,
  stroke = 5,
}: {
  score: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, score) / 100) * c;
  const color = score >= 70 ? "#16a34a" : score >= 45 ? "#4f46e5" : "#d97706";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4e4e7" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 truncate text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums">
        {value}
        {suffix ?? `/ ${max}`}
      </span>
    </div>
  );
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High: "bg-green-100 text-green-800 border-green-200",
  Med: "bg-amber-100 text-amber-800 border-amber-200",
  Low: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function ConfidenceChip({ value }: { value: string }) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLE[value] ?? CONFIDENCE_STYLE.Low}`}>
      {value}
    </span>
  );
}

const GAP_STYLE: Record<GapStatus, string> = {
  open: "bg-indigo-100 text-indigo-700 border-indigo-200",
  "partially-served": "bg-amber-100 text-amber-800 border-amber-200",
  served: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function GapChip({ status, label }: { status: GapStatus; label?: string }) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GAP_STYLE[status]}`}>
      {label ?? status}
    </span>
  );
}

export function EngineBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-700">
      {value}
    </span>
  );
}