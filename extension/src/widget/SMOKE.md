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
