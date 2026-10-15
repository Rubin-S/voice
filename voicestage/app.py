"""VoiceStage / The Last Gate. Run: uvicorn app:app --reload"""
import asyncio
import copy
from contextlib import suppress
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from game import apply_action, fresh_state, preview_reply, public_state, system_prompt
from voice import CATALOG, CLIP_TTL, normalize_voice, queue_clip, descriptor, action_reaction
from provider import ProviderError, provider_message, stream_speech

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
API_KEY = os.getenv('SARVAM_API_KEY', '').strip()
BASE_URL = 'https://api.sarvam.ai'
SESSION_TTL = 86400
MAX_SESSIONS = 1000
app = FastAPI(title='VoiceStage — The Last Gate', version='2.0.0')

@dataclass
class Session:
    state: dict = field(default_factory=fresh_state)
    updated_at: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

sessions: dict[str, Session] = {}

class DeliveryInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    language_code: Literal['en-IN', 'hi-IN'] = 'en-IN'
    delivery: Literal['stream', 'complete'] = 'stream'

class ActionInput(DeliveryInput):
    action: Literal['steal_key', 'return_key', 'help_guard', 'reset']

class TalkInput(DeliveryInput):
    text: str = Field(min_length=1, max_length=280)

    @field_validator('text')
    @classmethod
    def nonblank(cls, value):
        if not value.strip(): raise ValueError('Please enter a message.')
        return value.strip()

class VoiceInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    profile_id: str | None = None
    pace: float | None = None
    temperature: float | None = None
    adaptive: bool | None = None

class AuditionInput(DeliveryInput):
    profile_id: str | None = None
    pace: float | None = None
    temperature: float | None = None
    adaptive: bool | None = None
    sample_id: Literal['greeting', 'suspicious', 'grateful'] = 'greeting'
    text: str | None = Field(default=None, min_length=1, max_length=280)

@app.exception_handler(ProviderError)
async def provider_error(request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=502)

class Boundary:
    """Pure ASGI boundary so streaming disconnects are never intercepted by BaseHTTPMiddleware."""
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        api = request.url.path.startswith('/api/')
        if api:
            origin = request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                await JSONResponse({'detail': 'Cross-origin requests are not allowed.'}, status_code=403)(scope, receive, send)
                return
        messages = []
        if api and scope['method'] == 'POST':
            size = 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect': return
                size += len(message.get('body', b''))
                if size > 4096:
                    await JSONResponse({'detail': 'Request is too large.'}, status_code=413)(scope, receive, send)
                    return
                messages.append(message)
                if not message.get('more_body', False): break
        async def replay():
            if messages: return messages.pop(0)
            return await receive()
        async def headers(message):
            if message['type'] == 'http.response.start':
                updated = [(k, v) for k, v in message.get('headers', []) if k.lower() != b'x-content-type-options' and not (api and k.lower() == b'cache-control')]
                updated.append((b'x-content-type-options', b'nosniff'))
                if api: updated.append((b'cache-control', b'no-store'))
                message = {**message, 'headers': updated}
            await send(message)
        await self.app(scope, replay, headers)

app.add_middleware(Boundary)

def get_session(request: Request, response: Response, create=False):
    now = time.monotonic()
    token = request.cookies.get('vs_session', '')
    session = sessions.get(token)
    if session and now - session.updated_at < SESSION_TTL:
        session.updated_at = now
        return session
    if not create: raise HTTPException(409, 'Your encounter expired. Reload the page to begin again.')
    for old, item in list(sessions.items()):
        if now - item.updated_at >= SESSION_TTL and not item.lock.locked(): sessions.pop(old, None)
    if len(sessions) >= MAX_SESSIONS: raise HTTPException(503, 'The demo is busy. Please try again later.')
    token = str(uuid.uuid4())
    session = sessions[token] = Session()
    response.set_cookie('vs_session', token, httponly=True, secure=request.url.scheme == 'https', samesite='strict', max_age=SESSION_TTL, path='/api')
    return session

@app.get('/')
def homepage(): return FileResponse(ROOT / 'game' / 'index.html')

@app.get('/favicon.svg', include_in_schema=False)
def favicon(): return FileResponse(ROOT / 'game' / 'favicon.svg')

@app.get('/api/config')
def config():
    return dict(mode='live' if API_KEY else 'preview', configured=bool(API_KEY), llm_model='sarvam-105b-conversations', tts_model='bulbul:v4-flash', voices=CATALOG)

@app.get('/api/state')
async def state(request: Request, response: Response):
    session = get_session(request, response, create=True)
    async with session.lock: return {'state': public_state(session.state), 'history': session.state['history'], 'voice': normalize_voice(session.state.get('voice'))}

def settings_for(state, updates=None):
    try: return normalize_voice({**normalize_voice(state.get('voice')), **(updates or {})})
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc

async def finish(state, result, clip, delivery, started):
    audio = warning = None
    tts_ms = 0
    if API_KEY and clip and delivery == 'complete':
        ts = time.perf_counter()
        async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10)) as client:
            try:
                payload = {k: clip[k] for k in ('text', 'language_code', 'speaker', 'pace', 'temperature')}
                payload.update(model='bulbul:v4-flash', output_audio_codec='wav', speech_sample_rate=24000)
                speech = await call_sarvam(client, '/text-to-speech', payload)
                candidate = speech['audios'][0]
                if not isinstance(candidate, str) or not candidate or not re.fullmatch(r'[A-Za-z0-9+/=\s]+', candidate): raise ValueError('Invalid audio')
                audio = candidate
            except ProviderError as exc: warning = str(exc)
            except (KeyError, IndexError, TypeError, ValueError): warning = 'Sarvam returned no playable audio. Your dialogue is still available.'
        tts_ms = round((time.perf_counter() - ts) * 1000)
    return {**result, 'mode': 'live' if API_KEY else 'preview', 'voice': settings_for(state), 'speech': descriptor(clip, bool(API_KEY)) if clip else None, 'audio_base64': audio, 'audio_warning': warning, 'state': public_state(state), 'metrics': {**result.get('metrics', {}), 'total_ms': round((time.perf_counter() - started) * 1000), 'tts_ms': tts_ms}}

@app.post('/api/voice')
async def set_voice(req: VoiceInput, request: Request, response: Response):
    session = get_session(request, response)
    async with session.lock:
        session.state['voice'] = settings_for(session.state, req.model_dump(exclude_unset=True))
        return {'voice': session.state['voice'], 'state': public_state(session.state)}

@app.post('/api/action')
async def action(req: ActionInput, request: Request, response: Response):
    session = get_session(request, response)
    async with session.lock:
        started = time.perf_counter()
        state = session.state
        before, voice = public_state(state), settings_for(state)
        event = apply_action(state, req.action)
        if req.action == 'reset': state['voice'] = voice
        reply = action_reaction(state, req.action, req.language_code) if before != public_state(state) else None
        clip = queue_clip(state, reply, req.language_code, 'action') if reply else None
        return await finish(state, {'event': event, 'reply': reply}, clip, req.delivery, started)

@app.post('/api/audition')
async def audition(req: AuditionInput, request: Request, response: Response):
    session = get_session(request, response)
    async with session.lock:
        started = time.perf_counter()
        settings = settings_for(session.state, {k: v for k, v in req.model_dump(exclude_unset=True).items() if k in ('profile_id', 'pace', 'temperature', 'adaptive')})
        text = req.text if req.text is not None else CATALOG['samples'][req.sample_id][req.language_code]
        if not text.strip(): raise HTTPException(422, 'Enter a line to audition.')
        clip = queue_clip(session.state, text.strip(), req.language_code, 'audition', {**settings, 'adaptive': False})
        return await finish(session.state, {'reply': text.strip()}, clip, req.delivery, started)

@app.get('/api/speech')
async def speech(request: Request, response: Response, id: str = ''):
    session = get_session(request, response)
    async with session.lock:
        clip = next((copy.deepcopy(c) for c in session.state.get('clips', []) if c['id'] == id and time.time() - c['created_at'] / 1000 < CLIP_TTL), None)
    if not clip: raise HTTPException(404, 'This voice line expired or is not part of your encounter.')
    if not API_KEY: raise HTTPException(409, 'Bulbul speech needs a server-side Sarvam API key. Device preview is available.')
    async def disconnected():
        while True:
            message = await request.receive()
            if message['type'] == 'http.disconnect': return
    opening = asyncio.create_task(stream_speech(API_KEY, clip))
    watcher = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({opening, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            if opening.done():
                with suppress(Exception):
                    prepared = opening.result()
                    if prepared.background: await prepared.background()
            else:
                opening.cancel()
                with suppress(asyncio.CancelledError): await opening
            return Response(status_code=499)
        return await opening
    except BaseException:
        opening.cancel()
        with suppress(asyncio.CancelledError, Exception): await opening
        raise
    finally:
        watcher.cancel()
        with suppress(asyncio.CancelledError): await watcher

async def call_sarvam(client, endpoint, payload):
    try:
        result = await client.post(BASE_URL + endpoint, headers={'api-subscription-key': API_KEY, 'Content-Type': 'application/json'}, json=payload)
    except httpx.RequestError as exc:
        raise ProviderError('Sarvam could not be reached or timed out. Please try again.') from exc
    if not result.is_success:
        message = 'Sarvam rejected the API key or model access. Check server configuration.' if result.status_code in (401, 403) else 'Sarvam’s rate limit was reached. Please wait and try again.' if result.status_code == 429 else f'Sarvam returned HTTP {result.status_code}. Please try again.'
        raise ProviderError(message)
    try: data = result.json()
    except ValueError as exc: raise ProviderError('Sarvam returned an unreadable response. Please try again.') from exc
    if not isinstance(data, dict): raise ProviderError('Sarvam returned an unexpected response. Please try again.')
    return data

@app.post('/api/talk')
async def talk(req: TalkInput, request: Request, response: Response):
    session = get_session(request, response)
    async with session.lock:
        state = session.state
        started = time.perf_counter()
        usage = None
        if not API_KEY:
            reply = preview_reply(state, req.text, req.language_code)
        else:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10)) as client:
                messages = [{'role': 'system', 'content': system_prompt(state, req.language_code)}, *state['history'][-8:], {'role': 'user', 'content': req.text}]
                chat = await call_sarvam(client, '/v1/chat/completions', dict(model='sarvam-105b-conversations', messages=messages, temperature=.6, max_tokens=180))
                try:
                    reply = chat['choices'][0]['message']['content']
                    if not isinstance(reply, str) or not reply.strip(): raise ValueError('Empty dialogue')
                    reply = ' '.join(reply.split())[:600]
                    usage = chat.get('usage')
                except (KeyError, IndexError, TypeError, ValueError) as exc:
                    raise HTTPException(502, 'Sarvam returned no dialogue. Please try again.') from exc
        state['history'] = (state['history'] + [{'role': 'user', 'content': req.text}, {'role': 'assistant', 'content': reply}])[-8:]
        clip = queue_clip(state, reply, req.language_code, 'dialogue')
        return await finish(state, {'reply': reply, 'metrics': {'dialogue_ms': round((time.perf_counter() - started) * 1000), 'usage': usage}}, clip, req.delivery, started)

app.mount('/game', StaticFiles(directory=ROOT / 'game'), name='game')
