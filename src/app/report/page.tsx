import type { Metadata } from "next";

import HomeClient from "@/components/HomeClient";

export const metadata: Metadata = {
  title: "LaunchRadar — Report view",
  description: "Market research where every claim links to the search result it came from.",
};

/** The original home page (the report view). Its run pages stay at /runs/[id]. */
export default function ReportHome() {
  return <HomeClient />;
}
