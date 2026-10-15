# VoiceStage Bulbul upgrade — design and implementation plan

The approved scope is the six voice-focused improvements from the conversation: automatic voiced action reactions, streaming speech, auditionable character voices, English/Hindi continuity, audio-driven animation/captions, and a comparison panel. Preserve the encounter, its authoritative game rules, and the private Site audience. No live voice/quality claim without a real Sarvam key.

## Architecture
- Keep one scene and both existing backends. Share the curated voice catalog as JSON and share the complete browser frontend.
- Return dialogue and an opaque session-bound speech descriptor from talk/action/audition. Store descriptors in the existing session JSON (bounded, expiring), including their server-generated text and validated voice settings. Never trust arbitrary client state or expose keys.
- Proxy `GET /api/speech?id=...` to Bulbul's HTTP streaming endpoint using MP3 at 24 kHz. Forward audio incrementally, close upstream on cancel, surface safe pre-stream errors, and time out stalled providers. A speech failure cannot undo an already committed game action or erase generated dialogue.
- Use MediaSource for progressive MP3 playback when supported. Collect the same response chunks for a replay Blob. If MSE is unsupported or fails before playback, buffer that same response and label the fallback. Stop/cancel aborts the active request; no automatic paid retry.
- Offer three language-paired profiles, validated pace (0.5–2.0), temperature (0.01–1.0), and optional state-adapted pace. Pairs are curated candidates, not a claim of the same actor or verified cross-language quality. Preview stays labeled scripted/device speech and cannot demonstrate Bulbul persona differences.
- Action reactions use authored bilingual lines selected by authoritative post-action state. Auditions use fixed scenario text or the same custom short line across profiles; they do not alter conversation history or world state. Restart preserves chosen voice settings while clearing memory and stale clip descriptors.
- Animate a portrait mouth, waveform, and speaking indicator using actual playback/analyser data. Captions appear during playback; word highlighting uses estimated timing unless native device boundary events are available. No phoneme-aligned lip-sync claim.
- Keep browser-observed first-byte, playback-start, full-audio, errors, and voice settings per utterance. Summarize live samples separately from preview. Offer human quality ratings and notes, manual measured account spend, CSV/JSON export, and explicitly unknown costs until entered.

## Tasks
1. Add catalog, voice validation, delivery helpers, and bilingual action-reaction tests; observe failures and implement them.
2. Add session-scoped speech descriptors, settings, audition, streaming proxy, and cancellation tests in the hosted routes. Preserve complete-response delivery as an explicit compatibility option.
3. Implement matching FastAPI APIs and provider streaming lifecycle with mocked streaming/error regression tests. Reuse the same catalog and frontend.
4. Build Voice Studio and the modular player: comparison controls, playback/replay/stop, source labels, portrait animation, captions, and evaluation metrics/export. Test pure metrics/caption helpers and static wiring.
5. Run both complete test suites, TypeScript and JavaScript checks, shared-file consistency checks, and production build. Browser QA remains unverified if supported control-browser is unavailable. Review the diff for secrets, state drift, failed-stream behavior, and mislabeled preview results.
6. Update the existing source ZIP and its Library identity, synchronize verified source using Sites, and publish to the existing private URL.

## Review focus
- Clips belonging to another/expired session must be inaccessible; user text/profile/pace must be validated.
- Empty/JSON upstream responses must never be returned as playable audio.
- Stream cancellation must release provider resources; replay must avoid another synthesis request.
- Concurrent actions/settings/auditions must retain optimistic conflict detection; action reactions must match committed state.
- Device preview, buffered fallback, estimated captions, missing live quality data, and manually entered costs must be labeled accurately.
