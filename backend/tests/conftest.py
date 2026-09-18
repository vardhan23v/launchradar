import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.store import Store  # noqa: E402

_KEYS = ["SERPAPI_MODE", "SERPAPI_API_KEY", "LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY",
         "LLM_BASE_URL", "LLM_JSON_MODE", "LLM_REASONING_EFFORT", "MONTHLY_SEARCH_BUDGET", "HOURLY_SEARCH_GUARD", "RUN_SEARCH_BUDGET", "STORE_PATH"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Tests never see the developer's .env or spend quota."""
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DEMO_DELAY_MS", "1")
    monkeypatch.setenv("DEMO_DELAY_BASE_MS", "1")


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "store.json")


def make_run(**over):
    run = {"id": "run_%d" % (len(over) + id(over) % 100000), "question": "test", "region": "in", "questionType": None,
           "status": "running", "budget": 25, "searchesUsed": 0, "createdAt": 1, "finishedAt": None, "demo": False,
           "demoLabel": None, "rejectedSignals": 0, "error": None}
    run.update(over)
    return run
