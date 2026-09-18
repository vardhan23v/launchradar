"""
Vercel entry point. The Python runtime serves the ASGI object named `app` from this file, and
next.config.mjs rewrites every /api/* request here. The application itself lives in backend/app.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401
