import { NextResponse } from "next/server";
import { startRun } from "@/lib/pipeline/run";
import { store } from "@/lib/store";
import { listDemoSlugs } from "@/lib/pipeline/demo";

export async function GET() {
  const runs = store.listRuns();
  return NextResponse.json({
    runs,
    demos: listDemoSlugs().map((slug) => ({
      slug,
      label: "AI tools for college students (India)",
      question: "AI tools for college students in India",
      region: "in",
    })),
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const question = typeof (body as { question?: unknown }).question === "string"
    ? (body as { question: string }).question.trim()
    : "";
  const region = typeof (body as { region?: unknown }).region === "string"
    ? (body as { region: string }).region
    : "in";
  const demoSlug = typeof (body as { demo?: unknown }).demo === "string"
    ? (body as { demo: string }).demo
    : null;

  if (!question && !demoSlug) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const result = startRun(store, { question: question || "demo", region, demoSlug });
  return NextResponse.json(
    { id: result.runId, mode: result.mode },
    { status: result.mode === "failed" ? 200 : 201 },
  );
}