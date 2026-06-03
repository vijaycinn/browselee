// Message envelope between content script ⇄ SW ⇄ offscreen ⇄ widget iframe.

export type ExtractRequest =
  /** Sent by content script to SW: page HTML captured from the live tab. */
  | { kind: 'extract:current-page'; html: string; url: string; correlationId: string; innerText?: string }
  /** Sent by SW to offscreen (or by ext-crawl via SW): arbitrary HTML string. */
  | { kind: 'extract:from-html'; html: string; url: string; correlationId: string; innerText?: string };

export type ExtractResponse =
  | { kind: 'extract:result'; correlationId: string; ok: true; page: ExtractedPage }
  | { kind: 'extract:result'; correlationId: string; ok: false; error: string };

export type SiteType =
  | 'government'
  | 'news'
  | 'ecommerce'
  | 'docs'
  | 'blog'
  | 'forum'
  | 'generic';

/**
 * Deterministic, client-side "About this page" descriptor.
 * Computed once per extraction from JSON-LD + meta tags + DOM signals.
 * Surfaces both in the widget header (transparency) and as the leading
 * block in the chat context (so the model frames the page correctly
 * before reading the body).
 */
export interface PageTheme {
  siteType: SiteType;
  siteName: string;
  pageTitle: string;
  h1: string;
  description: string;
  breadcrumbs: string[];
  topics: string[];
  urlPathTokens: string[];
  url: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  byline?: string;
  author?: string;
  published?: string;
  content: string; // markdown
  wordCount: number;
  /** Deterministic page descriptor extracted client-side from DOM/meta/JSON-LD. */
  theme?: PageTheme;
}

export interface PageCorpus {
  currentPage: ExtractedPage;
  linkedPages: ExtractedPage[];
  totalChars: number;
  truncated: boolean;
}

export type CrawlRequest = { kind: 'crawl:start'; tabId: number; force?: boolean };
export type CrawlProgress = { kind: 'crawl:progress'; done: number; total: number };
export type CrawlComplete = { kind: 'crawl:complete'; corpus: PageCorpus };

// ---------------------------------------------------------------------------
// Link-extraction messages  (SW ↔ offscreen; not part of WidgetToSW)
// ---------------------------------------------------------------------------

export type ExtractLinksRequest = {
  kind: 'extract:links';
  html: string;
  baseUrl: string;
  correlationId: string;
};

export type ExtractLinksResult = {
  kind: 'extract:links:result';
  correlationId: string;
  links: string[];
};

export type SessionRequest = { kind: 'session:request'; voice?: string; instructions?: string };
export type SessionResponse =
  | { kind: 'session:response'; ok: true; clientSecret: string; expiresAt: number; webrtcUrl: string; model: string }
  | { kind: 'session:response'; ok: false; error: string };

export type WidgetToSW = ExtractRequest | CrawlRequest | SessionRequest;
export type SWToWidget = ExtractResponse | CrawlProgress | CrawlComplete | SessionResponse;
