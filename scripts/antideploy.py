#!/usr/bin/env python3
"""
Antideploy helper for LaunchRadar (Python standard library only).

    python3 scripts/antideploy.py check      what would be uploaded, and is everything ready?
    python3 scripts/antideploy.py secrets    send the keys from .env to the platform (write-only there)
    python3 scripts/antideploy.py deploy     upload the project and follow the build
    python3 scripts/antideploy.py status     latest deployments
    python3 scripts/antideploy.py logs       running container output

The account token is read from ~/.antideploy/config.json and is never printed.
Secret values are read from .env and are never printed.
"""
import io
import json
import os
import sys
import tarfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://antideploy.com/api/v1"
MAX_BYTES = 29_360_128
MAX_FILES = 4000

# never uploaded: secrets, local state, dependencies, build output, other tooling
EXCLUDE_DIRS = {".git", "node_modules", ".next", ".venv", "__pycache__", ".pytest_cache", ".deps", "data", ".oxcode", ".oxcode-memory", ".claude"}
EXCLUDE_FILES = {".env", ".DS_Store", "oxcode.hooks.json", "tsconfig.tsbuildinfo"}
EXCLUDE_PATHS = {"fixtures/serpapi", "backend/tests"}

# settings the deployed app needs; only these leave the machine
SECRET_KEYS = ["SERPAPI_API_KEY", "LLM_API_KEY"]
PLAIN_KEYS = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_REASONING_EFFORT", "LLM_JSON_MODE",
              "RUN_SEARCH_BUDGET", "MONTHLY_SEARCH_BUDGET", "HOURLY_SEARCH_GUARD"]


def fail(msg):
    print("error:", msg)
    sys.exit(1)


def token():
    path = Path.home() / ".antideploy" / "config.json"
    if not path.exists():
        fail("not logged in to Antideploy (no %s)" % path)
    return json.loads(path.read_text())["token"]


def app_id():
    return json.loads((ROOT / ".antideploy.json").read_text())["applicationId"]


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=body, method=method,
                                 headers=dict({"Authorization": "Bearer " + token()}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode() or "{}")
        except ValueError:
            return err.code, {}


def project_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = Path(dirpath).relative_to(ROOT)
        dirnames[:] = [d for d in dirnames
                       if d not in EXCLUDE_DIRS and (rel_dir / d).as_posix() not in EXCLUDE_PATHS]
        for name in filenames:
            rel = (rel_dir / name).as_posix()
            if name in EXCLUDE_FILES or name.endswith(".pyc") or (name.startswith(".env") and name != ".env.example"):
                continue
            out.append(rel)
    return sorted(out)


def read_env():
    path = ROOT / ".env"
    if not path.exists():
        fail("no .env file in %s" % ROOT)
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def cmd_check():
    files = project_files()
    total = sum((ROOT / f).stat().st_size for f in files)
    print("application :", app_id())
    print("upload      : %d files, %.1f MB (limits: %d files, %.0f MB)" % (len(files), total / 1e6, MAX_FILES, MAX_BYTES / 1e6))
    leaked = [f for f in files if Path(f).name.startswith(".env") and f != ".env.example"]
    print("secrets in upload:", leaked or "none")
    st, body = call("GET", "/secrets?applicationId=" + app_id())
    have = set(body.get("keys") or [])
    need = SECRET_KEYS + ["LLM_PROVIDER"]
    print("platform secrets set:", sorted(have) or "none", "| still needed:", [k for k in need if k not in have] or "none")
    if len(files) > MAX_FILES or total > MAX_BYTES or leaked:
        fail("upload would be rejected")


def cmd_secrets():
    env = read_env()
    missing = [k for k in SECRET_KEYS if not env.get(k) or "PASTE_" in env[k]]
    if missing:
        fail("these are empty in .env: %s" % ", ".join(missing))
    payload = {k: env[k] for k in SECRET_KEYS + PLAIN_KEYS if env.get(k)}
    payload["SERPAPI_MODE"] = "live"  # a server must not write fixtures
    st, body = call("PUT", "/secrets?applicationId=" + app_id(), json.dumps({"env": payload}).encode(),
                    {"content-type": "application/json"})
    if st >= 300:
        fail("platform answered %d: %s" % (st, body.get("error") or body))
    print("sent %d settings (values not shown): %s" % (len(payload), ", ".join(sorted(payload))))
    print("they take effect on the next deploy")


def cmd_deploy():
    cmd_check()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in project_files():
            tar.add(ROOT / f, arcname=f)
    boundary = uuid.uuid4().hex
    body = (("--%s\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"project.tar.gz\"\r\n"
             "Content-Type: application/gzip\r\n\r\n" % boundary).encode() + buf.getvalue()
            + ("\r\n--%s--\r\n" % boundary).encode())
    print("uploading %.1f MB ..." % (len(body) / 1e6))
    st, res = call("POST", "/deploy?applicationId=" + app_id(), body,
                   {"content-type": "multipart/form-data; boundary=" + boundary})
    if st == 200:
        print("unchanged: this exact content is already deployed")
        return
    if st != 202:
        fail("platform answered %d: %s" % (st, res.get("error") or res))
    task = res["taskId"]
    print("queued: %d files | watch: %s" % (res.get("fileCount", 0), res.get("watch")))
    last = None
    while True:
        time.sleep(10)
        st, d = call("GET", "/deployments/%s?applicationId=%s" % (task, app_id()))
        state = d.get("status")
        step = next((s.get("name") for s in d.get("steps", []) if s.get("status") == "running"), "")
        if (state, step) != last:
            print("  %s %s" % (state, step))
            last = (state, step)
        if state in ("succeeded", "live"):
            print("live at:", d.get("url") or (d.get("deployment") or {}).get("url"))
            return
        if state == "failed":
            dep = d.get("deployment") or {}
            print("FAILED at step %s: %s" % (d.get("failedStep"), d.get("error")))
            for name in ("buildLog", "runtimeLog"):
                if dep.get(name):
                    print("--- %s (tail) ---\n%s" % (name, str(dep[name])[-1500:]))
            sys.exit(1)


def cmd_status():
    st, d = call("GET", "/deployments?applicationId=%s&limit=5" % app_id())
    for x in d.get("deployments", []):
        print("%-10s %s %s" % (x.get("status"), x.get("url") or "", (x.get("error") or "")[:120]))
    st, h = call("GET", "/health?applicationId=" + app_id())
    print("health:", h.get("status") or h)


def cmd_logs():
    st, d = call("GET", "/logs?applicationId=%s&limit=200" % app_id())
    if d.get("setupNeeded"):
        print("(platform log access is not configured; this is not an app failure)")
    for line in d.get("lines", []):
        print(line if isinstance(line, str) else line.get("message", line))


if __name__ == "__main__":
    commands = {"check": cmd_check, "secrets": cmd_secrets, "deploy": cmd_deploy, "status": cmd_status, "logs": cmd_logs}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(__doc__)
        sys.exit(2)
    commands[sys.argv[1]]()
