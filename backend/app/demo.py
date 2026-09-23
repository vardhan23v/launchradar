"""Recorded demo runs: materialised into the store instantly; the stream replays their trace."""
import json
import random
import string
from typing import List

from . import config
from .store import Store
from .utils import now_ms

DEMO_SLUGS = ["ai-tools-college-india"]  # allow-list: a slug never becomes an arbitrary path


def make_id(prefix: str) -> str:
    return "%s_%x%s" % (prefix, now_ms(), "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6)))


def load_fixture(slug: str) -> dict:
    if slug not in DEMO_SLUGS:
        raise KeyError("unknown demo run")
    return json.loads((config.FIXTURES / "demo" / ("%s.json" % slug)).read_text(encoding="utf-8"))


def list_demos() -> List[dict]:
    out = []
    for slug in DEMO_SLUGS:
        try:
            f = load_fixture(slug)
            out.append({"slug": slug, "label": f["label"], "question": f["question"], "region": f["region"], "searches": len(f["searchCalls"])})
        except (OSError, ValueError, KeyError):
            continue
    return out


def start_demo_run(store: Store, slug: str) -> str:
    f = load_fixture(slug)
    run_id = make_id("run")
    defaults = {"questionType": None, "demo": True, "demoLabel": None, "rejectedSignals": 0, "error": None, "searchesUsed": 0}
    run = dict(defaults)
    run.update(f["run"])
    run.update({"id": run_id, "createdAt": now_ms(), "finishedAt": None, "status": "running"})
    store.create_run(run)
    tag = lambda rows: [dict(r, runId=run_id) for r in rows]  # noqa: E731
    store.add_search_calls(tag(f["searchCalls"]))
    store.add_evidence(tag(f["evidence"]))
    store.add_signals(tag(f["signals"]))
    store.set_clusters(run_id, tag(f["clusters"]))
    store.add_competitors([dict(c, clusterIds=c.get("clusterIds", [])) for c in tag(f["competitors"])])
    store.set_gaps(run_id, tag(f["gaps"]))
    store.set_opportunities(run_id, tag(f["opportunities"]))
    store.set_events(run_id, f["events"])
    return run_id
