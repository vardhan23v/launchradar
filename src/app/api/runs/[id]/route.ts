import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const view = store.view(id);
  return NextResponse.json(view);
}