# The Last Gate — implementation brief

Build the one-scene VoiceStage encounter described in the user brief. A player talks to Toren in English or Hindi, takes or returns his key, and helps recover supplies. The gate opens if and only if the player helped and the key is safe. Conversation never changes gameplay state.

Use a shared, responsive HTML/CSS/JavaScript interface: atmospheric fortress artwork, character identity, readable dialogue, state indicators, actions, replay/mute, and restart. Supply a runnable Python/FastAPI project and a private hosted version using the same frontend and an equivalent Worker backend. Server-side secrets only. Without a configured Sarvam key, clearly label deterministic preview dialogue and optional device speech. Never silently substitute preview after a live failure.

Server sessions retain eight recent messages and six action events. Hosted records use D1 and a random HttpOnly cookie; FastAPI uses bounded expiring in-memory records. Serialize browser actions and detect concurrent hosted mutations. Expose configuration status without credentials. Preserve generated dialogue if speech fails and report a speech warning. Display end-to-end timing, no invented cost or performance claims.

## Implementation plan
1. Write and run failing state/preview tests covering the gate invariant, idempotency, reset, Hindi, and recent memory.
2. Implement deterministic game rules and Sarvam request construction in each backend. Add provider and API tests using mocked HTTP.
3. Build the shared frontend, state-specific scene overlays, audio controls, bilingual prompts, retry, and help/configuration dialog.
4. Run automated checks, TypeScript checking, twenty changing-state conversation tests, and production build. Browser QA only if supported control-browser is available.
5. Bundle the FastAPI source and setup instructions, save it, push verified source, and publish the private hosted demo. Live Sarvam voice and cost checks remain pending without the user's key.

## Review focus
- The key being stolen overrides earned trust and closes the gate.
- No-op actions do not invent a theft/return/help event.
- Provider failures do not mutate history; TTS failures retain text.
- No client-provided state is trusted, and cookies cannot select another session.
- HTML renders player/model content as text; no credentials in frontend or archive.
