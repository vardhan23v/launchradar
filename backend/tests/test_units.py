import json
from datetime import datetime, timezone

from app import config
from app.citations import validate_signals, verify_quote
from app.engines import hash_params, to_raw_params
from app.llm import parse_json
from app.normalise import normalise
from app.pipeline import trend_slope
from app.score import compute_score
from app.utils import cite_groups, keep_known_citations, parse_serp_date

EV = [{"id": "E1", "title": "Thread", "snippet": "The app   glitches on Indian school content", "text": None}]


def test_citations_reject_unknown_id_and_paraphrase():
    assert verify_quote(["E1"], "glitches on indian SCHOOL content", EV)[0]  # case/whitespace normalised
    assert not verify_quote(["E404"], "glitches", EV)[0]
    assert not verify_quote(["E1"], "crashes on school content", EV)[0]
    assert not verify_quote(["E1"], "  ", EV)[0]
    valid, rejected = validate_signals([{"evidenceIds": ["E1"], "quote": "glitches"}, {"evidenceIds": ["E9"], "quote": "x"}], EV)
    assert len(valid) == 1 and rejected == 1


def _score(**over):
    base = dict(signals=[{"intensity": 4, "domains": ["reddit.com", "play.google.com"]}], trend_slope=None, recent_news_count=0,
                ads_count=0, has_priced_competitors=False, jobs_count=0, gap_status="open", direct_competitors=0,
                weak_competitor_share=0, evidence_count=10, distinct_domains=2, block_type_count=2)
    base.update(over)
    return compute_score(**base)


def test_score_table():
    strong = _score(signals=[{"intensity": 5, "domains": ["a.com", "b.com", "c.com", "d.com"]}, {"intensity": 4, "domains": ["a.com"]}],
                    trend_slope=0.8, recent_news_count=2, ads_count=4, has_priced_competitors=True,
                    evidence_count=30, distinct_domains=4, block_type_count=3)
    assert strong["total"] > 60 and strong["confidence"] == "High"
    # missing inputs score 0 for that term — never imputed
    assert _score()["subScores"]["momentum"] == 0
    assert _score()["subScores"]["commercial"] == 0
    assert _score(signals=[])["subScores"]["pain"] == 0
    # whitespace: open > partially-served > served, and crowding shrinks it
    ws = [_score(gap_status=s)["subScores"]["whitespace"] for s in ("open", "partially-served", "served")]
    assert ws == [20, 10, 2]
    assert _score(direct_competitors=8)["subScores"]["whitespace"] == 0
    assert _score(trend_slope=5)["subScores"]["momentum"] == 20  # clamped
    assert _score()["confidence"] == "Low"
    assert sum(config.SCORE_WEIGHTS.values()) == 100


def test_normalise_every_block_optional():
    assert normalise("google", {}) == []
    assert normalise("google", {"organic_results": "nonsense", "related_questions": None}) == []
    assert normalise("google_trends", {"interest_over_time": []}) == []
    rows = normalise("google", {
        "organic_results": [{"position": 1, "title": "T", "link": "https://www.a.com/x", "snippet": "S"}],
        "related_questions": [{"question": "Why?", "snippet": "Because", "link": "https://b.com"}],
        "discussions_and_forums": [{"title": "Thread", "link": "https://reddit.com/r/x", "answers": [{"snippet": "It broke for me"}]}],
        "ads": [{"title": "Ad", "link": "https://ad.com", "snippet": "Buy"}],
    })
    assert [r["blockType"] for r in rows] == ["organic", "related_question", "forum", "ad"]
    assert rows[0]["domain"] == "a.com" and rows[2]["snippet"] == "It broke for me"


def test_normalise_trends_and_news_in_documented_shape():
    rows = normalise("google_trends", {
        "interest_over_time": {"timeline_data": [
            {"date": "Sep 1 – 7, 2025", "timestamp": "1756684800", "values": [{"query": "AI Tutor", "value": "38", "extracted_value": 38}]}]},
        "related_queries": {"rising": [{"query": "ai tutor for board exams", "value": "+250%", "extracted_value": 250}]},
    })
    assert rows[0]["meta"]["values"] == {"ai tutor": 38}
    assert parse_serp_date(rows[0]["date"]) == 1756684800000
    assert rows[1]["blockType"] == "rising_query"
    news = normalise("google_news", {"news_results": [{"title": "Cluster", "stories": [
        {"title": "A", "link": "https://x.com/a", "iso_date": "2026-01-02T15:30:13Z"}]}]})
    assert news[0]["title"] == "A" and news[0]["date"] == "2026-01-02T15:30:13Z"


def test_hash_and_region_params():
    a = hash_params("google", {"q": "x", "gl": "in", "api_key": "k1"})
    assert a == hash_params("google", {"gl": "in", "q": "x", "api_key": "k2", "__rows": [1]})
    assert len(a) == 16
    assert to_raw_params("google_trends", {"q": "x"}, "uk")["geo"] == "GB"
    assert to_raw_params("google", {"q": "x", "gl": "de"}, "us")["gl"] == "de"  # explicit params win
    assert "google_domain" not in to_raw_params("youtube", {"search_query": "x"}, "us")


def test_dates_slope_json_and_citation_helpers():
    now = int(datetime(2026, 9, 18, tzinfo=timezone.utc).timestamp() * 1000)
    assert parse_serp_date("01/02/2026, 10:30 PM, +0700 +07") == int(datetime(2026, 1, 2, 22, 30, tzinfo=timezone.utc).timestamp() * 1000)
    assert parse_serp_date("3 days ago", now) == now - 3 * 86_400_000
    assert parse_serp_date("Mar 5, 2026") is not None
    assert parse_serp_date("not a date") is None

    rows = [{"blockType": "trend_point", "date": datetime(2025, i + 1, 1, tzinfo=timezone.utc).isoformat(),
             "meta": {"values": {"ai tutor": 20 if i < 3 else 40 if i > 8 else 30}}} for i in range(12)]
    assert abs(trend_slope(rows, "AI Tutor") - 1.0) < 1e-9
    assert trend_slope(rows, "unknown") is None

    assert parse_json('```json\n{"a":1}\n```') == {"a": 1}
    assert parse_json('Here: {"a":2} thanks') == {"a": 2}
    assert parse_json("nonsense") is None

    assert cite_groups("x [E1,E22] y")[0]["ids"] == ["E1", "E22"]
    assert keep_known_citations("Fact [E1,E99]. Other [E98].", {"E1"}) == "Fact [E1]. Other."


def test_demo_fixture_integrity():
    f = json.loads((config.FIXTURES / "demo" / "ai-tools-college-india.json").read_text())
    ev = f["evidence"]
    assert validate_signals(f["signals"], ev)[1] == 0
    for c in f["competitors"]:
        for x in c["complaints"]:
            assert verify_quote([x["evidenceId"]], x["quote"], ev)[0]
    assert len({e["id"] for e in ev}) == len(ev)
    signal_ids = {s["id"] for s in f["signals"]}
    assert all(i in signal_ids for c in f["clusters"] for i in c["signalIds"])
    assert all(g["clusterId"] in {c["id"] for c in f["clusters"]} for g in f["gaps"])


def test_openai_compatible_gateway(monkeypatch):
    import httpx
    from app.llm import LlmClient

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_BASE_URL", "https://gateway.example/v1/")
    assert config.pipeline_readiness() == (False, "LLM_BASE_URL is set, so LLM_MODEL must name a model that gateway serves.")
    monkeypatch.setenv("LLM_MODEL", "some-model")
    assert config.pipeline_readiness() == (True, None)  # replay mode needs no SerpApi key

    seen = {}

    def handler(request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"type": "b2b"}'}}]})

    llm = LlmClient(transport=httpx.MockTransport(handler))
    assert llm.complete("planner", "d", "p", lambda v: v["type"]) == "b2b"
    assert seen["url"] == "https://gateway.example/v1/chat/completions" and seen["auth"] == "Bearer sk-test"
    assert seen["body"]["model"] == "some-model" and "response_format" in seen["body"]
    monkeypatch.setenv("LLM_JSON_MODE", "off")
    llm.complete("planner", "d", "p", lambda v: v["type"])
    assert "response_format" not in seen["body"]


def test_llm_waits_and_retries_on_rate_limit(monkeypatch):
    import httpx
    from app.llm import LlmClient, LlmError

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_API_KEY", "gsk_test")
    ok = httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}]})
    answers = iter([httpx.Response(429, headers={"retry-after": "2"}, text="slow down"), httpx.Response(429, text="slow down"), ok])
    waits, events = [], []
    llm = LlmClient(on_event=events.append, transport=httpx.MockTransport(lambda r: next(answers)))
    llm._sleep = waits.append
    assert llm.complete("selftest", "d", "p", lambda v: v["ok"]) is True
    assert waits == [2.0, 10.0]  # honours retry-after, otherwise backs off
    assert sum(1 for e in events if e["type"] == "stage" and e["level"] == "warn") == 2

    # a provider that never recovers fails loudly instead of hanging the run
    llm = LlmClient(transport=httpx.MockTransport(lambda r: httpx.Response(429, text="slow down")))
    llm._sleep = waits.append
    try:
        llm.complete("selftest", "d", "p", lambda v: v)
        assert False, "expected LlmError"
    except LlmError as err:
        assert "429" in str(err)


def test_planner_queries_are_cleaned_and_extraction_favours_user_voice():
    from app.pipeline import MAX_EXTRACT_ROWS, clean_query, select_for_extraction

    assert clean_query("Quora question: best AI note\u2011taking app for engineering students") == "best AI note-taking app for engineering students quora"
    assert clean_query("Reddit discussion on AI plagiarism detection tools") == "AI plagiarism detection tools reddit"
    assert clean_query("Google News: recent regulation on AI in higher education") == "recent regulation on AI in higher education"
    assert clean_query("ai tools for students reddit") == "ai tools for students reddit"  # already a real query

    news = normalise("google_news", {"news_results": [{"title": "N%d" % i, "link": "https://n.com/%d" % i} for i in range(80)]})
    assert len(news) == 15

    rows = [{"id": "E%d" % i, "blockType": "news", "position": i} for i in range(200)]
    rows += [{"id": "F1", "blockType": "forum", "position": 1}, {"id": "Q1", "blockType": "related_question", "position": 1}]
    picked = select_for_extraction(rows)
    assert len(picked) == MAX_EXTRACT_ROWS and [r["id"] for r in picked[:2]] == ["F1", "Q1"]


def test_interrupted_live_runs_are_closed_on_startup(store):
    from conftest import make_run
    store.create_run(make_run(id="live1"))
    store.create_run(make_run(id="demo1", demo=True))
    store.create_run(make_run(id="old", status="complete"))
    assert store.fail_interrupted_runs() == 1
    assert store.get_run("live1")["status"] == "failed" and "Interrupted" in store.get_run("live1")["error"]
    assert store.events_for("live1")[-1]["type"] == "done"
    assert store.get_run("demo1")["status"] == "running" and store.get_run("old")["status"] == "complete"
