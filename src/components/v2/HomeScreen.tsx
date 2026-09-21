"use client";

/**
 * LaunchRadar — redesigned Home screen.
 * Drop-in replacement for `src/components/HomeClient.tsx` (see redesign/INTEGRATION.md).
 *
 * This component is *pure*: it never fetches, never reads storage, never navigates. You pass data
 * in and it calls your callbacks out, so `live.ts` / `history.ts` keep working unchanged.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Banner,
  Btn,
  Chip,
  CommandPalette,
  Drawer,
  Empty,
  Kbd,
  Segmented,
  Stat,
  ThemeControls,
  Toasts,
  Topbar,
  useCommandK,
  useGlobalKeys,
  useNow,
  useToasts,
  type PaletteItem,
} from "./primitives";

import {
  BUDGET_SECONDS,
  REGIONS,
  SEARCH_CAP,
  relativeTime,
  type DensityVM,
  type RunVM,
  type ThemeVM,
} from "@/lib/v2/viewModel";

/** Verbatim product rules, copied from the live site so the wording stays consistent. */
export const METHOD_TEXT =
  "Search results are the only source of facts. A model plans the searches and organises what comes back, but it may not add a company, a number or a claim of its own. Every statement must quote its source word for word, or it is thrown out.";

export const METHOD_RULES: string[] = [
  "Search results are the only source of facts.",
  "A model plans the searches and organises what comes back, but it may not add a company, a number or a claim of its own.",
  "Every statement must quote its source word for word, or it is thrown out.",
  "Each gap is then tested by searching for a product that already fills it.",
  "The score is arithmetic on what was counted.",
];

const EXAMPLE_QUESTIONS: string[] = [
  "D2C skincare brands in India",
  "Home fitness equipment subscription",
  "AI bookkeeping tools for freelancers",
];

export interface HomeClientProps {
  /** Most recent first. Recorded demos and live runs both arrive here. */
  runs: RunVM[];
  question: string;
  region: string;
  /** A run is in flight; the form stays readable but locked. */
  busy?: boolean;
  /** Failure of the last attempt. */
  error?: string | null;
  /** False when the server has no credentials, so only recorded runs are usable (F11). */
  liveAvailable: boolean;
  /** Set when history could not be persisted (quota exceeded or storage blocked). */
  historyWarning?: string | null;
  theme: ThemeVM;
  density: DensityVM;
  onTheme: (next: ThemeVM) => void;
  onDensity: (next: DensityVM) => void;
  onChangeQuestion: (next: string) => void;
  onChangeRegion: (next: string) => void;
  onStart: () => void;
  onOpenRun: (id: string) => void;
  onRerun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  onExportRun: (id: string, format: "markdown" | "json" | "csv") => void;
  /** Recorded examples: these run without any credentials, so their slug goes to the API. */
  demos?: { slug: string; label: string; question: string }[];
  onStartDemo?: (slug: string) => void;
  /** Optional slot for extra topbar controls from the host app. */
  topbarExtra?: ReactNode;
}

export default function HomeClient(props: HomeClientProps) {
  const {
    runs, question, region, busy = false, error = null, liveAvailable,
    historyWarning = null, theme, density, onTheme, onDensity,
    onChangeQuestion, onChangeRegion, onStart, onOpenRun, onRerun, onDeleteRun,
    onExportRun, demos = [], onStartDemo, topbarExtra,
  } = props;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  // ref access lives in an event handler, never in the render body
  const focusQuestion = useCallback(() => questionRef.current?.focus(), []);
  const now = useNow(30000);
  const { toasts, push, dismiss } = useToasts();

  useCommandK(() => setPaletteOpen(true));
  useGlobalKeys({
    "/": () => questionRef.current?.focus(),
  });

  const canStart = !busy && question.trim().length > 0 && liveAvailable;
  const lastRun = runs.length > 0 ? runs[0] : undefined;
  const bestScore = useMemo(
    () => runs.reduce((max, r) => Math.max(max, ...r.opportunities.map((o) => o.score), 0), 0),
    [runs],
  );
  /** Hydration-safe: `useNow()` returns 0 until mounted, so timestamps render blank first. */
  const when = (iso: string): string => (now > 0 ? relativeTime(iso, now) : "—");

  /* eslint-disable react-hooks/refs -- the onRun closures only ever run from palette event
     handlers, never during render; the rule cannot see that through the memo */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "new",
        label: "Start a new research run",
        kind: "Action",
        hint: region,
        onRun: () => {
          setPaletteOpen(false);
          focusQuestion();
        },
      },
    ];
    runs.slice(0, 6).forEach((r, i) => {
      items.push({
        id: `run-${r.id}`,
        label: `Open run ${i + 1}: ${r.question}`,
        kind: "Run",
        hint: r.region,
        onRun: () => onOpenRun(r.id),
      });
    });
    for (const rg of REGIONS) {
      items.push({
        id: `region-${rg}`,
        label: `Region: ${rg}`,
        kind: "Region",
        onRun: () => onChangeRegion(rg),
      });
    }
    items.push(
      { id: "theme-dark", label: "Theme: dark", kind: "View", onRun: () => onTheme("dark") },
      { id: "theme-light", label: "Theme: light", kind: "View", onRun: () => onTheme("light") },
      {
        id: "density",
        label: `Density: ${density === "compact" ? "comfortable" : "compact"}`,
        kind: "View",
        onRun: () => onDensity(density === "compact" ? "comfortable" : "compact"),
      },
      { id: "method", label: "How the method works", kind: "Help", onRun: () => setMethodOpen(true) },
    );
    return items;
  }, [runs, region, density, focusQuestion, onOpenRun, onChangeRegion, onTheme, onDensity]);
  /* eslint-enable react-hooks/refs */
  return (
    <div className="lr-root" data-lr-theme={theme === "light" ? "light" : "dark"} data-lr-density={density}>
      <Topbar
        env={<span className="lr-topbar__env">{liveAvailable ? "Live searches" : "Recorded demo"}</span>}
        onOpenPalette={() => setPaletteOpen(true)}
        right={
          <div className="lr-row">
            {topbarExtra}
            <ThemeControls theme={theme} onTheme={onTheme} density={density} onDensity={onDensity} />
          </div>
        }
      />

      <main className="lr-main">
        <div className="lr-home">
          <section className="lr-hero">
            <span className="lr-hero__eyebrow">Market signal, with receipts</span>
            <h1 className="lr-hero__title">What market are you looking at?</h1>
            <p className="lr-hero__sub">
              Research runs on search results alone. Every claim carries the exact words it came from,
              or it is thrown out — so you can check the work instead of trusting it.
            </p>
          </section>

          {!liveAvailable ? (
            <Banner
              tone="warn"
              title="Recorded demo only"
              action={
                <Btn size="sm" variant="ghost" onClick={() => setMethodOpen(true)}>
                  How to enable live runs
                </Btn>
              }
            >
              This deployment has no search or model credentials, so new questions cannot run here.
              Set <code className="lr-mono">SERPAPI_MODE</code> and{" "}
              <code className="lr-mono">LLM_API_KEY</code> in the hosting project, then redeploy.
            </Banner>
          ) : null}

          {error ? (
            <Banner tone="bad" title="The run did not finish">
              {error}
            </Banner>
          ) : null}

          {historyWarning ? (
            <Banner tone="info" title="Recent runs may not survive a reload">
              {historyWarning}
            </Banner>
          ) : null}

          <form
            className="lr-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (canStart) onStart();
            }}
          >
            <label className="lr-field">
              <span className="lr-label">What market are you looking at?</span>
              <textarea
                ref={questionRef}
                className="lr-textarea"
                value={question}
                onChange={(e) => onChangeQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canStart) onStart();
                  }
                }}
                placeholder="e.g. D2C skincare brands in India"
                rows={2}
                disabled={busy}
              />
            </label>

            <div className="lr-row lr-row--wrap">
              <Segmented
                ariaLabel="Region"
                options={REGIONS.map((r) => ({ value: r, label: r }))}
                value={region}
                onChange={onChangeRegion}
              />
              <div className="lr-spacer" />
              <Chip>{`Uses up to ${SEARCH_CAP} searches`}</Chip>
              <Chip>{`${BUDGET_SECONDS}s budget`}</Chip>
            </div>

            <div className="lr-row lr-row--wrap">
              <span className="lr-help">Try:</span>
              {EXAMPLE_QUESTIONS.map((q) => (
                <Btn key={q} size="sm" variant="ghost" onClick={() => onChangeQuestion(q)}>
                  {q}
                </Btn>
              ))}
            </div>

            {demos.length > 0 && onStartDemo ? (
              <div className="lr-row lr-row--wrap">
                <span className="lr-help">Recorded example:</span>
                {demos.map((d) => (
                  <Btn
                    key={d.slug}
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onStartDemo(d.slug)}
                    title="Runs without any credentials"
                  >
                    {d.question}
                  </Btn>
                ))}
              </div>
            ) : null}

            <div className="lr-row lr-row--wrap">
              <Btn type="submit" variant="primary" size="lg" disabled={!canStart}>
                {busy ? "Researching…" : "Start research"}
              </Btn>
              {lastRun ? (
                <Btn size="lg" variant="ghost" onClick={() => onOpenRun(lastRun.id)}>
                  Open last run
                </Btn>
              ) : null}
              <div className="lr-spacer" />
              <span className="lr-help">
                <Kbd>Enter</Kbd> to run · <Kbd>/</Kbd> to focus · <Kbd>⌘K</Kbd> for commands
              </span>
            </div>
          </form>
          <section className="lr-stack" aria-labelledby="runs-heading">
            <div className="lr-row">
              <h2 id="runs-heading" style={{ fontSize: 15, margin: 0 }}>
                Runs
              </h2>
              <span className="lr-count">{runs.length > 0 ? `${runs.length} stored` : "none yet"}</span>
              <div className="lr-spacer" />
              <Btn size="sm" variant="ghost" onClick={() => setPaletteOpen(true)} ariaLabel="Search runs">
                Search runs
              </Btn>
            </div>

            {runs.length > 0 ? (
              <>
                <div className="lr-stats">
                  <Stat k="Stored runs" v={runs.length} />
                  <Stat k="Best score" v={bestScore > 0 ? `${Math.round(bestScore)}/100` : "—"} />
                  <Stat
                    k="Searches used"
                    v={runs.reduce((n, r) => n + r.searchesUsed, 0)}
                    title="Across all stored runs"
                  />
                </div>

                <ul className="lr-runs" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {runs.map((r) => (
                    <li key={r.id} className="lr-run-item">
                      <button
                        type="button"
                        onClick={() => onOpenRun(r.id)}
                        style={{
                          background: "none", border: 0, padding: 0, textAlign: "left",
                          font: "inherit", color: "inherit", cursor: "pointer",
                        }}
                      >
                        <div className="lr-run-item__q">{r.question}</div>
                        <div className="lr-run-item__meta">
                          <Chip tone={r.demo ? "info" : "ok"} dot>
                            {r.demo ? "Demo" : "Live"}
                          </Chip>
                          <span>{r.region}</span>
                          <span>·</span>
                          <span>{r.status === "done" ? "Complete" : r.status === "partial" ? "Finished early" : r.status}</span>
                          <span>·</span>
                          <span>{r.opportunityCount ?? r.opportunities.length} opportunities</span>
                          <span>·</span>
                          <span>{r.searchesUsed}/{r.searchesCap} searches</span>
                          <span>·</span>
                          <span className="lr-num">{when(r.startedAt)}</span>
                        </div>
                      </button>

                      <div className="lr-row lr-run-item__acts">
                        <Btn size="sm" variant="ghost" onClick={() => onOpenRun(r.id)}>
                          Open
                        </Btn>
                        <Btn
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            onRerun(r.id);
                            push("Re-running that question…");
                          }}
                        >
                          Re-run
                        </Btn>
                        <span className="lr-menu-wrap">
                          <Btn
                            size="sm"
                            variant="quiet"
                            ariaLabel={`More actions for ${r.question}`}
                            onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
                          >
                            ⋯
                          </Btn>
                          {menuFor === r.id ? (
                            <div className="lr-menu" role="menu">
                              {(["markdown", "json", "csv"] as const).map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  role="menuitem"
                                  className="lr-menu__item"
                                  onClick={() => {
                                    onExportRun(r.id, f);
                                    setMenuFor(null);
                                    push(`Exporting ${f.toUpperCase()}…`);
                                  }}
                                >
                                  Export {f}
                                </button>
                              ))}
                              <button
                                type="button"
                                role="menuitem"
                                className="lr-menu__item lr-menu__item--danger"
                                onClick={() => {
                                  onDeleteRun(r.id);
                                  setMenuFor(null);
                                  push("Run removed");
                                }}
                              >
                                Delete run
                              </button>
                            </div>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty
                title="No runs stored yet"
                text="Ask a question above. Finished runs are kept in this browser, newest first, so you can reopen them later."
              />
            )}
          </section>
          <section className="lr-stack" aria-labelledby="method-heading">
            <h2 id="method-heading" style={{ fontSize: 15, margin: 0 }}>
              Method
            </h2>
            <p className="lr-help" style={{ margin: 0 }}>{METHOD_TEXT}</p>
            <ol className="lr-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
              {METHOD_RULES.map((rule, i) => (
                <li key={rule} className="lr-rule">
                  <span className="lr-rule__n" aria-hidden="true">{i + 1}</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
            <div className="lr-row">
              <Btn size="sm" variant="ghost" onClick={() => setMethodOpen(true)}>
                Read the full method
              </Btn>
            </div>
          </section>
        </div>
      </main>

      <Drawer
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        title="How this works"
        subtitle={liveAvailable ? "Live searches enabled" : "This deployment runs recorded demos only"}
        footer={
          <>
            <Btn size="sm" variant="primary" onClick={() => setMethodOpen(false)}>
              Got it
            </Btn>
          </>
        }
      >
        <div className="lr-prose">
          <p>{METHOD_TEXT}</p>
          <h3>What that means in practice</h3>
          <ol className="lr-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
            {METHOD_RULES.map((rule, i) => (
              <li key={rule} className="lr-rule">
                <span className="lr-rule__n" aria-hidden="true">{i + 1}</span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
          <h3>Limits you should know</h3>
          <p>
            A run is capped at {SEARCH_CAP} searches and {BUDGET_SECONDS} seconds. When the clock runs
            out the optional stages are skipped rather than faked, and the run is labelled
            &ldquo;finished early&rdquo; so you can tell the difference.
          </p>
          {!liveAvailable ? (
            <>
              <h3>Enabling live runs</h3>
              <p>
                Set these in the hosting project, then redeploy:{" "}
                <code className="lr-mono">SERPAPI_MODE=live</code>,{" "}
                <code className="lr-mono">SERPAPI_API_KEY</code>,{" "}
                <code className="lr-mono">LLM_PROVIDER=openai</code>,{" "}
                <code className="lr-mono">LLM_API_KEY</code>,{" "}
                <code className="lr-mono">LLM_BASE_URL</code>,{" "}
                <code className="lr-mono">LLM_MODEL</code>.
              </p>
            </>
          ) : null}
        </div>
      </Drawer>

      <Toasts toasts={toasts} onDismiss={dismiss} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
    </div>
  );
}



