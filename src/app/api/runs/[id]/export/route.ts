import { exportMarkdown, markdownFileName } from "@/lib/export";
import { store } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const view = store.view(id);
    const md = exportMarkdown(view);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${markdownFileName(id)}"`,
      },
    });
  } catch {
    return new Response("Run not found", { status: 404 });
  }
}