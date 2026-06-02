/**
 * Pure-function test for the HTML→Defuddle extraction path.
 * Runs in Node via `tsx --test` — no browser or Chrome APIs needed.
 *
 * Uses `defuddle/node` which accepts JSDOM instances directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';

// ---------------------------------------------------------------------------
// Helper: run the same extraction logic as offscreen.ts does in the browser
// ---------------------------------------------------------------------------
async function extractFromHtml(
  html: string,
  url: string,
): Promise<{ title: string; content: string; wordCount: number }> {
  // defuddle/node accepts a JSDOM window object directly
  const dom = new JSDOM(html, { url });
  const result = await Defuddle(dom.window as unknown as Document, url, {
    markdown: true,
  });

  const wordCount =
    typeof result.wordCount === 'number' && result.wordCount > 0
      ? result.wordCount
      : (result.content ?? '').trim().split(/\s+/).filter(Boolean).length;

  return { title: result.title ?? '', content: result.content ?? '', wordCount };
}

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

const SIMPLE_ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>How JavaScript Closures Work</title>
  <meta name="author" content="Jane Dev">
</head>
<body>
  <nav><a href="/">Home</a> | <a href="/blog">Blog</a></nav>
  <article>
    <h1>How JavaScript Closures Work</h1>
    <p>A closure is the combination of a function bundled together with references
    to its surrounding state, i.e. the lexical environment.</p>
    <p>In JavaScript, closures are created every time a function is created,
    at function creation time. They allow a function to access variables from
    an enclosing scope even after that scope has finished executing.</p>
    <p>This is one of the most powerful and frequently used concepts in JavaScript
    and is fundamental to understanding how callbacks, event handlers, and many
    design patterns work in practice.</p>
  </article>
  <footer>© 2024 Example Blog</footer>
</body>
</html>`;

const NOISY_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Understanding Async/Await in Node.js</title>
</head>
<body>
  <header>
    <nav id="main-nav">
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/tutorials">Tutorials</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  </header>
  <aside id="sidebar">
    <div class="ad">Advertisement: Buy our premium course!</div>
    <div class="related-posts">
      <h3>Related Posts</h3>
      <ul>
        <li><a href="/post1">Promises in depth</a></li>
        <li><a href="/post2">Event loop explained</a></li>
      </ul>
    </div>
  </aside>
  <main>
    <article id="main-content">
      <h1>Understanding Async/Await in Node.js</h1>
      <p>Async/await is syntactic sugar built on top of Promises that makes
      asynchronous code look and behave more like synchronous code. Introduced
      in ES2017, it dramatically simplifies the handling of asynchronous
      operations.</p>
      <p>The <code>async</code> keyword placed before a function declaration
      makes it return a Promise. The <code>await</code> keyword can only be
      used inside an async function and pauses execution until the Promise
      resolves or rejects.</p>
      <p>Error handling with async/await uses familiar try/catch blocks,
      making it much more readable compared to chaining <code>.catch()</code>
      handlers onto promise chains.</p>
    </article>
  </main>
  <footer>
    <div class="newsletter">Subscribe to our newsletter for weekly tips!</div>
    <div class="social">Follow us on Twitter | LinkedIn | GitHub</div>
  </footer>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('extracts title and content from a simple article', async () => {
  const { title, content, wordCount } = await extractFromHtml(
    SIMPLE_ARTICLE_HTML,
    'https://example.com/closures',
  );

  assert.ok(title.length > 0, `title should be non-empty, got: "${title}"`);
  assert.ok(
    title.toLowerCase().includes('closure') || title.toLowerCase().includes('javascript'),
    `title should mention closures/javascript, got: "${title}"`,
  );
  assert.ok(content.length > 0, 'content should be non-empty');
  assert.ok(wordCount > 0, `wordCount should be positive, got: ${wordCount}`);
});

test('extracts article content from noisy page with sidebar and nav', async () => {
  const { title, content, wordCount } = await extractFromHtml(
    NOISY_PAGE_HTML,
    'https://example.com/async-await',
  );

  assert.ok(title.length > 0, `title should be non-empty, got: "${title}"`);
  assert.ok(
    title.toLowerCase().includes('async') || title.toLowerCase().includes('node'),
    `title should mention async/node, got: "${title}"`,
  );
  assert.ok(content.length > 0, 'content should be non-empty');
  // Main article body should be present
  assert.ok(
    content.includes('async') || content.includes('await') || content.includes('Promise'),
    `content should include article text, got first 200 chars: "${content.slice(0, 200)}"`,
  );
  assert.ok(wordCount > 10, `wordCount should be > 10, got: ${wordCount}`);
});

test('defuddle export shape is correct', async () => {
  // Verifies the import resolves and the function signature is callable.
  assert.strictEqual(typeof Defuddle, 'function', 'Defuddle should be a function');
});
