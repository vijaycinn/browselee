import type { PageCorpus } from '../../shared/messages';

const MAX_CHARS = 120_000; // ≈ 30,000 tokens
const TRUNCATION_MARKER = '…[truncated]';

const PREAMBLE =
  "You are a helpful assistant grounded in the contents of the user's current webpage. " +
  'Answer concisely based on this page and its linked content.\n\n';

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
  const userBlock = userInstructions ? `\n---\nAdditional instructions: ${userInstructions}` : '';

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
