// TODO: ext-widget-ui — inject widget iframe, relay WidgetToSW / SWToWidget messages
import type { WidgetToSW, SWToWidget } from './shared/messages';

// Relay messages from the widget iframe to the service worker.
window.addEventListener('message', (event: MessageEvent<WidgetToSW>) => {
  // ext-widget-ui will validate origin before forwarding.
  void event;
});

// Relay messages from the service worker back to the widget iframe.
chrome.runtime.onMessage.addListener((msg: SWToWidget) => {
  void msg;
});
