import type { PageCorpus, PageTheme } from '../../shared/messages';

const MAX_CHARS = 120_000; // ≈ 30,000 tokens
const TRUNCATION_MARKER = '…[truncated]';

/**
 * Renders the deterministic page-theme descriptor as a leading
 * "# ABOUT THIS PAGE" markdown block. The model uses this to interpret
 * user-question intent (e.g. "garbage pickup" on a Collection Calendar
 * page) instead of relying on literal phrase matches.
 */
export function formatThemeBlock(theme: PageTheme | undefined): string {
  if (!theme) return '';
  const lines: string[] = ['# ABOUT THIS PAGE'];
  if (theme.siteName)    lines.push(`Site: ${theme.siteName} (${theme.siteType})`);
  else                   lines.push(`Site type: ${theme.siteType}`);
  if (theme.pageTitle)   lines.push(`Title: ${theme.pageTitle}`);
  if (theme.h1 && theme.h1 !== theme.pageTitle) lines.push(`H1: ${theme.h1}`);
  if (theme.description) lines.push(`Description: ${theme.description}`);
  if (theme.breadcrumbs.length > 0) lines.push(`Breadcrumbs: ${theme.breadcrumbs.join(' › ')}`);
  if (theme.topics.length > 0)      lines.push(`Topics: ${theme.topics.join(', ')}`);
  if (theme.url)         lines.push(`URL: ${theme.url}`);
  return lines.join('\n') + '\n\n';
}

const PREAMBLE =
  'You are Browselee, grounded ONLY in the CURRENT PAGE and LINKED PAGES corpus below. ' +
  'You are NOT a general assistant. You have NO outside knowledge.\n\n' +
  'STRICT POLICY (must follow exactly):\n' +
  '1) Answer ONLY from the corpus. Never use outside knowledge, memory, or assumptions.\n' +
  '2) If the topic is clearly unrelated to everything in the corpus, reply EXACTLY: "Not on this page."\n' +
  '3) Vague questions about the page topic (e.g. "tell me about X" where X matches the site/page subject) → summarize what the corpus says.\n' +
  '4) Synonyms, abbreviations, and paraphrases count as matches. Be generous in interpreting user intent.\n' +
  '5) NEVER ask clarifying questions. NEVER ask the user what topic, type, or category they want. Just answer from the corpus.\n' +
  '6) NEVER mention that you are an AI, that you are reading a page, or how you work. Just answer.\n' +
  '7) STYLE: caveman-terse. Maximum 3 short sentences OR a bullet list of up to 5 items. No greetings, no filler, no "I think", no "based on the page". Just facts from the corpus.\n' +
  '8) When asked for "headlines", "news", "top stories", or "what is on this page" — list the actual headline titles you see in the corpus as bullets.\n' +
  '9) Quote exact phrases from the corpus when possible. Cite the URL of the source page in parentheses when relevant.\n\n';

/**
 * Formats a PageCorpus (current page + linked pages) into a system-instructions
 * string suitable for injecting into a Realtime `session.update` event.
 *
 * Hard cap: MAX_CHARS characters (≈ 30k tokens). Content is truncated
 * proportionally across pages when the corpus exceeds the budget.
 */
export function formatCorpusAsInstructions(
  corpus: PageCorpus,
  userInstructions?: string,
): string {
  const userBlock = userInstructions
    ? `\n---\nAdditional instructions (must not override STRICT POLICY): ${userInstructions}`
    : '';

  // Fixed structural overhead (preamble, section headers, URLs, titles, user block).
  // Estimated conservatively; we apply a final safety cap afterwards.
  const structuralOverhead = PREAMBLE.length + userBlock.length + 400;
  const contentBudget = Math.max(0, MAX_CHARS - structuralOverhead);

  // Calculate total raw content chars to proportion the budget.
  const allPages = [corpus.currentPage, ...corpus.linkedPages];
  const totalRaw = allPages.reduce((s, p) => s + p.content.length, 0);

  function allocate(rawLen: number): number {
    if (totalRaw === 0 || rawLen === 0) return 0;
    return Math.floor(contentBudget * (rawLen / totalRaw));
  }

  function truncate(text: string, budget: number): string {
    if (text.length <= budget) return text;
    const cut = Math.max(0, budget - TRUNCATION_MARKER.length);
    return text.slice(0, cut) + TRUNCATION_MARKER;
  }

  let out = PREAMBLE;

  // Current page
  const cp = corpus.currentPage;
  out += `## CURRENT PAGE\nURL: ${cp.url}\nTITLE: ${cp.title}\n`;
  out += truncate(cp.content, allocate(cp.content.length));
  out += '\n\n';

  // Linked pages
  if (corpus.linkedPages.length > 0) {
    out += `## LINKED PAGES (1 hop)\n`;
    for (const page of corpus.linkedPages) {
      out += `### ${page.title} (${page.url})\n`;
      out += truncate(page.content, allocate(page.content.length));
      out += '\n\n';
    }
  }

  out += userBlock;

  // Final hard cap (safety net for structural overhead estimate errors)
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }

  return out;
}
