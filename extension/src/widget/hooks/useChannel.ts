import { useEffect, useRef, useCallback } from 'react';
import type { WidgetToSW, SWToWidget } from '../../shared/messages';

type Handler = (msg: SWToWidget) => void;

export function useChannel() {
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map());

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const msg = event.data as SWToWidget | undefined;
      if (!msg || typeof msg.kind !== 'string') return;
      const handlers = handlersRef.current.get(msg.kind);
      handlers?.forEach(h => h(msg));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const send = useCallback((msg: WidgetToSW) => {
    window.parent.postMessage(msg, '*');
  }, []);

  const on = useCallback((kind: string, handler: Handler) => {
    let set = handlersRef.current.get(kind);
    if (!set) {
      set = new Set();
      handlersRef.current.set(kind, set);
    }
    set.add(handler);
    return () => {
      handlersRef.current.get(kind)?.delete(handler);
    };
  }, []);

  return { send, on };
}
