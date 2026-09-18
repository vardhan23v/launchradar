"use client";

import type { GapStatus, RunStatus } from "@/lib/types";

export function RadarMark({ size = 18, live = false }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <g className={live ? "radar-sweep" : undefined}>
        <path d="M12 12 L12 1.5" stroke="var(--accent)" strokeWidth="2" />
      </g>
      <circle cx="12" cy="12" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark({ live = false }: { live?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <RadarMark live={live} />
      <span className="font-serif text-[19px] font-medium tracking-tight">LaunchRadar</span>
    </span>
  );
}

const STATUS_WORD: Record<RunStatus, string> = { queued: "Queued", running: "Researching", complete: "Complete", failed: "Failed" };
const STATUS_TONE: Record<RunStatus, string> = { queued: "text-muted", running: "text-accent", complete: "text-ok", failed: "text-danger" };

/** Status as a word with a square marker — no pill. */
export function StatusText({ status }: { status: RunStatus }) {
  return (
    <span className={`kicker inline-flex items-center gap-1.5 ${STATUS_TONE[status]}`}>
      <span className={`inline-block h-[7px] w-[7px] bg-current ${status === "running" ? "blink" : ""}`} />
      {STATUS_WORD[status]}
    </span>
  );
}

const GAP_WORD: Record<GapStatus, string> = { open: "Open gap", "partially-served": "Partially served", served: "Crowded" };
const GAP_TONE: Record<GapStatus, string> = { open: "text-accent", "partially-served": "text-warn", served: "text-muted" };

export function GapText({ status }: { status: GapStatus }) {
  return <span className={`kicker ${GAP_TONE[status]}`}>{GAP_WORD[status]}</span>;
}

export function confidenceWord(value: string): string {
  return value === "Med" ? "Medium" : value;
}

/** Underlined text tabs, the way a report's sections are listed. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex gap-6 overflow-x-auto border-b border-rule">
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`-mb-px shrink-0 border-b-2 pb-2 pt-1 text-sm ${
              on ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 font-mono text-xs tabular-nums text-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

const PARTS: { key: "pain" | "momentum" | "commercial" | "whitespace" | "weakRivals"; label: string; max: number }[] = [
  { key: "pain", label: "Pain", max: 30 },
  { key: "momentum", label: "Momentum", max: 20 },
  { key: "commercial", label: "Commercial intent", max: 20 },
  { key: "whitespace", label: "Whitespace", max: 20 },
  { key: "weakRivals", label: "Weak rivals", max: 10 },
];

/** The score's five parts as a ruled table: what was earned against what was possible. */
export function ScoreTable({ sub }: { sub: Record<(typeof PARTS)[number]["key"], number> }) {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {PARTS.map((p) => (
          <tr key={p.key} className="border-t border-border">
            <td className="w-36 py-1.5 pr-3 text-muted">{p.label}</td>
            <td className="py-1.5">
              <div className="h-[5px] w-full bg-surface-2">
                <div className="fill h-full bg-ink" style={{ width: `${Math.min(100, (sub[p.key] / p.max) * 100)}%` }} />
              </div>
            </td>
            <td className="w-16 py-1.5 pl-3 text-right font-mono tabular-nums">
              {sub[p.key]}
              <span className="text-muted">/{p.max}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ENGINE_LABEL: Record<string, string> = {
  google: "web",
  google_news: "news",
  google_autocomplete: "autocomplete",
  google_trends: "trends",
  google_maps: "maps",
  google_maps_reviews: "maps reviews",
  google_play_product: "play store",
  apple_reviews: "app store",
  google_shopping: "shopping",
  google_jobs: "jobs",
  youtube: "youtube",
};

export function engineLabel(engine: string): string {
  return ENGINE_LABEL[engine] ?? engine;
}

/** Loading placeholder: ruled lines, like a page waiting for its text. */
export function Lines({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="blink h-3 bg-surface-2" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="appear border-l-2 border-border py-1 pl-4 font-serif text-[15px] italic text-muted">{children}</p>;
}
