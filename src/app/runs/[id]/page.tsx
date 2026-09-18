import RunClient from "@/components/RunClient";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunClient runId={id} />;
}