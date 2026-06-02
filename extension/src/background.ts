// TODO: ext-extract — handle ExtractRequest, return ExtractResponse
// TODO: ext-crawl  — handle CrawlRequest, emit CrawlProgress / CrawlComplete
// TODO: ext-realtime — handle SessionRequest, return SessionResponse
import type { WidgetToSW, SWToWidget } from './shared/messages';

chrome.runtime.onMessage.addListener(
  (msg: WidgetToSW, _sender, sendResponse: (r: SWToWidget) => void) => {
    // Downstream agents will implement routing here.
    void msg;
    void sendResponse;
    return false;
  }
);
