/**
 * Pure-ish crawl library: link extraction, fetch budgeting, concurrency, corpus assembly.
 * - extractLinks runs inside an offscreen / browser context (needs DOMParser).
 * - fetchWithBudget, canonicalUrl, runCrawl run in the SW context (no DOM needed).
 */
import type { ExtractedPage, PageCorpus } from '../shared/messages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlOptions {
  maxPages: number;
  concurrency: number;
  timeoutMs: number;
  maxBytes: number;
  sameOriginOnly: boolean;
}

export const DEFAULTS: CrawlOptions = {
  maxPages: 8,
  concurrency: 4,
  timeoutMs: 5_000,
  maxBytes: 3 * 1024 * 1024,
  sameOriginOnly: true,
};

export interface RunCrawlHooks {
  extractFromHtml(html: string, url: string): Promise<ExtractedPage>;
  /** Resolve links from the current-page HTML (runs in offscreen / test context). */
  getLinks(html: string, baseUrl: string): Promise<string[]>;
  onProgress(done: number, total: number): void;
}

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

const PER_PAGE_CHAR_LIMIT = 12_000; // ≈3k tokens per linked page
const TOTAL_CHAR_LIMIT = 120_000;   // ≈30k tokens total corpus

// ---------------------------------------------------------------------------
// canonicalUrl
// ---------------------------------------------------------------------------

const SKIP_SCHEMES = ['mailto:', 'tel:', 'javascript:', 'data:'];

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// extractLinks  (requires DOMParser — call from offscreen or jsdom context)
// ---------------------------------------------------------------------------

export function extractLinks(html: string, baseUrl: string, opts: CrawlOptions): string[] {
  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const selfCanonical = canonicalUrl(baseUrl);
  const seen = new Set<string>([selfCanonical]);
  const links: string[] = [];

  for (const el of Array.from(doc.querySelectorAll('a[href]'))) {
    if (links.length >= opts.maxPages) break;

    const href = (el.getAttribute('href') ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    if (SKIP_SCHEMES.some((s) => href.toLowerCase().startsWith(s))) continue;

    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    if (opts.sameOriginOnly) {
      try {
        if (new URL(resolved).origin !== baseOrigin) continue;
      } catch {
        continue;
      }
    }

    const canonical = canonicalUrl(resolved);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    links.push(canonical);
  }

  return links;
}

// ---------------------------------------------------------------------------
// fetchWithBudget
// ---------------------------------------------------------------------------

export async function fetchWithBudget(
  url: string,
  opts: CrawlOptions,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal });

    if (!resp.ok) {
      console.warn(`[crawl] non-OK ${resp.status} for ${url}`);
      return null;
    }

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      console.log(`[crawl] skipping non-HTML ${url} (${contentType})`);
      return null;
    }

    if (!resp.body) {
      console.warn(`[crawl] no response body for ${url}`);
      return null;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const chunks: string[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > opts.maxBytes) {
            const overflow = totalBytes - opts.maxBytes;
            const allowed = value.subarray(0, value.byteLength - overflow);
            chunks.push(decoder.decode(allowed, { stream: true }));
            console.log(`[crawl] capped response at ${opts.maxBytes}B for ${url}`);
            break;
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Flush decoder
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[crawl] fetchWithBudget error for ${url}: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: simple promise-pool concurrency limiter
// ---------------------------------------------------------------------------

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// ---------------------------------------------------------------------------
// Internal: robots.txt best-effort check
// ---------------------------------------------------------------------------

async function isDisallowedByRobots(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const resp = await fetch(`${origin}/robots.txt`, { signal: controller.signal });
    if (!resp.ok) return false;
    const text = await resp.text();

    let inUserAgentAll = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim().toLowerCase();
      if (line.startsWith('user-agent:')) {
        inUserAgentAll = line.slice('user-agent:'.length).trim() === '*';
      } else if (inUserAgentAll && line.startsWith('disallow:')) {
        if (line.slice('disallow:'.length).trim() === '/') return true;
      }
    }
    return false;
  } catch {
    return false; // best-effort: ignore errors
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// runCrawl
// ---------------------------------------------------------------------------

export async function runCrawl(
  currentPageHtml: string,
  currentPageUrl: string,
  opts: CrawlOptions,
  hooks: RunCrawlHooks,
): Promise<PageCorpus> {
  let truncated = false;

  // 1. Extract + truncate current page
  const currentPage = await hooks.extractFromHtml(currentPageHtml, currentPageUrl);
  if (currentPage.content.length > PER_PAGE_CHAR_LIMIT) {
    currentPage.content = currentPage.content.slice(0, PER_PAGE_CHAR_LIMIT);
    truncated = true;
  }

  // 2. Get links (up to maxPages–1 slots for linked pages)
  const rawLinks = await hooks.getLinks(currentPageHtml, currentPageUrl);
  let linksToFetch = rawLinks.slice(0, opts.maxPages - 1);

  // 3. Robots.txt best-effort
  if (linksToFetch.length > 0) {
    try {
      const origin = new URL(currentPageUrl).origin;
      if (await isDisallowedByRobots(origin)) {
        console.log(`[crawl] robots.txt disallows all crawling for ${origin}`);
        linksToFetch = [];
      }
    } catch (err) {
      console.warn('[crawl] robots check error (ignoring):', err);
    }
  }

  const total = linksToFetch.length;
  let done = 0;
  hooks.onProgress(done, total);

  // 4. Fetch + extract linked pages with concurrency limit
  const linkedPages: ExtractedPage[] = [];

  await runConcurrently(linksToFetch, opts.concurrency, async (url) => {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const html = await fetchWithBudget(url, opts, controller.signal);
      if (html) {
        const page = await hooks.extractFromHtml(html, url);
        if (page.content.length > PER_PAGE_CHAR_LIMIT) {
          page.content = page.content.slice(0, PER_PAGE_CHAR_LIMIT);
          truncated = true;
        }
        linkedPages.push(page);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[crawl] error processing linked page ${url}: ${msg}`);
    } finally {
      clearTimeout(timerId);
      done++;
      hooks.onProgress(done, total);
    }
  });

  // 5. Apply total budget, truncating excess
  let totalChars = currentPage.content.length;
  const finalLinkedPages: ExtractedPage[] = [];

  for (const page of linkedPages) {
    const remaining = TOTAL_CHAR_LIMIT - totalChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (page.content.length > remaining) {
      page.content = page.content.slice(0, remaining);
      truncated = true;
    }
    finalLinkedPages.push(page);
    totalChars += page.content.length;
  }

  return { currentPage, linkedPages: finalLinkedPages, totalChars, truncated };
}
