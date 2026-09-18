# LaunchRadar: one container, two processes.
#   - Next.js frontend on $PORT (public)
#   - Python API (FastAPI) on 127.0.0.1:8000 (private; the frontend proxies /api/* to it)
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Python dependencies first: they change least, so this layer caches best
COPY backend/requirements.txt backend/requirements.txt
RUN python3 -m venv backend/.venv \
 && backend/.venv/bin/pip install --no-cache-dir -r backend/requirements.txt

# Node dependencies (dev deps are needed for the build, pruned afterwards)
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
# rewrites are baked in at build time, so the API address is fixed here
RUN API_URL=http://127.0.0.1:8000 npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# the platform replaces the container's disk on every deploy; /tmp makes that explicit
ENV STORE_PATH=/tmp/launchradar/store.json
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
