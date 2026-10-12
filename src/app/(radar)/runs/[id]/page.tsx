import type { Metadata } from "next";

import RunPage from "@/components/v3/RunPage";

/**
 * A static title: the run's question is only known to the browser (the page follows the run
 * live), and run pages are per-visitor working documents, not pages for search engines.
 */
export const metadata: Metadata = {
  title: "Research run",
  description: "One research run: its progress, opportunities, problems, competitors, research log and sources.",
  robots: { index: false, follow: false },
};

/** One research run (id may be a real run id or a run saved in this browser). The page itself is a client component. */
export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunPage runId={id} />;
}
