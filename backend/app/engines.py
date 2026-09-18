import hashlib
from typing import Any, Dict

from .config import region_params

_FULL_REGION = {"google", "google_news", "google_shopping", "google_jobs"}
_GL_HL = {"google_autocomplete", "google_maps", "google_play_product", "apple_reviews", "youtube"}


def to_raw_params(engine: str, params: Dict[str, Any], region: str) -> Dict[str, Any]:
    """Flat query params seeded with region defaults; explicit params always win."""
    r = region_params(region)
    p = dict(params)
    if engine == "google_trends":
        defaults = {"geo": r["geo"], "hl": r["hl"], "date": "today 12-m"}
    elif engine in _FULL_REGION:
        defaults = {k: r[k] for k in ("gl", "hl", "google_domain", "location")}
    elif engine in _GL_HL:
        defaults = {"gl": r["gl"], "hl": r["hl"]}
    else:
        defaults = {}
    for k, v in defaults.items():
        if p.get(k) is None:
            p[k] = v
    return p


def _fmt(v: Any) -> str:
    return str(v).lower() if isinstance(v, bool) else str(v)


def hash_params(engine: str, params: Dict[str, Any]) -> str:
    """sha256(engine + sorted params) per ARCH §3. The api key and internal keys never influence it."""
    keys = sorted(k for k, v in params.items() if k != "api_key" and not k.startswith("__") and v is not None and _fmt(v) != "")
    joined = "&".join("%s=%s" % (k, _fmt(params[k])) for k in keys)
    return hashlib.sha256(("%s?%s" % (engine, joined)).encode("utf-8")).hexdigest()[:16]


def redact(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in params.items() if k != "api_key"}
