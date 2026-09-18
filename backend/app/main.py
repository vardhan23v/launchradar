"""LaunchRadar backend — FastAPI. The Next.js app is frontend only and proxies /api/* here."""
import threading
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from . import config
from .demo import list_demos, make_id, start_demo_run
from .export import export_markdown
from .pipeline import run_pipeline
from .store import Store
from .stream import encode_event, follow_run_events
from .utils import now_ms

config.load_dotenv()
app = FastAPI(title="LaunchRadar API", docs_url=None, redoc_url=None)
_store: Optional[Store] = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store()
        _store.fail_interrupted_runs()
    return _store


def set_store(store: Store) -> None:  # tests
    global _store
    _store = store


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


@app.on_event("startup")
def _startup() -> None:
    get_store()  # load now, so interrupted runs are closed before the first request


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/runs")
def list_runs() -> dict:
    store = get_store()
    ready, reason = config.pipeline_readiness()
    return {
        "runs": store.list_runs(),
        "demos": list_demos(),
        "budget": {"run": config.run_search_budget(), "monthUsed": store.billed_searches_this_month(),
                   "monthLimit": config.monthly_search_budget()},
        # never includes a key — only whether a new question can be researched, and why not
        "pipeline": {"mode": config.serpapi_mode(), "ready": ready, "reason": reason,
                     "quota": store.quota_block() if config.serpapi_mode() != "replay" else None},
    }


@app.post("/api/runs")
async def create_run(request: Request) -> JSONResponse:
    try:
        body: Any = await request.json()
    except Exception:
        return error(400, "Invalid JSON body")
    if not isinstance(body, dict):
        return error(400, "Invalid JSON body")
    question = body["question"].strip() if isinstance(body.get("question"), str) else ""
    region = body["region"] if isinstance(body.get("region"), str) and body["region"].lower() in config.REGIONS else "in"
    demo = body.get("demo") if isinstance(body.get("demo"), str) else None
    store = get_store()

    if demo:
        if not any(d["slug"] == demo for d in list_demos()):
            return error(404, "unknown demo run")
        return JSONResponse({"id": start_demo_run(store, demo), "mode": "demo"}, status_code=201)
    if not question:
        return error(400, "question is required")
    if len(question) > 300:
        return error(400, "question is too long (max 300 characters)")

    # refuse before creating anything: a run that cannot search would only burn LLM calls and fail
    if config.serpapi_mode() != "replay":
        blocked = store.quota_block()
        if blocked:
            return error(429, blocked)

    run_id = make_id("run")
    store.create_run({"id": run_id, "question": question, "region": region.lower(), "questionType": None, "status": "running",
                      "budget": config.run_search_budget(), "searchesUsed": 0, "createdAt": now_ms(), "finishedAt": None,
                      "demo": False, "demoLabel": None, "rejectedSignals": 0, "error": None})
    ready, reason = config.pipeline_readiness()
    if not ready:
        # fail fast with guidance instead of leaving a run that never progresses
        reason = reason or "Pipeline is not configured."
        store.update_run(run_id, {"status": "failed", "error": reason, "finishedAt": now_ms()})
        store.append_events(run_id, [{"type": "stage", "stage": "error", "message": reason, "level": "error"},
                                     {"type": "status", "status": "failed"},
                                     {"type": "done", "runId": run_id, "searchesUsed": 0}])
        return JSONResponse({"id": run_id, "mode": "failed"}, status_code=201)

    # live, record and replay all run the same pipeline; the SSE stream follows its persisted events
    threading.Thread(target=run_pipeline, args=(store, run_id, question, region.lower()), daemon=True).start()
    return JSONResponse({"id": run_id, "mode": "live"}, status_code=201)


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> Any:
    store = get_store()
    if store.get_run(run_id) is None:
        return error(404, "Run not found")
    view = store.view(run_id)
    # __rows is the server-side cache payload; the browser already gets it as evidence
    view["searchCalls"] = [dict(c, params={k: v for k, v in c["params"].items() if k != "__rows"}) for c in view["searchCalls"]]
    return view


@app.get("/api/runs/{run_id}/export")
def export_run(run_id: str) -> Any:
    store = get_store()
    if store.get_run(run_id) is None:
        return PlainTextResponse("Run not found", status_code=404)
    return PlainTextResponse(export_markdown(store.view(run_id)), media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="launchradar-%s.md"' % run_id})


@app.get("/api/runs/{run_id}/stream")
async def stream_run(run_id: str, request: Request) -> Any:
    store = get_store()
    if store.get_run(run_id) is None:
        return PlainTextResponse("Run not found", status_code=404)
    try:  # EventSource resends the last id it saw when it reconnects
        from_index = int(request.headers.get("last-event-id", "")) + 1
    except ValueError:
        from_index = 0

    async def body():
        yield "retry: 2000\n\n"
        async for index, event in follow_run_events(store, run_id, from_index, request.is_disconnected):
            yield encode_event(index, event)

    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
