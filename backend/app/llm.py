"""Provider-agnostic JSON-mode LLM client: validated output, exactly one repair retry, then fail loudly."""
import json
import re
import time
from typing import Any, Callable, Optional

import httpx

from . import config
from .prompts import repair_prompt


MAX_RATE_LIMIT_RETRIES = 5
MAX_RATE_LIMIT_WAIT_S = 60.0


class LlmError(Exception):
    pass


Validator = Callable[[Any], Any]  # returns the cleaned value or raises ValueError


def parse_json(text: str) -> Any:
    """Models occasionally wrap JSON in fences or prose despite JSON mode."""
    trimmed = re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.I))
    try:
        return json.loads(trimmed)
    except ValueError:
        start, end = trimmed.find("{"), trimmed.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(trimmed[start:end + 1])
            except ValueError:
                return None
        return None


class LlmClient:
    def __init__(self, on_event: Optional[Callable[[dict], None]] = None,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        self.on_event = on_event
        self.transport = transport
        self._sleep = time.sleep  # replaced in tests

    def complete(self, stage: str, description: str, prompt: str, validate: Validator, temperature: float = 0) -> Any:
        provider = config.llm_provider()
        if self.on_event:  # every call is visible in the research trace
            self.on_event({"type": "llm", "stage": stage, "model": "demo" if provider == "demo" else config.llm_model(),
                           "description": description})
        if provider == "demo":
            raise LlmError('demo provider has no recorded answer for stage "%s". Set LLM_PROVIDER to gemini or openai.' % stage)

        raw = self._call(prompt, temperature)
        try:
            return self._validate(stage, validate, parse_json(raw))
        except LlmError as first:
            second = self._call(prompt + "\n\n---\n" + repair_prompt(str(first), raw[:6000]), 0)
            return self._validate(stage, validate, parse_json(second))

    @staticmethod
    def _validate(stage: str, validate: Validator, value: Any) -> Any:
        try:
            return validate(value)
        except (ValueError, TypeError, KeyError, AttributeError) as err:
            raise LlmError("LLM output failed validation (stage %s): %s" % (stage, err))

    def _call(self, prompt: str, temperature: float) -> str:
        """Returns the model's raw text. The API key travels in a header, never in a URL."""
        key = config.llm_api_key()
        if not key:
            raise LlmError("LLM_API_KEY is required for a live provider.")
        provider, model = config.llm_provider(), config.llm_model()
        if provider == "openai":
            # the OpenAI wire format, at api.openai.com or any compatible gateway (LLM_BASE_URL)
            body = {"model": model, "temperature": temperature, "messages": [{"role": "user", "content": prompt}]}
            if config.llm_json_mode():
                body["response_format"] = {"type": "json_object"}
            if config.llm_reasoning_effort():
                body["reasoning_effort"] = config.llm_reasoning_effort()
            data = self._post(config.llm_base_url() + "/chat/completions", {"authorization": "Bearer " + key}, body)
            choices = data.get("choices") or [{}]
            return ((choices[0].get("message") or {}).get("content")) or ""
        if provider == "gemini":
            data = self._post(
                "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % model,
                {"x-goog-api-key": key},
                {"generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
                 "contents": [{"role": "user", "parts": [{"text": prompt}]}]},
            )
            candidates = data.get("candidates") or [{}]
            parts = (candidates[0].get("content") or {}).get("parts") or []
            return "".join(p.get("text", "") for p in parts)
        raise LlmError("Unsupported LLM_PROVIDER: %s" % provider)

    def _post(self, url: str, headers: dict, body: dict) -> dict:
        """POST with patience for rate limits: free tiers (Groq, Gemini) answer 429 when a run bursts."""
        res = None
        for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
            try:
                with httpx.Client(timeout=config.LLM_TIMEOUT_S, transport=self.transport) as client:
                    res = client.post(url, headers=headers, json=body)
            except httpx.HTTPError as err:
                raise LlmError("LLM request failed: %s" % err)
            if res.status_code != 429 or attempt == MAX_RATE_LIMIT_RETRIES:
                break
            try:
                wait = float(res.headers.get("retry-after", ""))
            except ValueError:
                wait = 5.0 * (attempt + 1)
            if self.on_event:
                self.on_event({"type": "stage", "stage": "llm", "level": "warn",
                               "message": "Provider rate limit hit; waiting %.0fs before retrying" % min(wait, MAX_RATE_LIMIT_WAIT_S)})
            self._sleep(min(max(wait, 1.0), MAX_RATE_LIMIT_WAIT_S))
        if res.status_code >= 400:
            raise LlmError("LLM provider returned %d: %s" % (res.status_code, res.text[:300]))
        return res.json()
