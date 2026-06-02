// Service Worker: routes extract/crawl/session messages between content, offscreen, and widget.
// TODO: ext-realtime — handle SessionRequest, return SessionResponse
import type {
  WidgetToSW,
  SWToWidget,
  ExtractResponse,
  ExtractedPage,
  ExtractLinksResult,
  PageCorpus,
  CrawlProgress,
  CrawlComplete,
} from './shared/messages';
import { runCrawl, DEFAULTS } from './lib/crawl';

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

/** Shared promise so concurrent callers never race to create two offscreen docs. */
let offscreenReady: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('src/offscreen.html'),
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Parse and clean webpage HTML with defuddle',
      });
    }
  })().catch((err: unknown) => {
    // Reset so the next caller retries.
    offscreenReady = null;
    throw err;
  });

  return offscreenReady;
}

// ---------------------------------------------------------------------------
// Pending-request registry  (correlationId → { resolve, reject, timer })
// ---------------------------------------------------------------------------

interface PendingEntry {
  resolve: (page: ExtractedPage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

const EXTRACT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Pending-links registry  (correlationId → resolve/reject for extract:links)
// ---------------------------------------------------------------------------

interface PendingLinksEntry {
  resolve: (links: string[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingLinks = new Map<string, PendingLinksEntry>();

const LINKS_TIMEOUT_MS = 5_000;

/**
 * Core relay: ensure offscreen is open, register a pending entry keyed by
 * correlationId, send the HTML to the offscreen document, and await its
 * response (which arrives as a separate `extract:result` message).
 */
async function doExtract(html: string, url: string): Promise<ExtractedPage> {
  await ensureOffscreen();

  const correlationId = crypto.randomUUID();

  return new Promise<ExtractedPage>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(correlationId);
      reject(
        new Error(`[SW] extract timed out after ${EXTRACT_TIMEOUT_MS / 1000}s (${correlationId})`),
      );
    }, EXTRACT_TIMEOUT_MS);

    pending.set(correlationId, { resolve, reject, timer });

    chrome.runtime
      .sendMessage({ kind: 'extract:from-html', html, url, correlationId })
      .catch((err: unknown) => {
        const entry = pending.get(correlationId);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(correlationId);
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Public API used by ext-crawl and other internal SW callers
// ---------------------------------------------------------------------------

/**
 * Extract the current page of the given tab by injecting a script to capture
 * its outerHTML, then running it through the offscreen Defuddle pipeline.
 */
export async function extractCurrentPage(tabId: number): Promise<ExtractedPage> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ html: document.documentElement.outerHTML, url: location.href }),
  });
  const { html, url } = results[0].result as { html: string; url: string };
  return doExtract(html, url);
}

/**
 * Extract an arbitrary HTML string without a live tab.
 * Used by ext-crawl to process linked-page HTML already fetched.
 */
export async function extractFromHtml(html: string, url: string): Promise<ExtractedPage> {
  return doExtract(html, url);
}

// ---------------------------------------------------------------------------
// Link extraction via offscreen DOMParser
// ---------------------------------------------------------------------------

async function extractLinksViaOffscreen(html: string, baseUrl: string): Promise<string[]> {
  await ensureOffscreen();
  const correlationId = crypto.randomUUID();

  return new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingLinks.delete(correlationId);
      reject(new Error(`[SW] extract:links timed out (${correlationId})`));
    }, LINKS_TIMEOUT_MS);

    pendingLinks.set(correlationId, { resolve, reject, timer });

    chrome.runtime
      .sendMessage({ kind: 'extract:links', html, baseUrl, correlationId })
      .catch((err: unknown) => {
        const entry = pendingLinks.get(correlationId);
        if (entry) {
          clearTimeout(entry.timer);
          pendingLinks.delete(correlationId);
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Corpus cache  (tabId → latest PageCorpus for instant re-opens)
// ---------------------------------------------------------------------------

const corpusCache = new Map<number, PageCorpus>();

// ---------------------------------------------------------------------------
// Widget port management + broadcasting
// ---------------------------------------------------------------------------

const widgetPorts = new Set<chrome.runtime.Port>();

function broadcastToWidget(msg: CrawlProgress | CrawlComplete): void {
  for (const port of widgetPorts) {
    try {
      port.postMessage(msg as SWToWidget);
    } catch {
      widgetPorts.delete(port);
    }
  }
}

// ---------------------------------------------------------------------------
// Session request handler  (ext-realtime)
// ---------------------------------------------------------------------------

async function handleSessionRequest(
  msg: { kind: 'session:request'; voice?: string; instructions?: string },
  port: chrome.runtime.Port,
): Promise<void> {
  let backendUrl: string;
  try {
    const stored = await chrome.storage.local.get(['BROWSELEE_BACKEND_URL']);
    backendUrl =
      (stored['BROWSELEE_BACKEND_URL'] as string | undefined) ?? 'http://localhost:8080';
  } catch {
    backendUrl = 'http://localhost:8080';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const body: Record<string, string> = {};
    if (msg.voice) body.voice = msg.voice;
    if (msg.instructions) body.instructions = msg.instructions;

    const response = await fetch(`${backendUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      let errDetail: string;
      try {
        const j = (await response.json()) as { error?: string };
        errDetail = j.error ?? `HTTP ${response.status}`;
      } catch {
        errDetail = `HTTP ${response.status}`;
      }
      port.postMessage({ kind: 'session:response', ok: false, error: errDetail } as SWToWidget);
      return;
    }

    const json = (await response.json()) as {
      clientSecret: string;
      expiresAt: number | null;
      webrtcCallsUrl: string;
      model: string;
    };

    // Never log clientSecret
    port.postMessage({
      kind: 'session:response',
      ok: true,
      clientSecret: json.clientSecret,
      expiresAt: json.expiresAt ?? 0,
      webrtcUrl: json.webrtcCallsUrl,
      model: json.model,
    } as SWToWidget);
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const error = isTimeout ? 'session_request_timeout' : 'session_request_failed';
    try {
      port.postMessage({ kind: 'session:response', ok: false, error } as SWToWidget);
    } catch {
      // Port disconnected; nothing to do.
    }
  }
}

// ---------------------------------------------------------------------------
// Port connection handler (widget connects via content script port)
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'browselee-widget') return;

  widgetPorts.add(port);
  port.onDisconnect.addListener(() => widgetPorts.delete(port));

  port.onMessage.addListener(async (msg: WidgetToSW) => {
    if (msg.kind === 'session:request') {
      await handleSessionRequest(msg, port);
      return;
    }
    if (msg.kind !== 'crawl:start') return;

    // Resolve tabId: content.ts sends tabId:0, use sender tab or active tab
    let tabId = msg.tabId;
    if (!tabId) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id ?? 0;
      } catch {
        tabId = 0;
      }
    }

    // Return cached corpus immediately if available
    if (tabId && corpusCache.has(tabId)) {
      port.postMessage({ kind: 'crawl:complete', corpus: corpusCache.get(tabId)! } as SWToWidget);
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ html: document.documentElement.outerHTML, url: location.href }),
      });
      const { html, url } = results[0].result as { html: string; url: string };

      const corpus = await runCrawl(html, url, DEFAULTS, {
        extractFromHtml,
        getLinks: extractLinksViaOffscreen,
        onProgress: (done, total) => {
          broadcastToWidget({ kind: 'crawl:progress', done, total });
        },
      });

      if (tabId) corpusCache.set(tabId, corpus);
      broadcastToWidget({ kind: 'crawl:complete', corpus });
    } catch (err: unknown) {
      const msg2 = err instanceof Error ? err.message : String(err);
      console.error(`[SW] crawl failed for tab ${tabId}: ${msg2}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    msg: WidgetToSW | ExtractResponse | ExtractLinksResult,
    _sender,
    sendResponse: (r: SWToWidget) => void,
  ): boolean => {
    // ── Incoming from content script / widget ──────────────────────────────
    if (msg.kind === 'extract:current-page') {
      const { html, url, correlationId } = msg;
      doExtract(html, url)
        .then((page) => sendResponse({ kind: 'extract:result', correlationId, ok: true, page }))
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          console.error('[SW] extraction failed:', error);
          sendResponse({ kind: 'extract:result', correlationId, ok: false, error });
        });
      return true; // async response
    }

    // ── Incoming from offscreen document ──────────────────────────────────
    if (msg.kind === 'extract:result') {
      const { correlationId } = msg;
      const entry = pending.get(correlationId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(correlationId);
        if (msg.ok) {
          entry.resolve(msg.page);
        } else {
          entry.reject(new Error(msg.error));
        }
      }
      return false;
    }

    // ── extract:links:result — from offscreen after DOMParser link scan ──
    if (msg.kind === 'extract:links:result') {
      const { correlationId, links } = msg;
      const entry = pendingLinks.get(correlationId);
      if (entry) {
        clearTimeout(entry.timer);
        pendingLinks.delete(correlationId);
        entry.resolve(links);
      }
      return false;
    }

    return false;
  },
);
