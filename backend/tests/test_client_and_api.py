import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main
from app.demo import start_demo_run
from app.engines import hash_params, to_raw_params
from app.serpapi import BudgetExceeded, SerpApiService
from app.stream import encode_event, follow_run_events
from conftest import make_run

ORGANIC = {"search_metadata": {"id": "sim_1"}, "organic_results": [{"title": "T", "link": "https://a.com", "snippet": "S"}]}


def transport(handler, calls):
    def wrapped(request):
        calls.append(request)
        return handler(request)
    return httpx.MockTransport(wrapped)


def test_budget_guard_throws_before_any_cost(store, monkeypatch):
    monkeypatch.setenv("SERPAPI_MODE", "live")
    monkeypatch.setenv("SERPAPI_API_KEY", "secret-key-123")
    calls = []
    store.create_run(make_run(id="r1", budget=1, searchesUsed=1))
    serp = SerpApiService(store, transport=transport(lambda r: httpx.Response(200, json=ORGANIC), calls))
    with pytest.raises(BudgetExceeded):
        serp.search("google", {"q": "x"}, "r1", "d", 1)
    assert calls == []
    assert store.search_calls_for("r1")[0]["status"] == "skipped"


def test_replay_missing_fixture_fails_loudly_and_fixture_replays(store, tmp_path):
    store.create_run(make_run(id="r1"))
    serp = SerpApiService(store, fixture_dir=tmp_path)
    with pytest.raises(FileNotFoundError, match="missing fixture"):
        serp.search("google", {"q": "zzz"}, "r1", "d", 1)

    phash = hash_params("google", to_raw_params("google", {"q": "ai tools"}, "in"))
    (tmp_path / ("%s.json" % phash)).write_text(json.dumps(ORGANIC))
    out = serp.search("google", {"q": "ai tools"}, "r1", "d", 2)
    assert out["evidence"][0]["id"] == "E1" and out["call"]["billed"] is False
    assert out["call"]["serpapiSearchId"] == "sim_1"
    assert store.get_run("r1")["searchesUsed"] == 1


def test_live_cache_region_and_key_redaction(store, monkeypatch):
    monkeypatch.setenv("SERPAPI_MODE", "live")
    monkeypatch.setenv("SERPAPI_API_KEY", "secret-key-123")
    calls = []
    store.create_run(make_run(id="r1", region="us"))
    serp = SerpApiService(store, transport=transport(lambda r: httpx.Response(200, json=ORGANIC), calls))
    a = serp.search("google", {"q": "x"}, "r1", "d", 1)
    b = serp.search("google", {"q": "x"}, "r1", "d", 2)
    assert len(calls) == 1 and a["cached"] is False and b["cached"] is True  # same params twice → one network call
    assert store.get_run("r1")["searchesUsed"] == 1
    assert calls[0].url.params["gl"] == "us" and calls[0].url.params["google_domain"] == "google.com"
    assert "secret-key-123" not in json.dumps(store.mem)  # the key is never persisted


def test_retry_on_5xx_only(store, monkeypatch):
    monkeypatch.setenv("SERPAPI_MODE", "live")
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    store.create_run(make_run(id="r1"))
    calls = []
    answers = iter([httpx.Response(503, text="boom"), httpx.Response(200, json={})])
    SerpApiService(store, transport=transport(lambda r: next(answers), calls)).search("google", {"q": "five"}, "r1", "d", 1)
    assert len(calls) == 2

    calls2 = []
    serp = SerpApiService(store, transport=transport(lambda r: httpx.Response(401, text="bad key api_key=k"), calls2))
    with pytest.raises(RuntimeError, match="401"):
        serp.search("google", {"q": "four"}, "r1", "d", 2)
    assert len(calls2) == 1
    failed = [c for c in store.search_calls_for("r1") if c["status"] == "failed"][0]
    assert failed["billed"] is False and "api_key=k" not in failed["error"]


def test_monthly_budget_counts_billed_searches_across_runs(store, monkeypatch):
    monkeypatch.setenv("SERPAPI_MODE", "live")
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    monkeypatch.setenv("MONTHLY_SEARCH_BUDGET", "1")
    calls = []
    store.create_run(make_run(id="r1"))
    store.create_run(make_run(id="r2"))
    serp = SerpApiService(store, transport=transport(lambda r: httpx.Response(200, json={}), calls))
    serp.search("google", {"q": "one"}, "r1", "d", 1)
    with pytest.raises(BudgetExceeded):
        serp.search("google", {"q": "two"}, "r2", "d", 1)
    assert len(calls) == 1


def _collect(store, run_id, from_index=0, stop_after=None):
    async def go():
        seen = []
        async def cancelled():
            return stop_after is not None and len(seen) >= stop_after
        async for index, event in follow_run_events(store, run_id, from_index, cancelled):
            seen.append((index, event["type"]))
        return seen
    return asyncio.run(go())


def test_stream_never_completes_a_live_run(store):
    store.create_run(make_run(id="r1"))
    store.append_events("r1", [{"type": "stage", "stage": "planner", "message": "m", "level": "info"}])
    assert _collect(store, "r1", stop_after=1) == [(0, "stage")]
    assert store.get_run("r1")["status"] == "running"


def test_stream_replays_demo_completes_it_and_resumes(store):
    run_id = start_demo_run(store, "ai-tools-college-india")
    seen = _collect(store, run_id)
    assert store.get_run(run_id)["status"] == "complete"
    assert [i for i, _ in seen] == list(range(len(seen))) and seen[-1][1] == "done"
    assert _collect(store, run_id, from_index=len(seen) - 2) == seen[-2:]


def test_api_routes(store):
    main.set_store(store)
    client = TestClient(main.app)
    home = client.get("/api/runs").json()
    assert home["pipeline"]["ready"] is False and home["demos"][0]["searches"] == 8
    assert client.get("/api/runs/nope").status_code == 404
    assert client.get("/api/runs/nope/stream").status_code == 404
    assert client.get("/api/runs/nope/export").status_code == 404
    assert client.post("/api/runs", json={"demo": "../../package"}).status_code == 404
    assert client.post("/api/runs", json={}).status_code == 400
    assert client.post("/api/runs", content="{bad").status_code == 400
    assert client.post("/api/runs", json={"question": "x" * 301}).status_code == 400

    failed = client.post("/api/runs", json={"question": "meal kits", "region": "us"}).json()
    assert failed["mode"] == "failed"
    assert "LLM_PROVIDER" in client.get("/api/runs/%s" % failed["id"]).json()["run"]["error"]

    demo = client.post("/api/runs", json={"demo": "ai-tools-college-india"}).json()
    body = client.get("/api/runs/%s/stream" % demo["id"]).text
    assert body.count("\nid: ") + body.startswith("id: ") >= 25 and '"type": "done"' in body
    view = client.get("/api/runs/%s" % demo["id"]).json()
    assert view["run"]["status"] == "complete" and len(view["evidence"]) == 34
    assert all("__rows" not in c["params"] for c in view["searchCalls"])
    md = client.get("/api/runs/%s/export" % demo["id"])
    assert md.headers["content-type"].startswith("text/markdown") and "## Opportunities (ranked)" in md.text


def test_quota_is_refused_up_front_with_a_wait_time(store, monkeypatch):
    from app.utils import now_ms
    monkeypatch.setenv("SERPAPI_MODE", "live")
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("HOURLY_SEARCH_GUARD", "2")
    now = now_ms()
    assert store.quota_block(now) is None
    store.add_search_calls([{"runId": "x", "billed": True, "createdAt": now - 50 * 60_000, "status": "ok"},
                            {"runId": "x", "billed": True, "createdAt": now - 5 * 60_000, "status": "ok"},
                            {"runId": "x", "billed": False, "createdAt": now, "status": "ok"}])  # cache hits never count
    assert "about 10 minutes" in store.quota_block(now)

    main.set_store(store)
    client = TestClient(main.app)
    res = client.post("/api/runs", json={"question": "meal kits"})
    assert res.status_code == 429 and "hourly search limit" in res.json()["error"]
    assert store.list_runs() == []  # nothing was created, no LLM call was spent
    assert "hourly" in client.get("/api/runs").json()["pipeline"]["quota"]
    # the recorded example costs nothing, so it still works
    assert client.post("/api/runs", json={"demo": "ai-tools-college-india"}).status_code == 201


def _events(body):
    return [json.loads(line[5:]) for line in body.splitlines() if line.startswith("data:")]


def test_single_request_run_streams_results_and_needs_no_server_memory(store, monkeypatch):
    monkeypatch.setenv("LAUNCHRADAR_INLINE", "1")
    main.set_store(store)
    client = TestClient(main.app)
    assert client.get("/api/runs").json()["pipeline"]["inline"] is True

    res = client.post("/api/runs/live", json={"demo": "ai-tools-college-india"})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    events = _events(res.text)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "view" and kinds[-1] == "done" and kinds[-2] == "view"  # results arrive before `done`
    final = events[-2]["view"]
    assert final["run"]["status"] == "complete" and len(final["opportunities"]) == 2 and len(final["evidence"]) == 34
    assert all("__rows" not in c["params"] for c in final["searchCalls"])
    assert "search_call" in kinds and "stage" in kinds

    # the browser can export what it holds, with no run on the server
    fresh = TestClient(main.app)
    main.set_store(type(store)(store.path.parent / "other.json"))
    md = fresh.post("/api/export", json=final)
    assert md.status_code == 200 and "## Opportunities (ranked)" in md.text
    assert fresh.post("/api/export", json={"nope": 1}).status_code == 400


def test_single_request_run_refuses_before_streaming(store, monkeypatch):
    monkeypatch.setenv("LAUNCHRADAR_INLINE", "1")
    main.set_store(store)
    client = TestClient(main.app)
    res = client.post("/api/runs/live", json={"question": "meal kits"})  # no LLM configured
    assert res.status_code == 400 and "LLM_PROVIDER" in res.json()["error"] and "Vercel" in res.json()["error"]
    assert client.post("/api/runs/live", json={}).status_code == 400
    assert client.post("/api/runs/live", json={"demo": "../x"}).status_code == 404
    assert store.list_runs() == []


def test_silent_stream_sends_heartbeats_and_api_is_never_cached(store, monkeypatch):
    # a live run that goes quiet (e.g. an LLM rate-limit wait) must still send bytes to the proxy
    store.create_run(make_run(id="quiet"))
    store.append_events("quiet", [{"type": "stage", "stage": "planner", "message": "m", "level": "info"}])

    async def go():
        seen = []
        async def cancelled():
            return len(seen) >= 3
        async for index, event in follow_run_events(store, "quiet", 0, cancelled, heartbeat_s=0.05):
            seen.append(encode_event(index, event))
        return seen
    seen = asyncio.run(go())
    assert seen[0].startswith("id: 0\n") and seen[1:] == [": ping\n\n", ": ping\n\n"]
    assert _collect(store, "quiet", stop_after=1) == [(0, "stage")]  # no pings unless asked for

    main.set_store(store)
    client = TestClient(main.app)
    assert client.get("/api/runs").headers["cache-control"] == "no-store"
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    demo = client.post("/api/runs", json={"demo": "ai-tools-college-india"}).json()
    with client.stream("GET", "/api/runs/%s/stream" % demo["id"]) as res:
        assert res.headers["cache-control"] == "no-cache, no-transform"  # the stream keeps its own
