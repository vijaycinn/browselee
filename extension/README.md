# Browselee Extension

> See [repo root README](../README.md) for full project overview.

Chrome extension (Manifest V3) for injecting a floating chat/voice widget on any webpage.

---

## Quick Start

```powershell
# Install and build
pnpm install
pnpm --filter @browselee/extension build

# Load in Chrome:
# 1. chrome://extensions
# 2. Developer mode ON (top-right)
# 3. Load unpacked → C:\workspace\browselee\extension\dist
```

---

## Features

- **Shadow DOM widget** — Isolated iframe, doesn't interfere with page styles/scripts
- **Service Worker routing** — Central message hub for extraction, crawl, and chat flows
- **Concurrent link crawl** — Fetches up to 8 same-origin linked pages in parallel
- **Defuddle integration** — Cleans HTML (removes nav, sidebars, ads) for better grounding
- **Realtime voice + text** — WebRTC direct to Azure AI Foundry (no proxy)
- **Fallback to text mode** — SSE streaming via backend if Realtime unavailable
- **Settings persistence** — `chrome.storage.local` for backend URL, model, voice, etc.

---

## Architecture

```
Content Script (content.ts)
  └─ Injects widget iframe + bridge to Service Worker

Service Worker (background.ts)
  ├─ Routes extract/crawl/session messages between content and offscreen
  ├─ Ensures single offscreen doc (prevents race conditions)
  └─ Coordinates page extraction via runCrawl()

Offscreen Document (offscreen.html + offscreen.ts)
  ├─ Runs DOMParser + link extraction (isolated context)
  └─ Communicates with SW via chrome.runtime.sendMessage

Widget (widget/App.tsx + hooks)
  ├─ useRealtime.ts — WebRTC + Realtime session management
  ├─ useExtraction.ts — Corpus fetch + status tracking
  └─ useChannel.ts — Bidirectional SW message channel
```

---

## Building & Testing

```powershell
# Build (outputs to dist/)
pnpm build

# Run tests (offscreen, crawler, corpus formatting)
pnpm test

# Watch mode (dev)
pnpm dev
```

---

## Configuration

Extension reads these from `chrome.storage.local`:

| Key | Default | Description |
|---|---|---|
| `browselee_backend_url` | `http://localhost:8080` | Backend API endpoint |
| `browselee_settings.model` | `realtime` | `realtime` or `text` |
| `browselee_settings.voice` | `alloy` | Voice name (alloy/ash/ballad/coral/echo/marin/sage/shimmer/verse) |

---

## See Also

- [Main README](../README.md) — project overview, architecture diagram, quick start
- [Demo runbook](../docs/DEMO-SACRAMENTO.md) — City of Sacramento walkthrough + talking points
- [Realtime API contract](../docs/realtime-api-notes.md) — WebRTC + session endpoints
- [`lib/crawl.ts`](./src/lib/crawl.ts) — Concurrent link fetching, corpus assembly
- [`lib/corpusFormatter.ts`](./src/lib/corpusFormatter.ts) — Format corpus as system prompt

