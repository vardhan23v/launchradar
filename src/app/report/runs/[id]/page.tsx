import RunClient from "@/components/RunClient";

/** The report view of one run (the original design). */
export default async function ReportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunClient runId={id} />;
}