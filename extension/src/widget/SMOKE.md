# Browselee Widget Smoke Test

Manual smoke test steps for the widget UI. No automated tests yet — adding jsdom/vitest is deferred.

## Prereqs
1. `cd C:\workspace\browselee\extension`
2. `pnpm build` (or `pnpm dev`)
3. Load the unpacked extension from `dist/` in `chrome://extensions/` (Developer mode → Load unpacked).

## Visual / interaction checks
Visit any content page (e.g. https://en.wikipedia.org/wiki/Browser_extension):

- [ ] Floating launcher button appears bottom-right with pulsing accent ring.
- [ ] Click launcher → panel slides in (scale + fade), launcher icon switches to ✕.
- [ ] Header shows `Browselee`, a status pill (`idle` by default), gear icon, close icon.
- [ ] Extraction progress bar shows "Reading page…" until `crawl:complete` arrives, then disappears.
- [ ] Empty state shows chat icon + "Ask anything about this page".
- [ ] Type a message → press Enter → user bubble appears on right (teal). Input clears.
- [ ] Shift+Enter inserts newline, does not send.
- [ ] Press Esc → panel closes.
- [ ] Press gear → settings drawer slides in from the right. Back button returns.
- [ ] Settings: change model / voice → reload extension → values persist (`chrome.storage.local`).
- [ ] Hold mic button → browser prompts for microphone permission (first time only). Button turns red and pulses while held. Release → returns to idle and tracks stop.
- [ ] Deny mic permission → no crash, console warns `[browselee] mic access denied`.

## Channel checks (DevTools)
- [ ] Open the page; in the page's DevTools console, the content script connects a port `browselee-widget`.
- [ ] Inside the iframe DevTools (right-click widget → Inspect), `window.parent.postMessage({kind:'session:request'}, '*')` reaches the SW (visible in SW console).
- [ ] SW → widget: any `crawl:progress` / `crawl:complete` posted by the SW updates the progress bar and clears extracting state.

## Known stubs
- `useRealtime` is a render stub. `startVoice`, `stopVoice`, `sendText` log warnings. The transcript array is always empty until `ext-realtime` wires it up.
- The mic button still requests `getUserMedia` lazily so the permission UX can be validated independently of realtime wiring.

## Realtime live test (ext-realtime)

### Prereqs
1. Backend running: `cd C:\workspace\browselee\backend && pnpm dev` (default port 8080).
   - Ensure `FOUNDRY_REALTIME_MODEL`, `AZURE_OPENAI_ENDPOINT` (or `FOUNDRY_REALTIME_BASE_URL`), and Azure credential env vars are set.
2. `pnpm build` in `extension/` — produces `dist/`.
3. Load/reload unpacked extension from `dist/` in `chrome://extensions/`.

### Voice path
1. Navigate to any content page (e.g. https://en.wikipedia.org/wiki/WebRTC).
2. Open Browselee widget; status pill shows `idle`. Wait a few seconds for "Reading page…" bar to disappear (crawl complete).
3. Hold the mic button. Browser prompts for microphone permission — grant it.
   - Status pill transitions: `idle` → `connecting` → `live`.
4. Speak a question about the page (e.g. "What is WebRTC?"). Release button.
   - You should hear the model's voice response through the speaker.
   - The transcript area shows user audio transcription (once `conversation.item.input_audio_transcription.completed` fires) and assistant text (from `response.output_audio_transcript.delta`).
5. Hold mic again; ask a follow-up. Release.
6. Verify: no red error pill; no `[SW]` errors in SW DevTools console.

### Text path (lazy connect)
1. Without pressing mic, type a question in the text box and press Enter.
   - Status transitions `idle` → `connecting` → `live` automatically.
   - User bubble appears immediately (optimistic). Assistant response text streams in.
2. Type a second message — connection is reused.

### Stop / disconnect
1. Navigate away or press Esc. The peer connection should close cleanly (`pc.onconnectionstatechange` → `disconnected`).
2. Re-opening the widget starts fresh (`idle`).

### Error scenarios to verify
- **Backend not running**: hold mic → status shows `error`; an error bubble appears with `session_request_timeout` or similar.
- **Mic denied**: hold mic → browser denies permission → `[browselee] mic access denied` in page console; no crash.
- **SDP exchange 4xx**: if the ephemeral token is invalid, `startVoice` should catch the error and show `error` status.

### Key signals in DevTools
- SW console (`chrome://extensions` → SW → Inspect): `[SW]` logs — no `clientSecret` values should appear.
- Widget iframe DevTools: `dc.readyState === 'open'` after `live` transition.
- Network tab (in widget iframe): one `POST /api/session` to backend, one `POST .../openai/v1/realtime/calls?webrtcfilter=on` with `Content-Type: application/sdp`, `201 Created` response.

