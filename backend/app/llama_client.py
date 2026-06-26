import json
from typing import AsyncIterator

import httpx

from app.config import (
    LLAMA_BASE_URL,
    LLM_MAX_TOKENS,
    LLM_MIN_P,
    LLM_REPEAT_PENALTY,
    LLM_TEMPERATURE,
    LLM_TOP_P,
)

_client: httpx.AsyncClient | None = None


async def start_client() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=300.0))


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _get_client() -> httpx.AsyncClient:
    if _client is None:
        return httpx.AsyncClient(timeout=httpx.Timeout(120.0, read=300.0))
    return _client


def _base_payload(messages: list[dict], temperature: float) -> dict:
    payload = {
        "model": "local",
        "messages": messages,
        "temperature": temperature,
        "top_p": LLM_TOP_P,
        "min_p": LLM_MIN_P,
        "repeat_penalty": LLM_REPEAT_PENALTY,
        "cache_prompt": True,
    }
    if LLM_MAX_TOKENS > 0:
        payload["max_tokens"] = LLM_MAX_TOKENS
    return payload


async def stream_chat_completion(messages: list[dict], temperature: float = LLM_TEMPERATURE) -> AsyncIterator[str]:
    """Yields incremental assistant text deltas from the llama.cpp OpenAI-compatible endpoint."""
    payload = _base_payload(messages, temperature)
    payload["stream"] = True
    url = f"{LLAMA_BASE_URL}/v1/chat/completions"
    client = _get_client()
    should_close = client is not _client
    try:
        async with client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
    finally:
        if should_close:
            await client.aclose()


async def chat_completion(messages: list[dict], temperature: float = 0.2, max_tokens: int = 300) -> str:
    """Non-streaming helper for small internal calls."""
    payload = _base_payload(messages, temperature)
    payload["max_tokens"] = max_tokens
    payload["stream"] = False
    url = f"{LLAMA_BASE_URL}/v1/chat/completions"
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=60.0)) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def health_check() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{LLAMA_BASE_URL}/health")
            return resp.status_code == 200
    except httpx.HTTPError:
        return False
