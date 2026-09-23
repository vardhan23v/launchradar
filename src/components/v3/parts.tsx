"use client";

/** Small building blocks shared by the /v3 dashboard's cards, hero and detail panel. */

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { GapStatus, Opportunity } from "@/lib/types";
import { citeGroups } from "@/lib/evidence";
import { GAP_LABEL, SUB_SCORES, hueFor, monogram, type Source } from "@/lib/v3/feed";
import { ExternalIcon, StarIcon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Closes a popover or menu on outside click and on Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** A product-logo stand-in: initials on a tile whose hue is stable for the title. */
export function Monogram({ title, size = "md" }: { title: string; size?: "sm" | "md" | "lg" }) {
  const h = hueFor(title);
  const dims = { sm: "size-9 text-xs rounded-lg", md: "size-11 text-sm rounded-xl", lg: "size-16 text-xl rounded-2xl" }[size];
  return (
    <span
      aria-hidden="true"
      className={cx("grid shrink-0 place-items-center font-semibold tracking-tight text-white ring-1 ring-inset ring-white/15", dims)}
      style={{
        background: `linear-gradient(135deg, hsl(${h} 70% 46%), hsl(${(h + 40) % 360} 75% 34%))`,
        boxShadow: `0 8px 24px -12px hsl(${h} 80% 50% / 0.7)`,
      }}
    >
      {monogram(title)}
    </span>
  );
}

type Tone = "neutral" | "indigo" | "emerald" | "amber" | "rose";
const TONES: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-zinc-300",
  indigo: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200",
  emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  rose: "border-rose-400/25 bg-rose-400/10 text-rose-200",
};

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", TONES[tone])}>
      {dot && (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

export function GapBadge({ status }: { status: GapStatus | null }) {
  if (!status) return null;
  const tone: Tone = status === "open" ? "emerald" : status === "partially-served" ? "amber" : "rose";
  return (
    <Badge tone={tone} dot={status === "open"}>
      {GAP_LABEL[status]}
    </Badge>
  );
}

export function ConfidenceBadge({ value }: { value: string }) {
  return <Badge tone={value === "High" ? "indigo" : "neutral"}>{value} confidence</Badge>;
}

/** The ranking number: the opportunity's 0–100 score, with a ring that fills to it. */
export function ScoreDial({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const px = { sm: 40, md: 52, lg: 76 }[size];
  const stroke = size === "lg" ? 5 : 4;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 60 ? "#34d399" : score >= 40 ? "#818cf8" : "#a1a1aa";
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: px, height: px }} title={`Opportunity score ${score} out of 100`}>
      <svg width={px} height={px} className="-rotate-90" aria-hidden="true">
        <circle cx={px / 2} cy={px / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <span className={cx("font-mono font-semibold tabular-nums text-zinc-50", size === "lg" ? "text-2xl" : size === "md" ? "text-base" : "text-sm")}>
          {Math.round(score)}
        </span>
      </span>
      <span className="sr-only">Opportunity score {score} out of 100</span>
    </span>
  );
}

/**
 * The feed's one personal action. LaunchRadar has no accounts, so there is nothing to upvote with;
 * this keeps a shortlist in this browser, shared with the triage board at /v2.
 */
export function ShortlistButton({
  active,
  onToggle,
  compact = false,
}: {
  active: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const [popKey, setPopKey] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "Remove from shortlist" : "Add to shortlist"}
      title={active ? "Shortlisted in this browser" : "Shortlist (kept in this browser)"}
      onClick={(e) => {
        e.stopPropagation();
        setPopKey((k) => k + 1);
        onToggle();
      }}
      className={cx(
        "group/star relative z-10 inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium",
        "transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
        compact ? "size-9 justify-center" : "h-9 px-3",
        active
          ? "border-amber-300/40 bg-amber-300/10 text-amber-200 shadow-[0_0_20px_-6px_rgba(252,211,77,0.6)]"
          : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      <span key={popKey} className={cx("inline-flex", popKey > 0 && "lr3-pop")}>
        <StarIcon size={15} filled={active} />
      </span>
      {!compact && <span>{active ? "Shortlisted" : "Shortlist"}</span>}
    </button>
  );
}

/** The five sub-scores as a pentagon: the hero card's "preview", drawn from real numbers. */
export function ScoreRadar({ o, size = 220, labels = true }: { o: Opportunity; size?: number; labels?: boolean }) {
  const pad = labels ? 34 : 6;
  const R = size / 2 - pad;
  const cxp = size / 2;
  const cyp = size / 2;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / SUB_SCORES.length;
    return [cxp + Math.cos(a) * R * f, cyp + Math.sin(a) * R * f] as const;
  };
  const ring = (f: number) => SUB_SCORES.map((_, i) => pt(i, f).join(",")).join(" ");
  const values = SUB_SCORES.map((s) => Math.max(0, Math.min(1, (o.subScores?.[s.key] ?? 0) / s.max)));
  const shape = values.map((v, i) => pt(i, Math.max(v, 0.04)).join(",")).join(" ");
  const gid = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Sub-scores: pain, momentum, commercial intent, whitespace, weak rivals">
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#818cf8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.07)" />
      ))}
      {SUB_SCORES.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cxp} y1={cyp} x2={x} y2={y} stroke="rgba(255,255,255,0.06)" />;
      })}
      <polygon points={shape} fill={`url(#g${gid})`} stroke="#a5b4fc" strokeWidth={1.5} strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = pt(i, Math.max(v, 0.04));
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#e0e7ff" />;
      })}
      {labels &&
        SUB_SCORES.map((s, i) => {
          const [x, y] = pt(i, 1.2);
          return (
            <text key={s.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-400 text-[10px]">
              <tspan>{s.short}</tspan>
              <tspan x={x} dy="12" className="fill-zinc-200 font-mono">
                {Math.round((o.subScores?.[s.key] ?? 0) * 10) / 10}/{s.max}
              </tspan>
            </text>
          );
        })}
    </svg>
  );
}

/** "Sources" button: the external pages this opportunity cites, opened in a new tab. */
export function SourcesPopover({ sources, onSeeAll }: { sources: Source[]; onSeeAll: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const id = useId();
  if (!sources.length) return null;
  return (
    <div ref={ref} className="relative z-10">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
      >
        <ExternalIcon size={14} />
        {sources.length} {sources.length === 1 ? "source" : "sources"}
      </button>
      {open && (
        <div
          id={id}
          className="lr3-appear absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Cited pages</p>
          <ul>
            {sources.slice(0, 5).map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm bg-white/10 text-[9px] font-semibold uppercase text-zinc-300"
                  >
                    {s.domain.replace(/^www\./, "").charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-zinc-100">{s.title || s.domain}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{s.domain}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onSeeAll();
            }}
            className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-indigo-300 transition-colors hover:bg-white/[0.06]"
          >
            {sources.length > 5 ? `See all ${sources.length} with the full case` : "Read the full case"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Prose whose [E1,E2] citations become numbered footnote links into the Sources list. */
export function CitedText({ text, footnotes, anchor }: { text: string; footnotes: Record<string, number>; anchor: string }) {
  const groups = citeGroups(text);
  if (!groups.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  groups.forEach((g, gi) => {
    out.push(<Fragment key={`t${gi}`}>{text.slice(at, g.index).trimEnd()}</Fragment>);
    const nums = [...new Set(g.ids.map((id) => footnotes[id]).filter(Boolean))].sort((a, b) => a - b);
    out.push(
      <sup key={`c${gi}`} className="ml-0.5 whitespace-nowrap">
        {nums.map((n, i) => (
          <Fragment key={n}>
            {i > 0 && <span className="text-zinc-600">,</span>}
            <a
              href={`#${anchor}-${n}`}
              className="font-mono text-[10px] font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
              aria-label={`Source ${n}`}
            >
              {n}
            </a>
          </Fragment>
        ))}
      </sup>,
    );
    at = g.index + g.length;
  });
  out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{out}</>;
}
