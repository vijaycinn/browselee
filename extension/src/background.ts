// Service Worker: routes extract/crawl/session messages between content, offscreen, and widget.
// TODO: ext-crawl  — handle CrawlRequest, emit CrawlProgress / CrawlComplete
// TODO: ext-realtime — handle SessionRequest, return SessionResponse
import type {
  WidgetToSW,
  SWToWidget,
  ExtractResponse,
  ExtractedPage,
} from './shared/messages';

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
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    msg: WidgetToSW | ExtractResponse,
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

    return false;
  },
);
