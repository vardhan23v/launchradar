"use client";

/**
 * The research log, folded into the redesigned run screen. This is the report view's strongest
 * transparency feature: every search call with its engine, result count and latency, plus any
 * stage errors. The redesigned run screen would otherwise lose it.
 */

import { Card } from "./primitives";
import type { LogEntryVM } from "@/lib/v2/viewModel";

const MAX_ROWS = 120;

export default function ResearchLog({ entries, live }: { entries: LogEntryVM[]; live: boolean }) {
  const rows = entries.slice(-MAX_ROWS);
  const dropped = entries.length - rows.length;
  return (
    <Card title={entries.length > 0 ? `Research log · ${entries.length}` : "Research log"}>
      {dropped > 0 ? (
        <p className="lr-help" style={{ margin: "0 0 8px" }}>
          The earliest {dropped} rows are not shown.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="lr-help" style={{ margin: 0 }}>
          {live ? "Waiting for the first search." : "No log was kept for this run."}
        </p>
      ) : (
        <ol
          className="lr-stack"
          style={{ listStyle: "none", margin: 0, padding: 0, gap: 10, maxHeight: 320, overflowY: "auto" }}
          aria-live={live ? "polite" : undefined}
        >
          {rows.map((e) =>
            e.kind === "stage" ? (
              <li key={e.id} className="lr-label" style={{ marginTop: 2 }}>
                {e.title}
              </li>
            ) : (
              <li key={e.id} className="lr-stack" style={{ gap: 2 }}>
                <span style={{ overflowWrap: "anywhere", textDecoration: e.tone === "bad" ? "line-through" : undefined }}>
                  {e.title}
                </span>
                {e.meta ? (
                  <span
                    className={e.tone === "bad" ? "lr-err" : "lr-muted"}
                    style={{ fontFamily: "var(--lr-mono)", fontSize: 11 }}
                  >
                    {e.meta}
                  </span>
                ) : null}
              </li>
            ),
          )}
        </ol>
      )}
    </Card>
  );
}
