"use client";

/**
 * LaunchRadar redesign — primitives.
 * Imports nothing but React. No router, no fetch, no storage: every effect is a callback prop.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  formatDuration,
  scoreBand,
  type DensityVM,
  type EvidenceVM,
  type MetricVM,
  type StageVM,
  type ThemeVM,
} from "@/lib/v2/viewModel";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- button */

export type BtnVariant = "default" | "primary" | "ghost" | "quiet" | "danger";

export interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  disabled?: boolean;
  title?: string;
  /** Required for icon-only buttons (no visible text to name the control). */
  ariaLabel?: string;
  type?: "button" | "submit";
  testId?: string;
}

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  active = false,
  disabled = false,
  title,
  ariaLabel,
  type = "button",
  testId,
}: BtnProps) {
  return (
    <button
      type={type}
      className={cx(
        "lr-btn",
        variant !== "default" && `lr-btn--${variant}`,
        size !== "md" && `lr-btn--${size}`,
        active && "lr-btn--on",
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active ? true : undefined}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- chip / stat / kbd */

export function Chip({
  children,
  tone = "neutral",
  dot = false,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad" | "info";
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={cx("lr-chip", tone !== "neutral" && `lr-chip--${tone}`)} title={title}>
      {dot ? <span className="lr-chip__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Stat({ k, v, title }: { k: string; v: ReactNode; title?: string }) {
  return (
    <div className="lr-stat" title={title}>
      <div className="lr-stat__k">{k}</div>
      <div className="lr-stat__v">{v}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="lr-kbd">{children}</span>;
}

/* ---------------------------------------------------------------- card */

export function Card({
  title,
  actions,
  children,
  footer,
  interactive = false,
  selected = false,
  onSelect,
  className,
  bodyClassName,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  interactive?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={cx("lr-card", interactive && "lr-card--interactive", selected && "lr-card--on", className)}
      onClick={interactive && onSelect ? onSelect : undefined}
      style={style}
    >
      {title !== undefined ? (
        <header className="lr-card__head">
          <div className="lr-card__title">{title}</div>
          <div className="lr-spacer" />
          {/* Actions must not re-trigger the card's own select handler. */}
          <div className="lr-row" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        </header>
      ) : null}
      <div className={cx("lr-card__body", bodyClassName)}>{children}</div>
      {footer ? <footer className="lr-card__foot">{footer}</footer> : null}
    </section>
  );
}
/* ---------------------------------------------------------------- segmented + tabs */

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<SegOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="lr-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx("lr-seg__opt", o.value === value && "lr-seg__opt--on")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="lr-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={cx("lr-tab", t.id === value && "lr-tab--on")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined ? <span className="lr-tab__count lr-num">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- meters */

export function Meter({
  label,
  value,
  max = 100,
  tone = "info",
  hint,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: "info" | "ok" | "warn" | "bad";
  hint?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cx("lr-meter", tone !== "info" && `lr-meter--${tone}`)} title={hint}>
      <div className="lr-meter__top">
        <span>{label}</span>
        <span className="lr-meter__val">
          {value}/{max}
        </span>
      </div>
      <div className="lr-meter__track">
        <div className="lr-meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MetricBars({ metrics }: { metrics: MetricVM[] }) {
  return (
    <div className="lr-op__metrics">
      {metrics.slice(0, 3).map((m) => (
        <Meter key={m.id} label={m.label} value={m.value} max={m.max} hint={m.hint} />
      ))}
    </div>
  );
}

export function ScoreRing({
  score,
  size = 56,
  label = "Opportunity score",
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const stroke = Math.max(4, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div
      className={cx("lr-ring", `lr-ring--${scoreBand(score)}`)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(score)} of 100`}
    >
      <svg className="lr-ring__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="lr-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="lr-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="lr-ring__center">
        <span className="lr-ring__num">{Math.round(score)}</span>
      </div>
    </div>
  );
}
/* ---------------------------------------------------------------- stage rail */

function glyphFor(status: StageVM["status"]): string {
  if (status === "done") return "✓";
  if (status === "failed") return "!";
  if (status === "skipped") return "–";
  return "";
}

export function StageRail({ stages, compact = false }: { stages: StageVM[]; compact?: boolean }) {
  return (
    <ol className="lr-rail" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Run progress">
      {stages.map((s, i) => (
        <li key={s.id} className={cx("lr-rail__item", `is-${s.status}`)}>
          {i < stages.length - 1 ? <span className="lr-rail__line" aria-hidden="true" /> : null}
          <span className="lr-rail__dot" aria-hidden="true">
            {glyphFor(s.status)}
          </span>
          <div>
            <div className="lr-row">
              <span className="lr-rail__label">{s.label}</span>
              <span className="lr-spacer" />
              {s.durationMs !== undefined ? (
                <span className="lr-rail__meta lr-num">{formatDuration(s.durationMs / 1000)}</span>
              ) : null}
            </div>
            {!compact && s.detail ? <div className="lr-rail__meta">{s.detail}</div> : null}
            {!compact && s.searchesPlanned !== undefined && s.searchesPlanned > 0 ? (
              <>
                <div className="lr-rail__meta lr-num">
                  {s.searchesDone ?? 0} of {s.searchesPlanned} searches
                </div>
                <div className="lr-rail__bar">
                  <i style={{ width: `${Math.min(100, ((s.searchesDone ?? 0) / s.searchesPlanned) * 100)}%` }} />
                </div>
              </>
            ) : null}
            {compact && s.status === "skipped" ? (
              <div className="lr-rail__meta">Skipped — time budget</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- budget ring (F3) */

export function BudgetRing({
  elapsedSeconds,
  budgetSeconds,
  size = 64,
}: {
  elapsedSeconds: number;
  budgetSeconds: number;
  size?: number;
}) {
  const remaining = Math.max(0, Math.round(budgetSeconds - elapsedSeconds));
  const used = budgetSeconds > 0 ? elapsedSeconds / budgetSeconds : 0;
  const band = used > 0.9 ? "bad" : used > 0.75 ? "warn" : "ok";
  const stroke = Math.max(4, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={cx("lr-ring", `lr-ring--${band}`)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${formatDuration(remaining)} left of a ${formatDuration(budgetSeconds)} budget`}
      title={`${formatDuration(elapsedSeconds)} elapsed of ${formatDuration(budgetSeconds)}`}
    >
      <svg className="lr-ring__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="lr-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="lr-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * Math.min(1, used)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="lr-ring__center">
        <span>
          <span className="lr-ring__num" style={{ fontSize: Math.round(size / 4) }}>
            {remaining}
          </span>
          <span className="lr-ring__unit">s left</span>
        </span>
      </div>
    </div>
  );
}
/* ---------------------------------------------------------------- banner / empty / skeleton */

export function Banner({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "bad";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cx("lr-banner", `lr-banner--${tone}`)} role={tone === "bad" ? "alert" : "status"}>
      <div>
        {title ? <div className="lr-banner__title">{title}</div> : null}
        {children}
      </div>
      {action ? (
        <>
          <div className="lr-spacer" />
          <div className="lr-row">{action}</div>
        </>
      ) : null}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="lr-empty">
      <div className="lr-empty__title">{title}</div>
      {text ? <p className="lr-empty__text">{text}</p> : null}
      {action ? (
        <div className="lr-row" style={{ justifyContent: "center", marginTop: 12 }}>
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function Skeleton({ lines = 3, variant = "line" }: { lines?: number; variant?: "line" | "card" }) {
  if (variant === "card") return <div className="lr-skel lr-skel--card" aria-hidden="true" />;
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="lr-skel lr-skel--line" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- evidence (F4) */

export function EvidenceCard({ ev, onCopy }: { ev: EvidenceVM; onCopy?: (text: string) => void }) {
  return (
    <article className="lr-ev">
      <blockquote className="lr-ev__quote">{ev.quote}</blockquote>
      <div className="lr-ev__meta">
        {ev.domain ? <span className="lr-domain">{ev.domain}</span> : null}
        {ev.title ? <span>{ev.title}</span> : null}
        {ev.sourceDate ? <span className="lr-num">published {ev.sourceDate}</span> : null}
        <span className="lr-spacer" />
        {ev.url ? (
          <a className="lr-ev__link" href={ev.url} target="_blank" rel="noreferrer noopener">
            Open source
          </a>
        ) : null}
        {onCopy ? (
          <button
            type="button"
            className="lr-btn lr-btn--quiet lr-btn--sm"
            onClick={() => onCopy(`${ev.quote}\n${ev.url}`)}
            aria-label="Copy quote and link"
          >
            Copy
          </button>
        ) : null}
      </div>
    </article>
  );
}
/* ---------------------------------------------------------------- toasts */

export interface ToastVM {
  id: string;
  text: string;
  tone: "ok" | "bad";
}

export interface ToastApi {
  toasts: ToastVM[];
  push: (text: string, tone?: "ok" | "bad") => void;
  dismiss: (id: string) => void;
}

export function useToasts(ttlMs = 3200): ToastApi {
  const [toasts, setToasts] = useState<ToastVM[]>([]);
  const seq = useRef(0);
  const push = useCallback(
    (text: string, tone: "ok" | "bad" = "ok") => {
      seq.current += 1;
      const id = `t${seq.current}`;
      setToasts((prev) => [...prev, { id, text, tone }]);
      if (typeof window !== "undefined") {
        window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttlMs);
      }
    },
    [ttlMs],
  );
  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: ToastVM[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="lr-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("lr-toast", t.tone === "bad" && "lr-toast--bad")}>
          <span>{t.text}</span>
          <button
            type="button"
            className="lr-btn lr-btn--quiet lr-btn--sm"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer (F4) */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Inline mode renders as a sticky panel in the grid instead of an overlay (>=1280px layouts). */
  inline?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || inline) return;
    if (typeof document === "undefined") return;
    const node = ref.current;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      } else if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      restoreRef.current?.focus();
    };
  }, [open, inline, onClose]);

  if (!open) return null;

  const body = (
    <div
      className={cx("lr-drawer", inline && "lr-drawer--inline")}
      ref={ref}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-label={typeof title === "string" ? title : "Details"}
      tabIndex={-1}
    >
      <header className="lr-drawer__head">
        <div>
          <div className="lr-drawer__title">{title}</div>
          {subtitle ? <div className="lr-help">{subtitle}</div> : null}
        </div>
        <div className="lr-spacer" />
        <button
          type="button"
          className="lr-btn lr-btn--quiet lr-btn--icon"
          onClick={onClose}
          aria-label="Close panel"
        >
          ×
        </button>
      </header>
      <div className="lr-drawer__body">{children}</div>
      {footer ? <footer className="lr-drawer__foot">{footer}</footer> : null}
    </div>
  );

  if (inline) return body;
  return (
    <>
      <div className="lr-scrim" onClick={onClose} aria-hidden="true" />
      {body}
    </>
  );
}
/* ---------------------------------------------------------------- command palette (F2) */

export interface PaletteItem {
  id: string;
  label: string;
  /** Grouping label rendered on the right, e.g. "Run", "Region", "Action". */
  kind: string;
  hint?: string;
  onRun: () => void;
}

export function CommandPalette({
  open,
  onClose,
  items,
  placeholder = "Search runs, regions and actions…",
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the palette when it opens
      setQuery("");
      setIdx(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.kind} ${i.hint ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  const active = filtered.length === 0 ? -1 : Math.min(idx, filtered.length - 1);

  if (!open) return null;

  const run = (i: number) => {
    const item = filtered[i];
    if (!item) return;
    item.onRun();
    onClose();
  };

  return (
    <>
      <div className="lr-scrim" onClick={onClose} aria-hidden="true" />
      <div className="lr-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="lr-palette__input"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((n) => (filtered.length === 0 ? 0 : (n + 1) % filtered.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((n) => (filtered.length === 0 ? 0 : (n - 1 + filtered.length) % filtered.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="lr-palette__list">
          {filtered.length === 0 ? (
            <li className="lr-palette__item lr-muted">No matches</li>
          ) : (
            filtered.map((i, n) => (
              <li
                key={i.id}
                className={cx("lr-palette__item", n === active && "lr-palette__item--on")}
                onMouseEnter={() => setIdx(n)}
                onClick={() => run(n)}
              >
                <span>{i.label}</span>
                {i.hint ? <span className="lr-help">{i.hint}</span> : null}
                <span className="lr-palette__kind">{i.kind}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- keyboard hooks */

/**
 * Global single-key shortcuts (F6). Ignored while typing or with modifiers held, so the
 * triage keys can never steal a keystroke from the question field.
 */
export function useGlobalKeys(bindings: Record<string, (e: KeyboardEvent) => void>): void {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      const fn = latest.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function useCommandK(onOpen: () => void): void {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        latest.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * A ticking clock so elapsed time and "3 min ago" stay live.
 * Starts at 0 on purpose: `Date.now()` differs between server render and hydration, so components
 * must treat 0 as "not mounted yet" and render a placeholder until this returns non-zero.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the clock at mount, not one tick late
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
/* ---------------------------------------------------------------- topbar + theme */

export function Topbar({
  env,
  onHome,
  onOpenPalette,
  right,
}: {
  env?: ReactNode;
  onHome?: () => void;
  onOpenPalette?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="lr-topbar">
      <span className="lr-brand">
        <span className="lr-brand__mark" aria-hidden="true" />
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
          >
            LaunchRadar
          </button>
        ) : (
          <span>LaunchRadar</span>
        )}
      </span>
      {env}
      <div className="lr-spacer" />
      {onOpenPalette ? (
        <Btn variant="ghost" size="sm" onClick={onOpenPalette} ariaLabel="Open command palette">
          Search <Kbd>⌘K</Kbd>
        </Btn>
      ) : null}
      {right}
    </header>
  );
}

export function ThemeControls({
  theme,
  onTheme,
  density,
  onDensity,
}: {
  theme: ThemeVM;
  onTheme: (next: ThemeVM) => void;
  density: DensityVM;
  onDensity: (next: DensityVM) => void;
}) {
  return (
    <div className="lr-row">
      <Segmented<ThemeVM>
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "Auto" },
        ]}
        value={theme}
        onChange={onTheme}
        ariaLabel="Colour theme"
      />
      <Btn
        size="sm"
        variant="ghost"
        onClick={() => onDensity(density === "compact" ? "comfortable" : "compact")}
        title="Toggle row density"
        ariaLabel="Toggle row density"
      >
        {density === "compact" ? "Compact" : "Comfortable"}
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------------- clipboard + files (F4/F9) */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path below */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function saveTextFile(filename: string, mime: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}






