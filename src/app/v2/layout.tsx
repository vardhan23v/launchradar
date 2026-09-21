import type { Metadata } from "next";
import "./lr.css";

/**
 * Layout for the redesigned triage screens under /v2. It imports the scoped design system once;
 * the report view at / and /runs/[id] keeps the original globals.css untouched.
 */
export const metadata: Metadata = {
  title: "LaunchRadar — Triage",
  description: "Market research triage where every claim links to the search result it came from.",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return children;
}
