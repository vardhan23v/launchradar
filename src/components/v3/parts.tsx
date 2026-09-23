"use client";

/** Small building blocks shared by the radar dashboard and the run page. */

import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import type { GapStatus, Opportunity } from "@/lib/types";
import { citeGroups } from "@/lib/evidence";
import { GAP_LABEL, SUB_SCORES, hueFor, monogram, type Source } from "@/lib/v3/feed";
import { ExternalIcon, StarIcon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Where focus goes when the element that opened a dialog has left the page. */
export const FOCUS_FALLBACK_ID = "lr3-main-heading";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Everything a modal dialog owes keyboard and screen-reader users: focus moves in, Tab stays
 * inside, Escape closes (not while an input method is composing), the page behind stops
 * scrolling, and focus returns to whatever opened it (or to the page heading if that is gone).
 */
export function useModal(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
      else document.getElementById(FOCUS_FALLBACK_ID)?.focus();
    };
    // mount/unmount only: the refs are stable and the latest onClose is read through close.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Closes a popover or disclosure on outside click, on Escape (returning focus to its trigger,
 * the first button inside the wrapper) and when keyboard focus leaves it.
 */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (root?.contains(document.activeElement)) root.querySelector<HTMLElement>("button")?.focus();
      close();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (root && e.relatedTarget instanceof Node && !root.contains(e.relatedTarget)) close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      root?.removeEventListener("focusout", onFocusOut);
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
        <span className="relative flex size-1.5" aria-hidden="true">
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

export function ExampleBadge() {
  return <Badge tone="amber">Recorded example</Badge>;
}

/** The ranking number: the opportunity's 0–100 score, with a ring that fills to it. */
export function ScoreDial({ score, size = "md", className }: { score: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const px = { sm: 40, md: 52, lg: 76 }[size];
  const stroke = size === "lg" ? 5 : 4;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 60 ? "#34d399" : score >= 40 ? "#818cf8" : "#a1a1aa";
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: px, height: px }}>
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
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
        <span className={cx("font-mono font-semibold tabular-nums text-zinc-50", size === "lg" ? "text-2xl" : size === "md" ? "text-base" : "text-sm")}>
          {Math.round(score)}
        </span>
      </span>
      <span className="sr-only">Score {Math.round(score)} out of 100</span>
    </span>
  );
}

/**
 * The feed's one personal action. LaunchRadar has no accounts, so there is nothing to upvote with;
 * this keeps a shortlist in this browser, shared with the triage board. The accessible name stays
 * constant and contains the visible word; aria-pressed carries the state.
 */
export function ShortlistButton({
  active,
  onToggle,
  title,
  compact = false,
}: {
  active: boolean;
  onToggle: () => void;
  title: string;
  compact?: boolean;
}) {
  const [popKey, setPopKey] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Shortlist ${title}`}
      data-shortlist=""
      onClick={(e) => {
        e.stopPropagation();
        setPopKey((k) => k + 1);
        onToggle();
      }}
      className={cx(
        "relative z-10 inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium",
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
      {!compact && <span>Shortlist</span>}
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
  const raw = (k: keyof Opportunity["subScores"]) => Math.round((o.subScores?.[k] ?? 0) * 10) / 10;
  const values = SUB_SCORES.map((s) => Math.max(0, Math.min(1, (o.subScores?.[s.key] ?? 0) / s.max)));
  const shape = values.map((v, i) => pt(i, Math.max(v, 0.04)).join(",")).join(" ");
  const gid = useId().replace(/:/g, "");
  const label = `Sub-scores: ${SUB_SCORES.map((s) => `${s.label} ${raw(s.key)} of ${s.max}`).join(", ")}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
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
                {raw(s.key)}/{s.max}
              </tspan>
            </text>
          );
        })}
    </svg>
  );
}

/** One source: a link when the search result has an address, plain text when it does not. */
export function SourceLine({ s, n }: { s: Source; n?: number }) {
  const body = (
    <>
      {n !== undefined ? (
        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{n}</span>
      ) : (
        <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm bg-white/10 text-[9px] font-semibold uppercase text-zinc-300">
          {(s.domain || s.kind).replace(/^www\./, "").charAt(0)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-zinc-100 [overflow-wrap:anywhere]">{s.title || s.domain || s.kind}</span>
        <span className="block truncate text-xs text-zinc-400">{s.url ? s.domain : `${s.kind} · no web page`}</span>
      </span>
      {s.url && <ExternalIcon size={14} className="mt-1 shrink-0 text-zinc-400 group-hover:text-zinc-200" />}
    </>
  );
  const cls = "group flex items-start gap-3 rounded-lg px-2 py-2";
  return s.url ? (
    <a
      href={s.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cx(cls, "transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/70")}
    >
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * "Sources" button: the pages an opportunity cites. The panel aligns to the button's side of the
 * card and opens downward unless there is more room above.
 */
export function SourcesPopover({
  sources,
  title,
  onSeeAll,
  align = "start",
  compact = false,
}: {
  sources: Source[];
  title: string;
  onSeeAll: () => void;
  align?: "start" | "end";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  if (!sources.length) return null;
  const label = `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
  return (
    <div ref={ref} className="relative z-10">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label} for ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!open && trigger.current) {
            const r = trigger.current.getBoundingClientRect();
            const below = window.innerHeight - r.bottom;
            setUp(below < 340 && r.top - 72 > below);
          }
          setOpen((v) => !v);
        }}
        className={cx(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-xs font-medium text-zinc-300 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
          compact ? "px-2.5" : "px-3",
        )}
      >
        <ExternalIcon size={14} />
        {compact ? sources.length : label}
      </button>
      {open && (
        <div
          id={id}
          className={cx(
            "lr3-appear absolute z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl",
            up ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">Cited pages</p>
          <ul>
            {sources.slice(0, 5).map((s) => (
              <li key={s.id}>
                <SourceLine s={s} />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              trigger.current?.focus(); // the trigger stays on the page, so the panel can return focus to it
              setOpen(false);
              onSeeAll();
            }}
            className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-indigo-300 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/70"
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
  const groups = citeGroups(text ?? "");
  if (!groups.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  groups.forEach((g, gi) => {
    out.push(<Fragment key={`t${gi}`}>{text.slice(at, g.index).trimEnd()}</Fragment>);
    const nums = [...new Set(g.ids.map((id) => footnotes[id]).filter(Boolean))].sort((a, b) => a - b);
    if (nums.length)
      out.push(
        <sup key={`c${gi}`} className="ml-0.5 whitespace-nowrap">
          {nums.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && <span aria-hidden="true" className="text-zinc-500">,</span>}
              <a href={`#${anchor}-${n}`} className="rounded font-mono text-[10px] font-medium text-indigo-300 hover:text-indigo-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70" aria-label={`Source ${n}`}>
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

/** A row of native radio buttons styled as a segmented control: arrow keys and one Tab stop for free. */
export function Segmented<T extends string>({
  name,
  label,
  value,
  onChange,
  options,
  className,
}: {
  name: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <fieldset className={cx("flex min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1", className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} title={o.title} className="flex-1 cursor-pointer">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
          <span
            className={cx(
              "flex h-full items-center justify-center rounded-lg border border-transparent px-2 py-1.5 text-xs font-medium text-zinc-400 transition-all duration-200",
              "hover:text-zinc-100 peer-checked:border-white/15 peer-checked:bg-white/10 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400/70",
              "forced-colors:peer-checked:border-[Highlight]",
            )}
          >
            {o.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
