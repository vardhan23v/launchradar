#!/bin/sh
# Production entry point: runs the Python API and the Next.js frontend together.
#
# Two ways to get here:
#   1. Container image (deploy/container-image.txt): Python is already installed in backend/.venv.
#   2. Platform-detected Node build: only the Node side was built, so the Python side is
#      installed here on first boot. If that is impossible, the frontend still starts and the
#      log says why, which beats a crash loop nobody can read.
set -u

PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8000}"
cd "$(dirname "$0")/.."
VENV="${BACKEND_VENV:-backend/.venv}"
DEPS="${BACKEND_DEPS:-backend/.deps}"
PY=""

if [ -x "$VENV/bin/python" ]; then
  PY="$VENV/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  echo "[start] python3 found: $(python3 --version 2>&1). Installing the API's dependencies (first boot only)."
  if python3 -m venv "$VENV" >/dev/null 2>&1 && "$VENV/bin/pip" install --no-cache-dir -q -r backend/requirements.txt; then
    PY="$VENV/bin/python"
  elif python3 -m pip install --no-cache-dir -q --target "$DEPS" -r backend/requirements.txt; then
    # no venv module on this image; a plain target folder on PYTHONPATH works just as well
    PY="python3"
    export PYTHONPATH="$DEPS${PYTHONPATH:+:$PYTHONPATH}"
  else
    echo "[start] ERROR: could not install Python packages (no venv and no pip on this image)."
  fi
else
  echo "[start] ERROR: python3 is not installed on this image, so the research API cannot run."
fi

API_PID=""
if [ -n "$PY" ]; then
  echo "[start] API on 127.0.0.1:${API_PORT}"
  "$PY" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "$API_PORT" &
  API_PID=$!
else
  echo "[start] Starting the frontend only. Pages load, but every /api request will fail until this image has Python."
fi

echo "[start] frontend on 0.0.0.0:${PORT}"
node_modules/.bin/next start -H 0.0.0.0 -p "$PORT" &
WEB_PID=$!

trap 'kill $API_PID "$WEB_PID" 2>/dev/null' INT TERM

# if either process exits, stop the other so the platform restarts the container cleanly
while kill -0 "$WEB_PID" 2>/dev/null && { [ -z "$API_PID" ] || kill -0 "$API_PID" 2>/dev/null; }; do
  sleep 2
done
echo "[start] a process exited; shutting down"
kill $API_PID "$WEB_PID" 2>/dev/null
exit 1
