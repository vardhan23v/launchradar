import type { Metadata } from "next";

import RunPage from "@/components/v3/RunPage";

/** The research API, the same origin next.config.mjs sends /api/* to. */
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
/** How long a link preview may wait for the API before the page settles for the static title. */
const META_TIMEOUT_MS = 2500;
const TITLE_MAX = 80;

/**
 * The static title: what the page says when the API cannot tell it about the run in time. Run
 * pages are per-visitor working documents, not pages for search engines.
 */
const STATIC: Metadata = {
  title: "Search",
  description: "One search: what we looked up, the complaints we found, existing products, and the ideas with their web pages.",
  robots: { index: false, follow: false },
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function trimTitle(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  return q.length > TITLE_MAX ? `${q.slice(0, TITLE_MAX - 1).trimEnd()}…` : q;
}

/**
 * A link preview with the search's own question and summary (GET /api/runs/:id/meta on the
 * research API). Anything that goes wrong, including a slow API, falls back to the static title:
 * this never throws, and never blocks the page for more than a moment.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    if (!/^[\w.-]{1,120}$/.test(id)) return STATIC;
    const res = await fetch(`${API_URL}/api/runs/${encodeURIComponent(id)}/meta`, { cache: "no-store", signal: AbortSignal.timeout(META_TIMEOUT_MS) });
    if (!res.ok) return STATIC;
    const meta = (await res.json()) as unknown;
    if (typeof meta !== "object" || meta === null) return STATIC;
    const { question, summary } = meta as Record<string, unknown>;
    const title = trimTitle(str(question));
    if (!title) return STATIC;
    const description = str(summary) || STATIC.description || "";
    return {
      title,
      description,
      robots: { index: false, follow: false },
      openGraph: { type: "website", siteName: "LaunchRadar", title, description, url: `/runs/${encodeURIComponent(id)}` },
      twitter: { card: "summary", title, description },
    };
  } catch {
    return STATIC;
  }
}

/** One research run (id may be a real run id or a run saved in this browser). The page itself is a client component. */
export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunPage runId={id} />;
}
