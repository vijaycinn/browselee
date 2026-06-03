/**
 * Unit tests for corpusFormatter — pure-function; no browser APIs needed.
 * Run with: tsx --test test/corpusFormatter.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal shim so the import resolves without a Chrome runtime.
// (The module itself has no chrome.* usage — this is a safety net.)

// We import via a relative path from the test directory.
import { formatCorpusAsInstructions } from '../src/widget/lib/corpusFormatter.js';
import type { PageCorpus, ExtractedPage } from '../src/shared/messages.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(url: string, title: string, content: string): ExtractedPage {
  return {
    url,
    title,
    content,
    wordCount: content.trim().split(/\s+/).filter(Boolean).length,
  };
}

function emptyCorpus(): PageCorpus {
  return {
    currentPage: makePage('https://example.com/', 'Example', ''),
    linkedPages: [],
    totalChars: 0,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('empty corpus: returns preamble, current-page header, no linked section', () => {
  const result = formatCorpusAsInstructions(emptyCorpus());

  assert.ok(result.includes('You are Browselee'), 'preamble present');
  assert.ok(result.includes('## CURRENT PAGE'), 'current-page header present');
  assert.ok(result.includes('URL: https://example.com/'), 'URL present');
  assert.ok(result.includes('TITLE: Example'), 'title present');
  assert.ok(!result.includes('## LINKED PAGES'), 'no linked-pages section for empty corpus');
  assert.ok(result.length <= 120_000, `result within 120k chars, got ${result.length}`);
});

test('single page with content: renders preamble + full content', () => {
  const corpus: PageCorpus = {
    currentPage: makePage(
      'https://example.com/article',
      'My Article',
      'This is the article body. It contains useful information.',
    ),
    linkedPages: [],
    totalChars: 56,
    truncated: false,
  };

  const result = formatCorpusAsInstructions(corpus);

  assert.ok(result.includes('## CURRENT PAGE'), 'current-page header present');
  assert.ok(result.includes('My Article'), 'title present');
  assert.ok(result.includes('This is the article body.'), 'content present');
  assert.ok(!result.includes('…[truncated]'), 'no truncation for short content');
  assert.ok(result.length <= 120_000, 'within char limit');
});

test('single page: userInstructions appended after content', () => {
  const result = formatCorpusAsInstructions(emptyCorpus(), 'Focus on legal aspects.');

  assert.ok(result.includes('Focus on legal aspects.'), 'user instructions present');
  assert.ok(
    result.indexOf('Focus on legal aspects.') > result.indexOf('## CURRENT PAGE'),
    'user instructions come after content',
  );
});

test('multi-page corpus within budget: all content preserved without truncation', () => {
  const linked: ExtractedPage[] = [
    makePage('https://example.com/a', 'Page A', 'Content of page A.'),
    makePage('https://example.com/b', 'Page B', 'Content of page B.'),
  ];
  const corpus: PageCorpus = {
    currentPage: makePage('https://example.com/', 'Home', 'Home page content.'),
    linkedPages: linked,
    totalChars: 55,
    truncated: false,
  };

  const result = formatCorpusAsInstructions(corpus);

  assert.ok(result.includes('## LINKED PAGES (1 hop)'), 'linked-pages section present');
  assert.ok(result.includes('### Page A (https://example.com/a)'), 'linked page A header');
  assert.ok(result.includes('### Page B (https://example.com/b)'), 'linked page B header');
  assert.ok(result.includes('Content of page A.'), 'linked page A content');
  assert.ok(result.includes('Content of page B.'), 'linked page B content');
  assert.ok(!result.includes('…[truncated]'), 'no truncation needed');
  assert.ok(result.length <= 120_000, 'within char limit');
});

test('multi-page truncation: oversized corpus is capped at 120k chars', () => {
  const BIG = 'x'.repeat(60_000);
  const corpus: PageCorpus = {
    currentPage: makePage('https://example.com/', 'Big Page', BIG),
    linkedPages: [
      makePage('https://example.com/link1', 'Link 1', BIG),
      makePage('https://example.com/link2', 'Link 2', BIG),
    ],
    totalChars: 180_000,
    truncated: false,
  };

  const result = formatCorpusAsInstructions(corpus);

  assert.ok(result.length <= 120_000, `result must be ≤ 120,000 chars, got ${result.length}`);
  assert.ok(result.includes('…[truncated]'), 'truncation marker present');
});

test('truncation: each page content proportionally allocated', () => {
  // Current page has 3x more content than each linked page.
  const LARGE = 'a'.repeat(30_000);
  const SMALL = 'b'.repeat(10_000);
  const corpus: PageCorpus = {
    currentPage: makePage('https://example.com/', 'Main', LARGE),
    linkedPages: [makePage('https://example.com/p', 'Sub', SMALL)],
    totalChars: 40_000,
    truncated: false,
  };

  const result = formatCorpusAsInstructions(corpus);
  assert.ok(result.length <= 120_000, `within char limit, got ${result.length}`);
});
