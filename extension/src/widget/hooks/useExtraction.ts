import { useState, useEffect } from 'react';
import { useChannel } from './useChannel';
import type { PageCorpus, CrawlProgress, CrawlComplete } from '../../shared/messages';

export function useExtraction() {
  const { on } = useChannel();
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
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [on]);

  return { corpus, progress, isExtracting };
}
