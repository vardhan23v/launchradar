import type { Settings } from "./config";
import type { ResearchRunner } from "./runner";

/** Bindings declared in wrangler.jsonc, plus the plain-text vars and secrets read by config.ts. */
export interface Env extends Settings {
  DB: D1Database;
  RUNNER: DurableObjectNamespace<ResearchRunner>;
}

type Bindings = Env;

declare global {
  namespace Cloudflare {
    // the test runner's `env` (cloudflare:test) and the runtime share this shape
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends Bindings {}
  }
}
