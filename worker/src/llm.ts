/** Provider-agnostic JSON-mode LLM client: validated output, exactly one repair retry, then fail loudly. */
import { LLM_TIMEOUT_MS, llmApiKey, llmBaseUrl, llmJsonMode, llmModel, llmProvider, llmReasoningEffort, type Settings } from "./config";
import { repairPrompt } from "./prompts";
import type { StepEvent } from "./types";
import { isRecord, sleep } from "./utils";

export const MAX_RATE_LIMIT_RETRIES = 5;
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;

export class LlmError extends Error {}

export type Validator<T> = (value: unknown) => T; // returns the cleaned value or throws
export type Emitter = (event: StepEvent) => Promise<void> | void;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Models occasionally wrap JSON in fences or prose despite JSON mode. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
    if (start >= 0 && start < end) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class LlmClient {
  constructor(
    private readonly settings: Settings,
    public onEvent: Emitter | null = null,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    public sleepImpl: (ms: number) => Promise<void> = sleep,
  ) {}

  async complete<T>(stage: string, description: string, prompt: string, validate: Validator<T>, temperature = 0): Promise<T> {
    const provider = llmProvider(this.settings);
    // every call is visible in the research trace
    await this.onEvent?.({ type: "llm", stage, model: provider === "demo" ? "demo" : llmModel(this.settings), description });
    if (provider === "demo") {
      throw new LlmError(`demo provider has no recorded answer for stage "${stage}". Set LLM_PROVIDER to gemini or openai.`);
    }
    const raw = await this.call(prompt, temperature);
    try {
      return LlmClient.validate(stage, validate, parseJson(raw));
    } catch (first) {
      if (!(first instanceof LlmError)) throw first;
      const second = await this.call(`${prompt}\n\n---\n${repairPrompt(first.message, raw.slice(0, 6000))}`, 0);
      return LlmClient.validate(stage, validate, parseJson(second));
    }
  }

  private static validate<T>(stage: string, validate: Validator<T>, value: unknown): T {
    try {
      return validate(value);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(`LLM output failed validation (stage ${stage}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Returns the model's raw text. The API key travels in a header, never in a URL. */
  private async call(prompt: string, temperature: number): Promise<string> {
    const key = llmApiKey(this.settings);
    if (!key) throw new LlmError("LLM_API_KEY is required for a live provider.");
    const provider = llmProvider(this.settings), model = llmModel(this.settings);
    if (provider === "openai") {
      // the OpenAI wire format, at api.openai.com or any compatible gateway (LLM_BASE_URL)
      const body: Record<string, unknown> = { model, temperature, messages: [{ role: "user", content: prompt }] };
      if (llmJsonMode(this.settings)) body.response_format = { type: "json_object" };
      if (llmReasoningEffort(this.settings)) body.reasoning_effort = llmReasoningEffort(this.settings);
      const data = await this.post(`${llmBaseUrl(this.settings)}/chat/completions`, { authorization: `Bearer ${key}` }, body);
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
      return typeof message.content === "string" ? message.content : "";
    }
    if (provider === "gemini") {
      const data = await this.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        { generationConfig: { temperature, responseMimeType: "application/json" }, contents: [{ role: "user", parts: [{ text: prompt }] }] },
      );
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const content = isRecord(candidates[0]) && isRecord(candidates[0].content) ? candidates[0].content : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];
      return parts.map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : "")).join("");
    }
    throw new LlmError(`Unsupported LLM_PROVIDER: ${provider}`);
  }

  /** POST with patience for rate limits: free tiers (Groq, Gemini) answer 429 when a run bursts. */
  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        res = await this.fetchImpl(url, {
          method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });
      } catch (err) {
        throw new LlmError(`LLM request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) break;
      const header = Number.parseFloat(res.headers.get("retry-after") ?? "");
      const wait = Number.isFinite(header) ? header * 1000 : 5000 * (attempt + 1);
      const capped = Math.min(Math.max(wait, 1000), MAX_RATE_LIMIT_WAIT_MS);
      await this.onEvent?.({ type: "stage", stage: "llm", level: "warn", message: `Provider rate limit hit; waiting ${Math.round(capped / 1000)}s before retrying` });
      await this.sleepImpl(capped);
    }
    if (!res) throw new LlmError("LLM request failed");
    if (res.status >= 400) throw new LlmError(`LLM provider returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: unknown = await res.json().catch(() => null);
    if (!isRecord(data)) throw new LlmError("LLM provider returned a non-JSON body");
    return data;
  }
}
