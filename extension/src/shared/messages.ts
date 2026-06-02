// Message envelope between content script ⇄ SW ⇄ offscreen ⇄ widget iframe.

export type ExtractRequest = { kind: 'extract:current-page'; html: string; url: string };
export type ExtractResponse =
  | { kind: 'extract:result'; ok: true; page: ExtractedPage }
  | { kind: 'extract:result'; ok: false; error: string };

export interface ExtractedPage {
  url: string;
  title: string;
  byline?: string;
  author?: string;
  published?: string;
  content: string; // markdown
  wordCount: number;
}

export interface PageCorpus {
  currentPage: ExtractedPage;
  linkedPages: ExtractedPage[];
  totalChars: number;
  truncated: boolean;
}

export type CrawlRequest = { kind: 'crawl:start'; tabId: number };
export type CrawlProgress = { kind: 'crawl:progress'; done: number; total: number };
export type CrawlComplete = { kind: 'crawl:complete'; corpus: PageCorpus };

export type SessionRequest = { kind: 'session:request' };
export type SessionResponse =
  | { kind: 'session:response'; ok: true; clientSecret: string; expiresAt: number; webrtcUrl: string; model: string }
  | { kind: 'session:response'; ok: false; error: string };

export type WidgetToSW = ExtractRequest | CrawlRequest | SessionRequest;
export type SWToWidget = ExtractResponse | CrawlProgress | CrawlComplete | SessionResponse;
