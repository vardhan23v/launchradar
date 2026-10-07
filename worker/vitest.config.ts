import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // tests never see the developer's keys or spend quota: every outbound call is answered by test/fakes.ts
        bindings: {
          SERPAPI_MODE: "live",
          SERPAPI_API_KEY: "serp-secret",
          LLM_PROVIDER: "openai",
          LLM_API_KEY: "llm-secret",
          LLM_BASE_URL: "https://llm.test/v1",
          LLM_MODEL: "stub-model",
          DEMO_DELAY_MS: "1",
          DEMO_DELAY_BASE_MS: "1",
        },
      },
    }),
  ],
});
