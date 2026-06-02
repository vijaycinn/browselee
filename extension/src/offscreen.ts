// Offscreen document: parses HTML with DOMParser and runs Defuddle extraction.
import Defuddle from 'defuddle';
import type { ExtractRequest, ExtractResponse, ExtractedPage } from './shared/messages';

chrome.runtime.onMessage.addListener((msg: ExtractRequest, _sender, _sendResponse) => {
  if (msg.kind !== 'extract:current-page' && msg.kind !== 'extract:from-html') return false;

  const { html, url, correlationId } = msg;

  (async () => {
    let response: ExtractResponse;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Ensure a <base> tag exists so Defuddle resolves relative URLs correctly.
      if (!doc.querySelector('base')) {
        const base = doc.createElement('base');
        base.href = url;
        doc.head.prepend(base);
      }

      const result = new Defuddle(doc, { markdown: true, url }).parse();

      const wordCount =
        typeof result.wordCount === 'number' && result.wordCount > 0
          ? result.wordCount
          : (result.content ?? '').trim().split(/\s+/).filter(Boolean).length;

      const page: ExtractedPage = {
        url,
        title: result.title ?? '',
        byline: result.author || undefined,
        author: result.author || undefined,
        published: result.published || undefined,
        content: result.content ?? '',
        wordCount,
      };

      response = { kind: 'extract:result', correlationId, ok: true, page };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error('[offscreen] extraction error:', error);
      response = { kind: 'extract:result', correlationId, ok: false, error };
    }

    // Send response back to SW as a new message (SW routes via pending Map).
    try {
      await chrome.runtime.sendMessage(response);
    } catch (sendErr) {
      console.error('[offscreen] failed to send result to SW:', sendErr);
    }
  })();

  return false; // response is sent as a separate message, not via sendResponse
});
