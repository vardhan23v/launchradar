/**
 * The shortlist kept in this browser, one list of opportunity ids per run. The key is the one the
 * old triage board used, so stars made there still show here.
 */

const idKey = (runId: string, kind: "shortlist" | "dismissed") => `lr:v2:${kind}:${runId}`;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode or blocked storage
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or blocked: the page still works, the choice just will not survive a reload */
  }
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function loadIds(runId: string, kind: "shortlist" | "dismissed"): string[] {
  return parseIds(readRaw(idKey(runId, kind)));
}

export function saveIds(runId: string, kind: "shortlist" | "dismissed", ids: string[]): void {
  writeRaw(idKey(runId, kind), JSON.stringify(ids));
}
