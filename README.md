# VoiceStage — The Last Gate · Bulbul voice lab

A private hosted character-voice experience centered on **Bulbul v4 Flash**, with a matching runnable FastAPI package under `voicestage/`.

Toren immediately reacts aloud to game actions. Voice Studio auditions three English/Hindi persona pairs using the same text; saved profiles, pace, variation, and optional adaptive delivery shape the encounter. Streaming MP3 playback, cached replay, interruption, audio-driven portrait/waveform, playback captions, and an evaluation/export log make voice behavior visible and testable.

The shared vanilla frontend lives in `public/game`. Hosted APIs use Vinext/D1; Python uses bounded in-memory sessions. Both read the same curated catalog and keep all Sarvam credentials server-side. No real API key is bundled. Preview is explicitly scripted/device speech and cannot demonstrate Bulbul persona differences.

Set `SARVAM_API_KEY` as a hosted runtime secret and redeploy for live speech. For Python setup, API details, stream/fallback behavior, measurement definitions, privacy, and limitations, read `voicestage/README.md`.

## Validation

```bash
npm test
node node_modules/typescript/bin/tsc --noEmit
node --check public/game/main.js
```

Run Python tests from `voicestage/` after installing `requirements-dev.txt`. Tests mock provider calls; no paid synthesis is used. The hosted tests exercise real route logic and SQL through a SQLite-backed D1 adapter. Browser-level and live-model checks require their respective environment/access.

The existing D1 schema already stores session JSON, including bounded expiring clip descriptors and voice settings; no schema migration is required for this upgrade. Publishing follows the Sites workflow and preserves Site identity and access.

Design/plan: `docs/voice-upgrade.md`. Verification status: `voicestage/VERIFICATION.md`.
