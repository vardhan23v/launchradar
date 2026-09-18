import { encodeEvent, replayRunEvents } from "@/lib/stream";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      push("retry: 2000\n\n");
      try {
        for await (const event of replayRunEvents(store, id)) {
          push(encodeEvent(event));
        }
        controller.close();
      } catch (err) {
        push(
          encodeEvent({
            type: "stage",
            stage: "error",
            message: err instanceof Error ? err.message : "stream error",
            level: "error",
          }),
        );
        controller.close();
      }
    },
  });

  return new NextSSEResponse(stream);
}

class NextSSEResponse extends Response {
  constructor(body: ReadableStream) {
    super(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}