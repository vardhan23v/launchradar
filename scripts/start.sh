#!/bin/sh
# Production entry point: runs the Python API and the Next.js frontend together.
# If either one stops, the container stops, so the platform restarts it cleanly.
set -eu

PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8000}"
cd "$(dirname "$0")/.."

# Without a Dockerfile (platform build detection), the Python side may not be installed yet.
if [ ! -x backend/.venv/bin/python ]; then
  echo "[start] creating the Python environment (first boot only)"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --no-cache-dir -q -r backend/requirements.txt
fi

echo "[start] API on 127.0.0.1:${API_PORT}, frontend on 0.0.0.0:${PORT}"
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "$API_PORT" &
API_PID=$!

node_modules/.bin/next start -H 0.0.0.0 -p "$PORT" &
WEB_PID=$!

trap 'kill "$API_PID" "$WEB_PID" 2>/dev/null || true' INT TERM

# wait for whichever exits first, then take the other down with it
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 2
done
echo "[start] a process exited; shutting down"
kill "$API_PID" "$WEB_PID" 2>/dev/null || true
exit 1
