// TODO: ext-extract — use Defuddle to extract page content from HTML sent by the SW
import type { ExtractRequest, ExtractResponse } from './shared/messages';

chrome.runtime.onMessage.addListener((msg: ExtractRequest, _sender, sendResponse: (r: ExtractResponse) => void) => {
  // ext-extract will implement Defuddle-based extraction here.
  void msg;
  void sendResponse;
  return false;
});
