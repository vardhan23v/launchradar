import type { z, ZodType } from "zod";
import { CONFIG } from "../config";

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export interface CompleteOptions<T> {
  stage: string;
  description: string;
  schema: ZodType<T>;
  prompt: string;
  /** Replay answer used when LLM_PROVIDER=demo (recorded runs). */
  demoAnswer?: unknown;
  temperature?: number;
}

/**
 * Provider-agnostic JSON-mode client with a single repair retry.
 * LLM_PROVIDER=demo replays recorded answers; otherwise calls the configured provider.
 */
export class LlmClient {
  constructor(private modelOverride?: string) {}

  private model(): string {
    return this.modelOverride ?? CONFIG.llmModel;
  }

  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    if (CONFIG.llmProvider === "demo") {
      if (opts.demoAnswer === undefined) {
        throw new LlmError(
          `demo provider has no recorded answer for stage "${opts.stage}". Set LLM_PROVIDER to a live provider or record this stage.`,
        );
      }
      return this.validate(opts, opts.demoAnswer);
    }

    const raw = await this.callProvider(opts);
    try {
      return this.validate(opts, raw);
    } catch (first) {
      // exactly one repair retry, then fail loudly (per B0 rule 7)
      const issues = first instanceof Error ? first.message : String(first);
      const repairPrompt = `${opts.prompt}\n\nYour previous output failed validation.\nErrors: ${issues}\nPrevious output: ${JSON.stringify(raw)}\nReturn the corrected JSON object only.`;
      const second = await this.callProvider({ ...opts, prompt: repairPrompt });
      return this.validate(opts, second);
    }
  }

  private validate<T>(opts: CompleteOptions<T>, value: unknown): T {
    const parsed = opts.schema.safeParse(value);
    if (!parsed.success) {
      throw new LlmError(
        `LLM output failed zod validation (stage ${opts.stage}): ${parsed.error.issues
          .slice(0, 4)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  }

  private async callProvider<T>(opts: CompleteOptions<T>): Promise<unknown> {
    if (!CONFIG.llmApiKey) {
      throw new LlmError("LLM_API_KEY is required for a live provider.");
    }
    const provider = CONFIG.llmProvider;
    const model = this.model();
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${CONFIG.llmApiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: opts.prompt }],
        }),
      });
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    }
    if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.llmApiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generationConfig: { temperature: opts.temperature ?? 0 },
            contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          }),
        },
      );
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return JSON.parse(
        json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}",
      );
    }
    throw new LlmError(`Unsupported LLM_PROVIDER: ${provider}`);
  }
}

/** zod v4 helper types — keep zod import explicit to avoid tree-shake surprises. */
export type { ZodType };
export { z };