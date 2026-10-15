"""Incremental Bulbul HTTP audio proxy; never buffers the complete voice line."""
import asyncio
import time
import httpx
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

BASE_URL = 'https://api.sarvam.ai'

class ProviderError(Exception):
    """Safe player-visible error without upstream response bodies."""

def provider_message(status):
    if status in (401, 403): return 'Sarvam rejected the API key or model access. Check server configuration.'
    if status == 429: return 'Sarvam’s rate limit was reached. Please wait and try again.'
    return f'Sarvam returned HTTP {status}. Please try again.'

async def stream_speech(key, clip, client=None):
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10))
    response = None
    started = time.perf_counter()
    async def close():
        if response is not None: await response.aclose()
        await client.aclose()
    try:
        payload = {k: clip[k] for k in ('text', 'language_code', 'speaker', 'pace', 'temperature')}
        payload.update(model='bulbul:v4-flash', output_audio_codec='mp3', speech_sample_rate=24000)
        request = client.build_request('POST', BASE_URL + '/text-to-speech/stream', headers={'api-subscription-key': key, 'Content-Type': 'application/json'}, json=payload)
        response = await client.send(request, stream=True)
        if not response.is_success: raise ProviderError(provider_message(response.status_code))
        mime = response.headers.get('content-type', '')
        if not mime.startswith(('audio/', 'application/octet-stream')):
            raise ProviderError('Sarvam returned an unexpected audio response. Your dialogue is still available.')
        iterator = response.aiter_bytes()
        try: first = await anext(iterator)
        except StopAsyncIteration: raise ProviderError('Sarvam returned no audio. Your dialogue is still available.') from None
        first_ms = round((time.perf_counter() - started) * 1000)
    except BaseException as exc:
        await close()
        if isinstance(exc, (ProviderError, asyncio.CancelledError)): raise
        raise ProviderError('Sarvam speech could not be reached or timed out. Your dialogue is still available.') from None
    async def audio():
        received = len(first)
        try:
            yield first
            async for chunk in iterator:
                received += len(chunk)
                if received > 8 * 1024 * 1024: raise ProviderError('Speech exceeded the demo audio limit.')
                yield chunk
        finally:
            await close()
    return StreamingResponse(audio(), media_type='audio/mpeg', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-TTS-First-Byte-Ms': str(first_ms), 'Accept-Ranges': 'none'}, background=BackgroundTask(close))
