# Verification — Bulbul voice upgrade · 15 October 2026

## Completed automated verification

- Hosted/server/browser-module suite: **31 tests passed**.
- FastAPI suite: **14 tests passed**.
- Total: **45 tests**, including the original changing-state conversation tests.
- TypeScript and browser-module JavaScript syntax checks passed.
- HTML container nesting, unique IDs, asset references, and shared frontend/catalog consistency checked.
- Production build passed.

Coverage includes the gate invariant, English/Hindi reactions, saved voice profiles, independent auditions, bounded session-scoped clips, provider error redaction, incremental proxy delivery, upstream cancellation, replay without another synthesis request, browser buffered fallback, MSE starting before full response, decoder failures, suspension for Back navigation, live-only latency summaries, and safe CSV export.

Code review found and prompted fixes for decoder-error state, cancellation before FastAPI's first audio byte, and BFCache audio-context restoration. Regression tests now pass. FastAPI uses a pure ASGI boundary so disconnect monitoring and streaming do not conflict with BaseHTTPMiddleware.

Provider calls in tests are mocked. Browser player tests use event/media stand-ins; they do not establish actual browser compatibility. Hosted route tests use a SQLite-backed D1 adapter. No real Sarvam key, paid synthesis, billing amount, quality score, or live latency was fabricated.

## Still requiring live verification

- Real Bulbul v4 Flash synthesis and model access for your account.
- Audible English/Hindi samples for all three voice profiles.
- Pronunciation, perceived character continuity, and expressive quality.
- Real browser MSE/autoplay/Web Audio behavior, mobile layout and accessibility, and Back navigation.
- At least 20 live conversations and measured provider account spend.

The supported control-browser capability was unavailable, so no interactive browser QA was performed. The game remains usable in clearly labeled scripted/device Preview mode without a configured server key. Preview does not apply Bulbul personas.

## Evaluation procedure

Configure SARVAM_API_KEY server-side. Audition each profile with the same line in both languages. Test neutral, theft, help-while-key-stolen, key-return, and earned-trust states. Run 20 conversations that change state and language, including interruptions and replay. Use Voice measurements to capture browser playback-start/first-byte timing; add human 1–5 ratings and notes. Enter actual account spend for the logged attempts if measured, then export CSV/JSON.

Captions follow playback, but word timing is estimated. Audio-driven mouth movement is not phoneme alignment. Cost remains unknown until manually measured; preview and cached replay do not enter live latency percentiles.
