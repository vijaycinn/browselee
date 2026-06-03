import { useState, useEffect, useCallback } from 'react';
import { useChannel } from './useChannel';
import type { PageCorpus, CrawlProgress, CrawlComplete } from '../../shared/messages';

export function useExtraction() {
  const { on, send } = useChannel();
  const [corpus, setCorpus] = useState<PageCorpus | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [isExtracting, setIsExtracting] = useState(true);

  useEffect(() => {
    const offProgress = on('crawl:progress', (msg) => {
      const p = msg as CrawlProgress;
      setProgress({ done: p.done, total: p.total });
    });
    const offComplete = on('crawl:complete', (msg) => {
      const c = msg as CrawlComplete;
      setCorpus(c.corpus);
      setIsExtracting(false);
      setProgress(null);
      const cp = c.corpus.currentPage;
      console.info(
        `[browselee/extract] corpus ready: current=${cp?.wordCount ?? 0}w/${cp?.content?.length ?? 0}ch, linked=${c.corpus.linkedPages.length}, total=${c.corpus.totalChars}ch, url=${cp?.url}`,
      );
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [on]);

  const refresh = useCallback(() => {
    setCorpus(null);
    setProgress(null);
    setIsExtracting(true);
    send({ kind: 'crawl:start', tabId: 0, force: true });
  }, [send]);

  return { corpus, progress, isExtracting, refresh };
}
