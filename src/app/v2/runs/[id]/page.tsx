import RunV2 from "@/components/v2/RunV2";

export default async function V2RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunV2 runId={id} />;
}
