import type { WidgetToSW, SWToWidget, ExtractRequest, ExtractResponse } from './shared/messages';

(function () {
  if ((window as unknown as { __browseleeInjected?: boolean }).__browseleeInjected) return;
  (window as unknown as { __browseleeInjected?: boolean }).__browseleeInjected = true;

  // Create shadow host
  const host = document.createElement('div');
  host.id = 'browselee-host';
  const shadow = host.attachShadow({ mode: 'open' });

  // Iframe style inside shadow (no host page style bleed)
  const style = document.createElement('style');
  style.textContent = `
    iframe {
      position: fixed;
      bottom: 0;
      right: 0;
      width: 420px;
      height: 600px;
      border: none;
      z-index: 2147483646;
      background: transparent;
      pointer-events: auto;
    }
  `;
  shadow.appendChild(style);

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('src/widget/index.html');
  iframe.allow = 'microphone';
  shadow.appendChild(iframe);

  document.documentElement.appendChild(host);

  // Connect port to SW
  let port: chrome.runtime.Port | null = null;
  let reconnectTimer: number | null = null;

  function connectPort() {
    try {
      port = chrome.runtime.connect({ name: 'browselee-widget' });
    } catch (err) {
      console.warn('[browselee] port connect failed', err);
      scheduleReconnect();
      return;
    }

    port.onMessage.addListener((msg: SWToWidget) => {
      iframe.contentWindow?.postMessage(msg, '*');
    });

    port.onDisconnect.addListener(() => {
      port = null;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectPort();
    }, 2000);
  }

  connectPort();

  // Relay widget → SW
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data as WidgetToSW | undefined;
    if (!msg || typeof msg.kind !== 'string') return;

    // Intercept extraction triggers: widget can't access the page DOM, so the
    // content script captures outerHTML + href before forwarding to the SW.
    if (msg.kind === 'extract:current-page') {
      const correlationId = crypto.randomUUID();
      const req: ExtractRequest = {
        kind: 'extract:current-page',
        html: document.documentElement.outerHTML,
        url: location.href,
        correlationId,
      };
      chrome.runtime
        .sendMessage(req)
        .then((resp: ExtractResponse) => {
          iframe.contentWindow?.postMessage(resp as SWToWidget, '*');
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          console.warn('[browselee] extract failed:', error);
          const errorResp: ExtractResponse = {
            kind: 'extract:result',
            correlationId,
            ok: false,
            error,
          };
          iframe.contentWindow?.postMessage(errorResp as SWToWidget, '*');
        });
      return; // handled; do not forward to port
    }

    try {
      port?.postMessage(msg);
    } catch (err) {
      console.warn('[browselee] port post failed', err);
    }
  });

  // Eager crawl on iframe load
  iframe.addEventListener('load', () => {
    const crawlMsg: WidgetToSW = { kind: 'crawl:start', tabId: 0 };
    try {
      port?.postMessage(crawlMsg);
    } catch (err) {
      console.warn('[browselee] initial crawl post failed', err);
    }
  });
})();
