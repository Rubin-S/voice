# VoiceStage — The Last Gate · Bulbul voice lab

A playable medieval encounter built around **Sarvam Bulbul v4 Flash**. Talk to Toren, steal or return his key, recover his supplies, and hear him react. Voice Studio lets you audition three profiles in English and Hindi using the same text.

## Run

Python 3.10+. No GPU or Node.js required for this package.

```bash
cd voicestage
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --reload
```

On Windows PowerShell use `.venv\Scripts\Activate.ps1` and `Copy-Item .env.example .env` for activation/copy. Open **http://127.0.0.1:8000** and keep the terminal running. Serve through FastAPI; opening the HTML file directly cannot run the APIs.

Generate a Sarvam key at https://dashboard.sarvam.ai/, set it in `.env`, and restart:

```dotenv
SARVAM_API_KEY=your_actual_key
```

The key stays server-side. `.env` is ignored by Git. Without a key, the application explicitly uses scripted dialogue and optional device speech. Device preview does not apply Bulbul personas or demonstrate differences between them. A configured key that fails is reported as an error; the app never silently switches a live request to preview.

## Voice-focused features

- **Automatic reactions:** gameplay actions immediately return an authored bilingual response that reflects the resulting world state. Speech is synthesized with Bulbul in live mode; no LLM call is required for these short reactions.
- **Incremental audio:** dialogue is returned first. The browser then requests an opaque, session-bound voice clip. The server proxies Bulbul's HTTP audio stream as MP3 at 24 kHz, without buffering the complete line.
- **Replay and interruption:** the browser retains completed audio in a bounded Blob cache. Replay uses that received audio. Stop, changing language, starting a different line, or muting cancels active playback/download. An unfinished line without cached audio offers a clearly labeled Retry voice action; another synthesis request can incur another charge.
- **Voice Studio:** audition The Sentinel, The Storyteller, and The Warden with the same sample/custom line. Compare both languages, then assign a profile to Toren. Change pace and variation (TTS temperature), and optionally adapt in-game pace slightly to Toren's standing. Restart retains voice settings.
- **Playback animation:** the portrait mouth and waveform use Web Audio energy where available. Captions appear during playback. Word highlighting is estimated from playback time/duration; device speech can use native word-boundary events. This is not phoneme-aligned lip-sync.
- **Measurements:** record browser-observed first audio byte, playback start, full download, status, source, and voice settings. Human ratings and account spend are optional manual inputs. Export CSV or JSON. Preview and cached replays are excluded from live latency summaries.

## Voice profiles

| Profile | English persona | Hindi persona |
| --- | --- | --- |
| The Sentinel | `dev_en_conversational` | `ratan_hi_customer_expressive` |
| The Storyteller | `rustom_en_suspense` | `ratan_hi_documentary` |
| The Warden | `varun_en_suspense` | `ashok_hi_character` |

These are curated audition candidates using documented persona IDs. A profile pairs separate English and Hindi personas; shared actor identity and perceived cross-language continuity have not been verified. Audition before selecting. Changing language keeps the profile but selects its language-specific persona.

Supported controls are pace and temperature. Situation labels such as suspicious/grateful select text and optionally adjust pace; they are not a native emotion-control parameter. The application does not send pitch or loudness controls to Bulbul v4.

## Play and evaluate

1. Click Toren's portrait to hear a greeting, or open Voice Studio.
2. Audition the same line through each profile. Choose English or Hindi, then Use this voice.
3. Ask to enter. Entry remains restricted until you help Toren.
4. Steal the key: Toren immediately confronts you. Help while holding it: he thanks you but still demands it back.
5. Return the key after helping: the gate opens and he permits entry aloud.
6. Introduce yourself and test recent memory. The LLM gets four recent completed dialogue turns and six action events.
7. Stop a voice line, start another, mute, or replay cached audio.
8. Open Voice measurements, enter listening notes and measured spend, and export a log of at least 20 live conversations.

**Gate invariant:** `gate_open = helped_guard and not key_stolen`. Only game actions change world state. Prompting reduces inconsistent dialogue but cannot guarantee it. A model's words can never directly open the gate.

English/Hindi translation and arbitrary conversation are provided by the LLM in live mode. The scripted preview recognizes only a small set of intents and English introductions such as “My name is Rubin.”

## Streaming and browser behavior

The player uses MediaSource for progressive MP3 playback if the browser advertises support. Otherwise it buffers the same HTTP response and labels **buffered fallback**. It does not retry a paid synthesis request automatically. If appending fails, it retains the same chunks and falls back to buffered playback; the line may restart. Browser autoplay policy can require pressing Replay after the audio finishes downloading.

The portrait analyser requires Web Audio support and permission to resume its context after a user gesture. If unavailable, audio playback can still work without an energy-driven mouth/waveform. Device Hindi preview requires an installed Hindi voice. Speech never starts automatically on page load.

## API

Make `GET /api/state` first to establish the HttpOnly session cookie. The server does not trust client-provided session IDs or world state.

| Route | Request / behavior |
| --- | --- |
| `GET /api/config` | Mode, model names, curated voice catalog; no secret values |
| `GET /api/state` | State, recent dialogue history, saved voice settings |
| `POST /api/voice` | Partial settings: `profile_id`, `pace`, `temperature`, `adaptive` |
| `POST /api/action` | `action`, optional `language_code`, optional `delivery` |
| `POST /api/talk` | `text` (1–280 chars), optional language/delivery |
| `POST /api/audition` | Profile/settings, language, `sample_id` or custom short `text`; no world/history changes |
| `GET /api/speech?id=...` | Private expiring clip; returns incremental MP3 in live mode |

`delivery` defaults to `stream`: talk/action/audition responses contain text plus a `speech` descriptor; synthesis starts only when its URL is requested. Muted lines do not trigger TTS. Clips expire after ten minutes and are limited to the eight most recent per session. They cannot be retrieved from another session. Auditions cannot alter the assigned profile until Use this voice is pressed.

For compatibility, `delivery: "complete"` uses the original REST WAV/base64 response. A speech failure keeps the generated text/action state and returns a warning. No automatic retry or fabricated audio.

## Measurement definitions

- **Playback start:** time from submitting the action/message/audition to the browser's `playing` event. This includes dialogue generation when needed. It is not a physical measurement of when a listener hears sound.
- **First byte:** time from the speech fetch to its first audio chunk, as observed in the browser. The proxy also reports upstream first-byte time in `X-TTS-First-Byte-Ms`.
- **Audio ready:** time from speech fetch to complete download. It does not measure complete playback.
- **p50/p95:** interpolated percentiles over live, non-cached playback starts in this tab's current log. Small sample counts are not a reliable performance benchmark.
- **Measured spend:** manually entered account spend for the corresponding live attempts; cost per attempt divides that amount by logged live audio requests. It is not a provider price estimate or automatic billing report. The local log retains at most 100 rows, so export/clear it between separate evaluation runs.
- **Quality scores:** 1–5 human listening ratings. Blank means unmeasured.

Measurements and notes are kept in `sessionStorage` for the current tab, including dialogue text and any notes entered. Exported CSV protects cells from spreadsheet formula injection. Do not put sensitive information into evaluation notes.

## Files and tests

`app.py` owns API/session coordination; `game.py` owns game rules; `voice.py` owns profiles/reactions; `provider.py` owns the streaming lifecycle. `shared/voice-catalog.json` is the same catalog used by the hosted companion. The complete shared frontend is in `game/`, including the modular player, Studio, metrics helpers, scene artwork, and styles.

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

Tests mock provider HTTP and never make paid API calls. See `VERIFICATION.md` for verified paths and live/browser checks still pending.

## Deployment boundaries

This Python package uses bounded in-memory sessions with a 24-hour inactivity limit and a 1,000-session cap. Restart clears sessions. Use a single Uvicorn worker, or introduce a shared datastore for multiple workers. The hosted companion uses D1 and optimistic concurrency. The existing private audience is preserved. A public paid-API deployment needs user authentication and usage limits.

The project retains a 2D scene. It does not include a Unity SDK, 3D character, microphone input, or a complete game engine. HTTP streaming starts after the complete short dialogue has been generated; LLM-token-to-TTS streaming is a future latency improvement.

Live mode sends messages/history/world facts to Sarvam for dialogue and spoken lines to Sarvam for synthesis. Device preview uses the browser/OS speech engine and can depend on network services. Web fonts have system fallbacks.

Official API references checked on 15 October 2026:
- https://docs.sarvam.ai/api-reference/chat/chat-completions-v1
- https://docs.sarvam.ai/api-reference/text-to-speech/convert
- https://docs.sarvam.ai/api-reference/text-to-speech/convert-stream
- https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices

Original artwork generated for this project: torchlit fortress at dusk, stern armored guard, slate/sage palette, natural textures, no text or UI. VoiceStage is not affiliated with Sarvam AI or an existing game franchise.
