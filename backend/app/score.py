"""Deterministic Opportunity Score (ARCH §5). Pure function — no LLM, no I/O."""
from typing import Optional

from .config import SCORE_WEIGHTS as W


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _r(v: float) -> float:
    return round(v * 10) / 10


def compute_score(
    signals: list, trend_slope: Optional[float], recent_news_count: int, ads_count: int,
    has_priced_competitors: bool, jobs_count: int, gap_status: str, direct_competitors: int,
    weak_competitor_share: float, evidence_count: int, distinct_domains: int, block_type_count: int,
) -> dict:
    domains = {d for s in signals for d in s.get("domains", []) if d}
    avg_intensity = sum(s["intensity"] for s in signals) / len(signals) if signals else 0
    pain = min(1, len(domains) / 6) * (avg_intensity / 5) if signals else 0

    # missing inputs score 0 — never imputed
    momentum = 0.0
    if trend_slope is not None:
        momentum = (_clamp(trend_slope, -0.5, 1.0) + 0.5) / 1.5
    if recent_news_count >= 2:
        momentum = min(1, momentum + 0.2)

    commercial = 0.5 * min(1, ads_count / 4) + 0.3 * (1 if has_priced_competitors else 0) + 0.2 * min(1, jobs_count / 10)

    factor = {"open": 1.0, "partially-served": 0.5}.get(gap_status, 0.1)
    whitespace = factor * max(0, 1 - min(1, direct_competitors / 8))

    parts = {"pain": pain, "momentum": momentum, "commercial": commercial, "whitespace": whitespace, "weakRivals": weak_competitor_share}
    total = sum(W[k] * v for k, v in parts.items())

    if evidence_count >= 30 and distinct_domains >= 4 and block_type_count >= 3:
        confidence = "High"
    elif evidence_count >= 12 and distinct_domains >= 2 and block_type_count >= 2:
        confidence = "Med"
    else:
        confidence = "Low"

    # JS Math.round semantics (half up), so scores match the recorded demo run
    return {
        "total": min(100, int(total + 0.5)),
        "subScores": {k: _r(W[k] * v) for k, v in parts.items()},
        "confidence": confidence,
    }
