/**
 * Tests for crawl.ts — canonicalUrl, extractLinks, fetchWithBudget, runCrawl.
 * Runs in Node via `tsx --test` with jsdom providing DOMParser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------
// Bootstrap browser globals needed by crawl.ts
// ---------------------------------------------------------------------------

const jsdom = new JSDOM('', { url: 'https://example.com' });

// DOMParser (used by extractLinks)
(global as Record<string, unknown>).DOMParser = jsdom.window.DOMParser;

// TextDecoder (used by fetchWithBudget) — available natively in Node 18+
// ReadableStream — available natively in Node 18+

// ---------------------------------------------------------------------------
// Import the module under test AFTER setting up globals
// ---------------------------------------------------------------------------

import {
  canonicalUrl,
  extractLinks,
  fetchWithBudget,
  runCrawl,
  DEFAULTS,
} from '../src/lib/crawl.ts';
import type { CrawlOptions, RunCrawlHooks } from '../src/lib/crawl.ts';
import type { ExtractedPage } from '../src/shared/messages.ts';

// ---------------------------------------------------------------------------
// canonicalUrl
// ---------------------------------------------------------------------------

test('canonicalUrl: strips fragment', () => {
  assert.equal(
    canonicalUrl('https://example.com/page#section'),
    'https://example.com/page',
  );
});

test('canonicalUrl: lowercases host', () => {
  assert.equal(
    canonicalUrl('https://EXAMPLE.COM/page'),
    'https://example.com/page',
  );
});

test('canonicalUrl: sorts query params', () => {
  assert.equal(
    canonicalUrl('https://example.com/search?z=3&a=1&m=2'),
    'https://example.com/search?a=1&m=2&z=3',
  );
});

test('canonicalUrl: drops default http port', () => {
  assert.equal(
    canonicalUrl('http://example.com:80/page'),
    'http://example.com/page',
  );
});

test('canonicalUrl: drops default https port', () => {
  assert.equal(
    canonicalUrl('https://example.com:443/page'),
    'https://example.com/page',
  );
});

test('canonicalUrl: preserves non-default port', () => {
  const url = 'https://example.com:8080/page';
  assert.equal(canonicalUrl(url), url);
});

test('canonicalUrl: strips fragment AND sorts params together', () => {
  assert.equal(
    canonicalUrl('https://example.com/?z=2&a=1#top'),
    'https://example.com/?a=1&z=2',
  );
});

// ---------------------------------------------------------------------------
// extractLinks
// ---------------------------------------------------------------------------

function buildHtmlWith20Links(base: string): string {
  const sameOrigin = new URL(base).origin;
  const links: string[] = [
    // 8 same-origin absolute
    `${sameOrigin}/page1`,
    `${sameOrigin}/page2`,
    `${sameOrigin}/page3`,
    `${sameOrigin}/page4`,
    `${sameOrigin}/page5`,
    `${sameOrigin}/page6`,
    `${sameOrigin}/page7`,
    `${sameOrigin}/page8`,
    // 3 relative
    '/relative1',
    '/relative2',
    '/relative3',
    // 2 cross-origin
    'https://other.com/a',
    'https://other.com/b',
    // 2 mailto / tel (skip)
    'mailto:user@example.com',
    'tel:+15550000000',
    // 1 fragment-only (skip)
    '#section',
    // 1 javascript (skip)
    'javascript:void(0)',
    // 1 duplicate of page1 (different form)
    `${sameOrigin}/page1?`,
    // 1 data: URI (skip)
    'data:text/plain,hello',
  ];

  const anchors = links.map((href, i) => `<a href="${href}">Link ${i}</a>`).join('\n');
  return `<!DOCTYPE html><html><body>${anchors}</body></html>`;
}

test('extractLinks: filters same-origin, skips bad schemes, dedupes, caps at maxPages', () => {
  const base = 'https://example.com/';
  const html = buildHtmlWith20Links(base);

  const opts: CrawlOptions = { ...DEFAULTS, maxPages: 8, sameOriginOnly: true };
  const links = extractLinks(html, base, opts);

  // Must be ≤ maxPages
  assert.ok(links.length <= opts.maxPages, `expected ≤${opts.maxPages}, got ${links.length}`);
  // All must be same-origin
  for (const link of links) {
    const origin = new URL(link).origin;
    assert.equal(origin, new URL(base).origin, `cross-origin link leaked: ${link}`);
  }
  // No mailto / tel / data / fragment
  for (const link of links) {
    assert.ok(!link.startsWith('mailto:'), `mailto: leaked: ${link}`);
    assert.ok(!link.startsWith('tel:'), `tel: leaked: ${link}`);
    assert.ok(!link.startsWith('data:'), `data: leaked: ${link}`);
    assert.ok(!link.startsWith('javascript:'), `javascript: leaked: ${link}`);
    assert.ok(!link.includes('#'), `fragment leaked: ${link}`);
  }
  // Deduped — no duplicates
  const unique = new Set(links);
  assert.equal(unique.size, links.length, 'duplicate links found');
});

test('extractLinks: cross-origin allowed when sameOriginOnly=false', () => {
  const base = 'https://example.com/';
  const html = buildHtmlWith20Links(base);
  const opts: CrawlOptions = { ...DEFAULTS, maxPages: 20, sameOriginOnly: false };
  const links = extractLinks(html, base, opts);
  const hasOther = links.some((l) => new URL(l).origin === 'https://other.com');
  assert.ok(hasOther, 'expected cross-origin links when sameOriginOnly=false');
});

test('extractLinks: resolves relative links against base', () => {
  const base = 'https://example.com/blog/post';
  const html = `<html><body><a href="/about">A</a><a href="next">B</a></body></html>`;
  const opts: CrawlOptions = { ...DEFAULTS, maxPages: 10, sameOriginOnly: true };
  const links = extractLinks(html, base, opts);
  assert.ok(links.includes('https://example.com/about'), 'absolute /about missing');
  assert.ok(
    links.includes('https://example.com/blog/next'),
    'relative next link missing',
  );
});

test('extractLinks: caps strictly at maxPages', () => {
  const origin = 'https://example.com';
  const anchors = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join('');
  const html = `<html><body>${anchors}</body></html>`;
  const opts: CrawlOptions = { ...DEFAULTS, maxPages: 5, sameOriginOnly: true };
  const links = extractLinks(html, `${origin}/`, opts);
  assert.equal(links.length, 5);
});

// ---------------------------------------------------------------------------
// fetchWithBudget
// ---------------------------------------------------------------------------

function makeMockFetch(
  body: string,
  contentType = 'text/html; charset=utf-8',
  status = 200,
) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  return async (_url: string, _init?: RequestInit): Promise<Response> =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? contentType : null,
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    }) as unknown as Response;
}

test('fetchWithBudget: returns body for text/html response', async () => {
  const body = '<html><body>Hello</body></html>';
  (global as Record<string, unknown>).fetch = makeMockFetch(body);

  const controller = new AbortController();
  const result = await fetchWithBudget('https://example.com/', DEFAULTS, controller.signal);
  assert.ok(result !== null);
  assert.ok(result!.includes('Hello'));
});

test('fetchWithBudget: returns null for non-HTML content-type', async () => {
  (global as Record<string, unknown>).fetch = makeMockFetch('{"json":true}', 'application/json');

  const controller = new AbortController();
  const result = await fetchWithBudget('https://example.com/api', DEFAULTS, controller.signal);
  assert.equal(result, null);
});

test('fetchWithBudget: truncates body exceeding maxBytes', async () => {
  const bigBody = 'x'.repeat(100);
  (global as Record<string, unknown>).fetch = makeMockFetch(bigBody);

  const opts: CrawlOptions = { ...DEFAULTS, maxBytes: 50 };
  const controller = new AbortController();
  const result = await fetchWithBudget('https://example.com/big', opts, controller.signal);
  assert.ok(result !== null);
  assert.ok(result!.length <= 50, `expected ≤50 chars, got ${result!.length}`);
});

test('fetchWithBudget: returns null for non-OK status', async () => {
  (global as Record<string, unknown>).fetch = makeMockFetch('Not Found', 'text/html', 404);

  const controller = new AbortController();
  const result = await fetchWithBudget('https://example.com/missing', DEFAULTS, controller.signal);
  assert.equal(result, null);
});

test('fetchWithBudget: returns null when aborted', async () => {
  (global as Record<string, unknown>).fetch = async () => {
    await new Promise((_, reject) =>
      setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 10),
    );
    return {} as Response;
  };

  const controller = new AbortController();
  controller.abort();
  const result = await fetchWithBudget('https://example.com/', DEFAULTS, controller.signal);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// runCrawl (integration, mocked hooks + fetch)
// ---------------------------------------------------------------------------

function makePage(url: string, content = 'page content'): ExtractedPage {
  return { url, title: `Title ${url}`, content, wordCount: 2 };
}

const LINKED_URLS = [
  'https://example.com/a',
  'https://example.com/b',
  'https://example.com/c',
];

function makeHooks(overrides: Partial<RunCrawlHooks> = {}): RunCrawlHooks & {
  progressCalls: Array<[number, number]>;
} {
  const progressCalls: Array<[number, number]> = [];
  return {
    extractFromHtml: async (html, url) => makePage(url),
    getLinks: async () => LINKED_URLS,
    onProgress: (done, total) => progressCalls.push([done, total]),
    ...overrides,
    progressCalls,
  };
}

before(() => {
  // Default fetch mock: 404 for robots.txt, valid HTML for everything else
  setDefaultFetch();
});

function setDefaultFetch() {
  (global as Record<string, unknown>).fetch = async (url: string) => {
    if ((url as string).endsWith('/robots.txt')) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
      } as unknown as Response;
    }
    const body = `<html><body>Content for ${url}</body></html>`;
    return makeMockFetch(body)(url);
  };
}

test('runCrawl: returns corpus with currentPage and linkedPages', async () => {
  setDefaultFetch();
  const hooks = makeHooks();
  const corpus = await runCrawl(
    '<html><body>Main page</body></html>',
    'https://example.com/',
    DEFAULTS,
    hooks,
  );

  assert.ok(corpus.currentPage, 'missing currentPage');
  assert.equal(corpus.currentPage.url, 'https://example.com/');
  assert.equal(corpus.linkedPages.length, LINKED_URLS.length);
});

test('runCrawl: progress hook called once per linked page + initial', async () => {
  setDefaultFetch();
  const hooks = makeHooks();
  await runCrawl(
    '<html><body>Main page</body></html>',
    'https://example.com/',
    DEFAULTS,
    hooks,
  );

  // Should have: 1 initial (0/N) + N completions
  assert.equal(hooks.progressCalls.length, LINKED_URLS.length + 1);
  // First call: done=0
  assert.deepEqual(hooks.progressCalls[0], [0, LINKED_URLS.length]);
  // Last call: done=total
  assert.deepEqual(hooks.progressCalls[hooks.progressCalls.length - 1], [
    LINKED_URLS.length,
    LINKED_URLS.length,
  ]);
});

test('runCrawl: truncated flag set when content exceeds PER_PAGE_CHAR_LIMIT', async () => {
  setDefaultFetch();
  const longContent = 'x'.repeat(15_000); // exceeds 12k per-page limit
  const hooks = makeHooks({
    extractFromHtml: async (html, url) => makePage(url, longContent),
  });

  const corpus = await runCrawl(
    '<html><body>Main page</body></html>',
    'https://example.com/',
    DEFAULTS,
    hooks,
  );

  assert.ok(corpus.truncated, 'expected truncated=true');
  // Each page content should be capped
  assert.ok(corpus.currentPage.content.length <= 12_000);
  for (const page of corpus.linkedPages) {
    assert.ok(page.content.length <= 12_000, `page ${page.url} content too long`);
  }
});

test('runCrawl: totalChars reflects actual corpus size', async () => {
  setDefaultFetch();
  const hooks = makeHooks();
  const corpus = await runCrawl(
    '<html><body>Main page</body></html>',
    'https://example.com/',
    DEFAULTS,
    hooks,
  );

  const expected =
    corpus.currentPage.content.length +
    corpus.linkedPages.reduce((s, p) => s + p.content.length, 0);
  assert.equal(corpus.totalChars, expected);
});

test('runCrawl: respects maxPages — no more than maxPages-1 linked pages', async () => {
  setDefaultFetch();
  const manyLinks = Array.from({ length: 20 }, (_, i) => `https://example.com/p${i}`);
  const opts: CrawlOptions = { ...DEFAULTS, maxPages: 4 };
  const hooks = makeHooks({ getLinks: async () => manyLinks });

  const corpus = await runCrawl(
    '<html><body>Main page</body></html>',
    'https://example.com/',
    opts,
    hooks,
  );

  assert.ok(
    corpus.linkedPages.length <= opts.maxPages - 1,
    `expected ≤${opts.maxPages - 1} linked pages, got ${corpus.linkedPages.length}`,
  );
});
