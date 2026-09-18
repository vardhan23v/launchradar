"""Runtime configuration. Everything is read at call time so tests and .env edits are honoured."""
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# launchradar/ — fixtures and data live beside the frontend, as before
ROOT = Path(__file__).resolve().parents[2]

ALL_ENGINES = [
    "google", "google_news", "google_autocomplete", "google_trends", "google_maps",
    "google_maps_reviews", "google_play_product", "apple_reviews", "google_shopping",
    "google_jobs", "youtube",
]

REGIONS: Dict[str, Dict[str, str]] = {
    "in": {"gl": "in", "hl": "en", "google_domain": "google.co.in", "location": "India", "geo": "IN"},
    "us": {"gl": "us", "hl": "en", "google_domain": "google.com", "location": "United States", "geo": "US"},
    # Google Trends uses ISO 3166 (GB), unlike gl=uk
    "uk": {"gl": "uk", "hl": "en", "google_domain": "google.co.uk", "location": "United Kingdom", "geo": "GB"},
}
REGION_NAMES = {"in": "India", "us": "United States", "uk": "United Kingdom"}

# Question-type routing is code, not an LLM choice (ARCH §3)
ROUTING: Dict[str, List[str]] = {
    "consumer_app": ["google", "google_autocomplete", "google_news", "google_trends", "google_play_product", "apple_reviews"],
    "physical_product": ["google", "google_shopping", "google_trends", "google_news"],
    "local_service": ["google", "google_maps", "google_maps_reviews", "google_trends"],
    "b2b": ["google", "google_news", "google_jobs", "google_trends"],
}

# Per-run budget split (ARCH §4 / IMPL B2-B4). Autocomplete seeds come out of discovery.
DISCOVERY_SHARE = 12
AUTOCOMPLETE_SEEDS = 2
COMPETITORS_SHARE = 6
GAP_VERIFY_SHARE = 5
TRENDS_SHARE = 2
MIN_DISCOVERY_EVIDENCE = 15

SEARCH_TIMEOUT_S = 20.0
RETRIES_ON_5XX = 1
LLM_TIMEOUT_S = 90.0

# Opportunity score weights (ARCH §5) — the single place they live
SCORE_WEIGHTS = {"pain": 30, "momentum": 20, "commercial": 20, "whitespace": 20, "weakRivals": 10}


def load_dotenv() -> None:
    """Minimal .env loader (launchradar/.env); real environment variables win."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def region_params(region: str) -> Dict[str, str]:
    return REGIONS.get(region.lower(), REGIONS["in"])


def region_name(region: str) -> str:
    return REGION_NAMES.get(region.lower(), region.upper())


def _int(name: str, fallback: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else fallback
    except ValueError:
        return fallback


def run_search_budget() -> int:
    return _int("RUN_SEARCH_BUDGET", 25)


def monthly_search_budget() -> int:
    return _int("MONTHLY_SEARCH_BUDGET", 250)


def hourly_rate_guard() -> int:
    return _int("HOURLY_SEARCH_GUARD", 40)


def cache_ttl_hours() -> int:
    return _int("CACHE_TTL_HOURS", 24)


def demo_delay_ms() -> int:
    return _int("DEMO_DELAY_MS", 320)


def demo_delay_base_ms() -> int:
    return _int("DEMO_DELAY_BASE_MS", 120)


def serpapi_mode() -> str:
    value = os.environ.get("SERPAPI_MODE", "replay").lower()
    return value if value in ("live", "record") else "replay"


def serpapi_key() -> str:
    return os.environ.get("SERPAPI_API_KEY", "")


def llm_provider() -> str:
    return os.environ.get("LLM_PROVIDER", "demo").lower()


def llm_api_key() -> str:
    """LLM_API_KEY wins; provider-specific names are accepted as fallbacks."""
    if os.environ.get("LLM_API_KEY"):
        return os.environ["LLM_API_KEY"]
    if llm_provider() == "gemini":
        return os.environ.get("GEMINI_API_KEY", "")
    if llm_provider() == "openai":
        return os.environ.get("OPENAI_API_KEY", "")
    return ""


def llm_model() -> str:
    if os.environ.get("LLM_MODEL"):
        return os.environ["LLM_MODEL"]
    return "gpt-4o-mini" if llm_provider() == "openai" else "gemini-2.0-flash"


def llm_reasoning_effort() -> str:
    """Reasoning models (gpt-oss…) spend hidden tokens thinking; 'low' keeps free-tier token budgets usable."""
    value = os.environ.get("LLM_REASONING_EFFORT", "").lower()
    return value if value in ("low", "medium", "high") else ""


def llm_json_mode() -> bool:
    """Some compatible gateways reject response_format; LLM_JSON_MODE=off drops it (output is still validated)."""
    return os.environ.get("LLM_JSON_MODE", "on").lower() not in ("off", "0", "false", "no")


def llm_base_url() -> str:
    """OpenAI-compatible gateways (OxAlpha, OpenRouter, a local server…) set LLM_BASE_URL, e.g. https://host/v1."""
    return (os.environ.get("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")


def store_path() -> Path:
    return Path(os.environ.get("STORE_PATH") or ROOT / "data" / "store.json")


def pipeline_readiness() -> Tuple[bool, Optional[str]]:
    """Can a fresh (non-demo) question be researched with the current env?"""
    mode = serpapi_mode()
    if mode != "replay" and not serpapi_key():
        return False, "SERPAPI_MODE=%s needs SERPAPI_API_KEY in .env." % mode
    provider = llm_provider()
    if provider == "demo":
        return False, (
            "LLM_PROVIDER=demo can only replay recorded demo runs. Set LLM_PROVIDER "
            "(gemini or openai) and LLM_API_KEY in .env to research a new question."
        )
    if provider not in ("gemini", "openai"):
        return False, 'Unsupported LLM_PROVIDER "%s". Use gemini or openai.' % provider
    if not llm_api_key():
        return False, "LLM_API_KEY is missing in .env."
    if provider == "openai" and os.environ.get("LLM_BASE_URL") and not os.environ.get("LLM_MODEL"):
        return False, "LLM_BASE_URL is set, so LLM_MODEL must name a model that gateway serves."
    return True, None
