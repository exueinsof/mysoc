import json

import httpx


async def stream_ollama(url: str, payload: dict):
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                text = chunk.get("response")
                if text:
                    yield text


async def list_ollama_models(base_url: str) -> list[str]:
    tags_url = base_url.rsplit("/", 1)[0] + "/tags"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(tags_url)
        response.raise_for_status()
        payload = response.json()
    return [item.get("name") for item in payload.get("models", []) if item.get("name")]
