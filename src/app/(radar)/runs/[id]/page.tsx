import RunPage from "@/components/v3/RunPage";

/** One research run in the new design (id may be a real run id, a saved run id, or `live`). */
export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunPage runId={id} />;
}
