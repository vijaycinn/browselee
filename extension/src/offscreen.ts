// Offscreen document: parses HTML with DOMParser and runs Defuddle extraction.
import Defuddle from 'defuddle';
import type {
  ExtractRequest,
  ExtractResponse,
  ExtractedPage,
  ExtractLinksRequest,
  PageTheme,
  SiteType,
} from './shared/messages';
import { extractLinks, DEFAULTS } from './lib/crawl';

// ─────────────────────────────────────────────────────────────────────────────
// Page-theme extraction
// Deterministic; no network calls; no LLM. Goal: give the model a "frame"
// so it reasons about the page topic instead of literal phrase matching.
// ─────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you',
  'are', 'was', 'were', 'has', 'have', 'had', 'will', 'can', 'our', 'their',
  'them', 'they', 'his', 'her', 'its', 'about', 'over', 'under', 'than',
  'then', 'there', 'here', 'when', 'what', 'which', 'who', 'whom', 'how',
  'why', 'all', 'any', 'some', 'more', 'most', 'less', 'least', 'just',
  'only', 'also', 'such', 'these', 'those', 'page', 'home', 'menu', 'login',
  'log', 'sign', 'search', 'site', 'site\u2019s', 'sites', 'view', 'click',
  'link', 'links', 'read', 'main', 'content', 'skip', 'navigation',
]);

function stripSiteSuffix(title: string, siteName: string): string {
  if (!title) return '';
  const cleaned = title.replace(/\s+/g, ' ').trim();
  if (!siteName) return cleaned;
  // Strip trailing " | SiteName" / " - SiteName" / " — SiteName"
  const sn = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.replace(new RegExp(`\\s*[|\\-\u2013\u2014]\\s*${sn}\\s*$`, 'i'), '').trim();
}

function getMeta(doc: Document, ...names: string[]): string {
  for (const name of names) {
    const sel = name.startsWith('og:') || name.startsWith('twitter:')
      ? `meta[property="${name}"], meta[name="${name}"]`
      : `meta[name="${name}"]`;
    const el = doc.querySelector(sel);
    const content = el?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return '';
}

function readJsonLd(doc: Document): unknown[] {
  const out: unknown[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    const txt = s.textContent?.trim();
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch { /* ignore malformed JSON-LD */ }
  }
  return out;
}

function jsonLdTypes(jsonLd: unknown[]): string[] {
  const types: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') types.push(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') types.push(x);
    const graph = obj['@graph'];
    if (Array.isArray(graph)) for (const g of graph) visit(g);
  };
  for (const n of jsonLd) visit(n);
  return types;
}

const JSONLD_TYPE_MAP: Array<[RegExp, SiteType]> = [
  [/^GovernmentOrganization|GovernmentService|CivicStructure$/i, 'government'],
  [/^(NewsArticle|NewsMediaOrganization|ReportageNewsArticle|LiveBlogPosting)$/i, 'news'],
  [/^(Product|Offer|AggregateOffer|ProductGroup|Store)$/i, 'ecommerce'],
  [/^(TechArticle|APIReference|HowTo|Code)$/i, 'docs'],
  [/^BlogPosting$/i, 'blog'],
  [/^(DiscussionForumPosting|QAPage|Question)$/i, 'forum'],
];

function siteTypeFromHostname(hostname: string): SiteType {
  const h = hostname.toLowerCase();
  if (h.endsWith('.gov') || h.endsWith('.mil') || /\.gov\.[a-z]{2}$/.test(h)) return 'government';
  if (/(news|times|post|tribune|herald|gazette|reuters|bloomberg|cnn|bbc|guardian|zerohedge)/.test(h)) return 'news';
  if (/(shop|store|cart|amazon|ebay|etsy)/.test(h)) return 'ecommerce';
  if (/(docs?\.|developer\.|learn\.|api\.|reference\.)/.test(h)) return 'docs';
  if (/(blog\.|medium\.com|substack\.com|wordpress)/.test(h)) return 'blog';
  if (/(forum|reddit|stackoverflow|stackexchange|community\.)/.test(h)) return 'forum';
  return 'generic';
}

function detectSiteType(doc: Document, hostname: string, jsonLd: unknown[]): SiteType {
  // 1) JSON-LD wins when present
  const types = jsonLdTypes(jsonLd);
  for (const t of types) {
    for (const [re, st] of JSONLD_TYPE_MAP) {
      if (re.test(t)) return st;
    }
  }
  // 2) og:type fallback for news
  const ogType = getMeta(doc, 'og:type').toLowerCase();
  if (ogType === 'article' && doc.querySelectorAll('article').length >= 2) return 'news';
  // 3) hostname heuristic
  return siteTypeFromHostname(hostname);
}

function extractBreadcrumbs(doc: Document, jsonLd: unknown[], urlPathTokens: string[]): string[] {
  // 1) JSON-LD BreadcrumbList
  for (const node of jsonLd) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    const isBc = t === 'BreadcrumbList' || (Array.isArray(t) && t.includes('BreadcrumbList'));
    if (!isBc) continue;
    const items = obj['itemListElement'];
    if (!Array.isArray(items)) continue;
    const names: string[] = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const i = it as Record<string, unknown>;
      const name = typeof i['name'] === 'string'
        ? i['name']
        : (i['item'] && typeof (i['item'] as Record<string, unknown>)['name'] === 'string'
            ? (i['item'] as Record<string, string>)['name']
            : '');
      if (name) names.push(name.trim());
    }
    if (names.length > 0) return names.slice(0, 8);
  }
  // 2) DOM nav[aria-label*=breadcrumb]
  const nav = doc.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i]');
  if (nav) {
    const items = Array.from(nav.querySelectorAll('a, li'))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0 && t.length < 80);
    const dedup = Array.from(new Set(items));
    if (dedup.length > 0) return dedup.slice(0, 8);
  }
  // 3) URL slug fallback
  return urlPathTokens
    .map((t) => t.replace(/[-_]+/g, ' ').trim())
    .filter((t) => t.length > 1 && t.length < 60)
    .slice(0, 6);
}

function extractTopics(parts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of parts) {
    if (!raw) continue;
    const tokens = raw.toLowerCase().match(/[a-z][a-z0-9'\-]{2,}/g) ?? [];
    for (const tok of tokens) {
      if (STOPWORDS.has(tok)) continue;
      if (tok.length < 4) continue;
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  // Sort by frequency desc, then alphabetical for stability
  const sorted = Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  return sorted.slice(0, 8);
}

function urlPathTokens(url: string): string[] {
  try {
    const u = new URL(url);
    return u.pathname
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^\d+$/.test(s) && !/\.[a-z]{2,5}$/i.test(s));
  } catch {
    return [];
  }
}

export function extractPageTheme(doc: Document, url: string): PageTheme {
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { /* noop */ }

  const jsonLd = readJsonLd(doc);
  const siteType = detectSiteType(doc, hostname, jsonLd);

  const siteName = getMeta(doc, 'og:site_name', 'application-name') || hostname;
  const rawTitle = (doc.querySelector('title')?.textContent ?? '').trim();
  const pageTitle = stripSiteSuffix(rawTitle, siteName) || rawTitle;
  const h1 = (doc.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const description = getMeta(doc, 'description', 'og:description', 'twitter:description');

  const pathTokens = urlPathTokens(url);
  const breadcrumbs = extractBreadcrumbs(doc, jsonLd, pathTokens);

  // Topic source: h1 + first 8 h2s + description + breadcrumbs + path slug words
  const h2s = Array.from(doc.querySelectorAll('h2'))
    .slice(0, 8)
    .map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const topics = extractTopics([
    h1,
    ...h2s,
    description,
    breadcrumbs.join(' '),
    pathTokens.join(' ').replace(/[-_]+/g, ' '),
  ]);

  return {
    siteType,
    siteName,
    pageTitle,
    h1,
    description,
    breadcrumbs,
    topics,
    urlPathTokens: pathTokens,
    url,
  };
}


chrome.runtime.onMessage.addListener((msg: ExtractRequest | ExtractLinksRequest, _sender, _sendResponse) => {
  // ── extract:links — parse HTML with DOMParser and return anchor hrefs ──
  if (msg.kind === 'extract:links') {
    const { html, baseUrl, correlationId } = msg;
    const links = extractLinks(html, baseUrl, DEFAULTS);
    chrome.runtime
      .sendMessage({ kind: 'extract:links:result', correlationId, links })
      .catch((err: unknown) => console.error('[offscreen] failed to send links result:', err));
    return false;
  }

  if (msg.kind !== 'extract:current-page' && msg.kind !== 'extract:from-html') return false;

  const { html, url, correlationId, innerText } = msg;

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

      // Always harvest visible headlines (h1/h2/h3) + their nearest anchor.
      // Index/homepages have no article body so Defuddle returns thin/random content;
      // headlines give the model real signal.
      const headlines: string[] = [];
      const seen = new Set<string>();
      for (const h of Array.from(doc.querySelectorAll('h1, h2, h3'))) {
        const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 4 || text.length > 300) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        const anchor = h.querySelector('a[href]') ?? h.closest('a[href]');
        let href = anchor?.getAttribute('href') ?? '';
        if (href) {
          try { href = new URL(href, url).toString(); } catch { /* ignore */ }
        }
        headlines.push(href ? `- ${text} (${href})` : `- ${text}`);
        if (headlines.length >= 60) break;
      }

      const baseContent = result.content ?? '';
      const headlineBlock =
        headlines.length > 0
          ? `\n\n## HEADLINES ON THIS PAGE\n${headlines.join('\n')}\n`
          : '';

      // Fallback: when Defuddle + headlines yield thin content (< 200 chars),
      // use innerText from the live page (captures JS-rendered content on SPAs).
      // Also scan broader DOM selectors for link/card text if innerText is unavailable.
      let content = baseContent + headlineBlock;
      const THIN_THRESHOLD = 200;

      if (content.length < THIN_THRESHOLD) {
        let fallbackText = '';
        if (innerText && innerText.length > content.length) {
          fallbackText = innerText;
        } else {
          // Broader DOM text extraction: grab all visible text from links, 
          // paragraphs, list items, headings, and labelled elements
          const selectors = 'a, p, li, h1, h2, h3, h4, h5, h6, [role="heading"], span, td, th, figcaption, label, dt, dd';
          const nodes = doc.querySelectorAll(selectors);
          const textSet = new Set<string>();
          const parts: string[] = [];
          for (const el of Array.from(nodes)) {
            const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (t.length >= 4 && t.length <= 500 && !textSet.has(t)) {
              textSet.add(t);
              parts.push(t);
              if (parts.join('\n').length > 12000) break; // respect per-page budget
            }
          }
          fallbackText = parts.join('\n');
        }

        if (fallbackText.length > content.length) {
          // Truncate innerText to per-page limit and format as plaintext markdown
          const trimmed = fallbackText.slice(0, 12000);
          content = `## Page Content (visible text)\n\n${trimmed}`;
          if (headlineBlock) {
            content += headlineBlock;
          }
          console.info(`[browselee/offscreen] thin extraction fallback used: ${content.length} chars from innerText/DOM`);
        }
      }

      const wordCount =
        typeof result.wordCount === 'number' && result.wordCount > 0
          ? result.wordCount + headlines.length * 5
          : content.trim().split(/\s+/).filter(Boolean).length;

      // Theme metadata is deterministic and cheap to compute, so include it
      // for all extractions. The widget uses currentPage.theme for the header
      // and context framing; linked-page theme data is harmless extra signal.
      const theme = extractPageTheme(doc, url);

      const page: ExtractedPage = {
        url,
        title: result.title ?? '',
        byline: result.author || undefined,
        author: result.author || undefined,
        published: result.published || undefined,
        content,
        wordCount,
        theme,
      };

      const themeTag = theme
        ? `${theme.siteType}:${(theme.pageTitle || theme.h1 || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`
        : 'none';
      console.info(
        `[browselee/offscreen] extracted url=${url} title="${page.title}" theme=${themeTag} articleChars=${baseContent.length} headlines=${headlines.length} totalChars=${content.length}`,
      );

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
