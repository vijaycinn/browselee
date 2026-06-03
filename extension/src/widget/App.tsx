import { useState, useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { useExtraction } from './hooks/useExtraction';
import { loadSettings, saveSettings } from './lib/settings';
import type { Settings } from './lib/settings';
import type { PageCorpus } from '../shared/messages';
import { formatThemeBlock } from './lib/corpusFormatter';

const CHAT_CONTEXT_BUDGET = 55_000;

/**
 * Build a lean RAG context for the backend `/api/chat` SSE path.
 * Backend already injects STRICT_GROUNDING_POLICY, so we send only structured
 * page content. Headlines surface FIRST so index/feed pages don't get
 * dominated by sidebar junk that Defuddle picked as "main article".
 */
function buildChatContext(corpus: PageCorpus): string {
  const parts: string[] = [];
  const cp = corpus.currentPage;

  // Lead with the deterministic theme descriptor so the model frames the
  // page topic before reading the body. Empty when no theme is attached.
  const themeBlock = formatThemeBlock(cp.theme);
  if (themeBlock) parts.push(themeBlock.trimEnd() + '\n');

  parts.push(`# CURRENT PAGE\nURL: ${cp.url}\nTITLE: ${cp.title}\n`);

  // Pull the HEADLINES block (appended by offscreen.ts) out of content and surface it first.
  const headlineMatch = cp.content.match(/## HEADLINES ON THIS PAGE\n([\s\S]*?)(?:\n##|\n*$)/);
  if (headlineMatch) {
    parts.push(`## HEADLINES ON THIS PAGE\n${headlineMatch[1].trim()}\n`);
  }
  const articleBody = cp.content.replace(/\n*## HEADLINES ON THIS PAGE\n[\s\S]*$/, '').trim();
  if (articleBody) {
    parts.push(`## PAGE CONTENT\n${articleBody}\n`);
  }

  if (corpus.linkedPages.length > 0) {
    parts.push(`# LINKED PAGES (1 hop)\n`);
    for (const p of corpus.linkedPages) {
      parts.push(`## ${p.title}\nURL: ${p.url}\n${p.content}\n`);
    }
  }

  let out = parts.join('\n');
  if (out.length > CHAT_CONTEXT_BUDGET) {
    out = out.slice(0, CHAT_CONTEXT_BUDGET) + '\n…[truncated]';
  }
  return out;
}

async function resolveBackendUrl(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(['BROWSELEE_BACKEND_URL']);
    const v = stored['BROWSELEE_BACKEND_URL'];
    if (typeof v === 'string' && v.length > 0) return v.replace(/\/$/, '');
  } catch { /* ignore */ }
  return 'http://localhost:8080';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  createdAt: number;
}

let msgSeq = 0;
function nextId() { return `m${++msgSeq}`; }

function IconChat() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}
function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}
function IconMic() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}
function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
    </svg>
  );
}

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({ model: 'gpt-realtime-mini', voice: 'alloy' });
  const [micActive, setMicActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { status, startVoice, stopVoice, transcript, error } = useRealtime();
  const { isExtracting, progress, refresh, corpus } = useExtraction();
  const [chatBusy, setChatBusy] = useState(false);

  // Load settings on mount
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcript]);

  // Keyboard: Esc to close
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Show error as system message
  useEffect(() => {
    if (error) {
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', text: `⚠️ ${error}`, final: true, createdAt: Date.now() }]);
    }
  }, [error]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || chatBusy) return;
    if (!corpus) {
      setMessages(prev => [...prev, {
        id: nextId(), role: 'assistant',
        text: 'Still reading the page. Try again in a moment.',
        final: true, createdAt: Date.now(),
      }]);
      return;
    }
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text, final: true, createdAt: Date.now() };
    const asstId = nextId();
    const asstMsg: ChatMessage = { id: asstId, role: 'assistant', text: '', final: false, createdAt: Date.now() + 1 };
    setMessages(prev => [...prev, userMsg, asstMsg]);
    setInputText('');
    setChatBusy(true);

    // Build chat history (typed-only, excluding the placeholder we just added).
    const history = messages
      .filter(m => m.final && !m.text.startsWith('\u26A0\uFE0F'))
      .map(m => ({ role: m.role, content: m.text }));
    history.push({ role: 'user', content: text });

    const context = buildChatContext(corpus);

    try {
      const backendUrl = await resolveBackendUrl();
      const resp = await fetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data) as { delta?: { content?: string }; error?: string };
            if (evt.error) throw new Error(evt.error);
            const piece = evt.delta?.content;
            if (piece) {
              acc += piece;
              setMessages(prev => prev.map(m => m.id === asstId ? { ...m, text: acc } : m));
            }
          } catch (e) {
            if (e instanceof Error && /^\{/.test(data) === false) throw e;
          }
        }
      }
      setMessages(prev => prev.map(m => m.id === asstId ? { ...m, text: acc || 'Not on this page.', final: true } : m));
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let detail: string;
      if (raw === 'Failed to fetch' || raw.includes('ERR_CONNECTION_REFUSED')) {
        detail = 'Backend offline — start with: pnpm --filter @browselee/backend dev';
      } else if (raw.startsWith('HTTP ')) {
        detail = `Server error (${raw}). Try again.`;
      } else {
        detail = raw;
      }
      setMessages(prev => prev.map(m => m.id === asstId
        ? { ...m, text: `⚠️ ${detail}`, final: true }
        : m));
    } finally {
      setChatBusy(false);
    }
  }, [inputText, chatBusy, corpus, messages]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const startMic = useCallback(async () => {
    if (micActive) return;
    try {
      await startVoice();
      setMicActive(true);
    } catch (err) {
      console.warn('[browselee] mic access denied', err);
      setMicActive(false);
    }
  }, [micActive, startVoice]);

  const stopMic = useCallback(() => {
    if (!micActive) return;
    setMicActive(false);
    stopVoice();
  }, [micActive, stopVoice]);

  const handleSettingChange = useCallback(async (key: keyof Settings, value: string) => {
    const next: Settings = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

  // Merge typed messages and realtime transcript in chronological order.
  const allMessages: ChatMessage[] = [
    ...messages,
    ...transcript.map((t, i) => ({
      id: `tr-${i}`,
      role: t.role,
      text: t.text,
      final: t.final,
      createdAt: t.createdAt,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <>
      {/* Launcher button */}
      <button
        className={['launcher', isOpen ? 'open' : ''].filter(Boolean).join(' ')}
        onClick={() => setIsOpen(o => !o)}
        aria-label={isOpen ? 'Close Browselee' : 'Open Browselee'}
        aria-expanded={isOpen}
      >
        {isOpen ? <IconClose /> : <IconChat />}
      </button>

      {/* Chat panel */}
      <div
        className={['panel', isOpen ? 'visible' : 'hidden'].filter(Boolean).join(' ')}
        role="dialog"
        aria-label="Browselee chat panel"
        aria-hidden={!isOpen}
      >
        <header className="panel-header">
          <span className="panel-title">Browselee</span>
          <span className={['status-pill', status].filter(Boolean).join(' ')} aria-label={`Status: ${status}`}>
            {status}
          </span>
          <button
            className="icon-btn"
            onClick={refresh}
            disabled={isExtracting}
            aria-label="Refresh page extraction"
            title="Refresh page extraction"
          >
            <IconRefresh />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <IconGear />
          </button>
          <button
            className="icon-btn"
            onClick={() => setIsOpen(false)}
            aria-label="Close panel"
          >
            <IconClose />
          </button>
        </header>

        {(() => {
          const t = corpus?.currentPage.theme;
          if (!t) return null;
          const titleLine = t.pageTitle || t.h1;
          const meta = [t.siteName, t.siteType !== 'generic' ? t.siteType : ''].filter(Boolean).join(' · ');
          if (!titleLine && !meta) return null;
          return (
            <div className="theme-banner" aria-label="Page theme">
              <div className="theme-banner-title" title={`${titleLine} — ${meta}`}>
                <span className="theme-banner-icon" aria-hidden="true">📄</span>
                <span className="theme-banner-text">
                  {titleLine}{meta ? <span className="theme-banner-meta"> — {meta}</span> : null}
                </span>
              </div>
              {t.topics.length > 0 && (
                <div className="theme-banner-topics" title={t.topics.join(', ')}>
                  Topics: {t.topics.slice(0, 5).join(' · ')}
                </div>
              )}
            </div>
          );
        })()}

        {isExtracting && (
          <div className="extraction-bar" aria-live="polite" aria-label="Extracting page content">
            <div className="extraction-label">
              {progress ? `Reading page… ${progress.done}/${progress.total}` : 'Reading page…'}
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={progress?.done ?? 0}
              aria-valuemax={progress?.total ?? 1}
            >
              <div
                className="progress-fill"
                style={{ width: progress && progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '15%' }}
              />
            </div>
          </div>
        )}

        <main className="messages" aria-live="polite" aria-label="Conversation">
          {allMessages.length === 0 ? (
            <div className="empty-state">
              <IconChat />
              <span>Ask anything about this page</span>
            </div>
          ) : (
            allMessages.map(msg => (
              <div key={msg.id} className={['message-row', msg.role].join(' ')}>
                <div
                  className={['message-bubble', !msg.final ? 'partial' : ''].filter(Boolean).join(' ')}
                  role="article"
                  aria-label={`${msg.role}: ${msg.text}`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="panel-footer">
          <textarea
            ref={textareaRef}
            className="text-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isExtracting ? 'Reading page… please wait' : 'Ask about this page…'}
            rows={1}
            disabled={isExtracting || chatBusy}
            aria-label="Message input"
            aria-multiline="true"
          />
          <button
            className="send-btn"
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || isExtracting || chatBusy}
            aria-label="Send message"
          >
            <IconSend />
          </button>
          <button
            className={['mic-btn', micActive ? 'active' : ''].filter(Boolean).join(' ')}
            onMouseDown={() => void startMic()}
            onMouseUp={stopMic}
            onMouseLeave={stopMic}
            onTouchStart={() => void startMic()}
            onTouchEnd={stopMic}
            disabled={isExtracting}
            aria-label={micActive ? 'Release to stop recording' : 'Hold to talk'}
            aria-pressed={micActive}
          >
            <IconMic />
          </button>
        </footer>

        <div
          className={['settings-drawer', settingsOpen ? 'open' : ''].filter(Boolean).join(' ')}
          role="complementary"
          aria-label="Settings"
          aria-hidden={!settingsOpen}
        >
          <header className="settings-header">
            <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
              <IconBack />
            </button>
            <span className="settings-title">Settings</span>
          </header>
          <div className="settings-body">
            <div className="field-group">
              <label className="field-label" htmlFor="model-select">Model</label>
              <select
                id="model-select"
                className="field-select"
                value={settings.model}
                onChange={e => void handleSettingChange('model', e.target.value)}
                aria-label="Select AI model"
              >
                <option value="gpt-realtime-mini">gpt-realtime-mini (default)</option>
                <option value="gpt-realtime-1.5">gpt-realtime-1.5</option>
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="voice-select">Voice</label>
              <select
                id="voice-select"
                className="field-select"
                value={settings.voice}
                onChange={e => void handleSettingChange('voice', e.target.value)}
                aria-label="Select voice"
              >
                <option value="alloy">Alloy</option>
                <option value="ash">Ash</option>
                <option value="coral">Coral</option>
                <option value="echo">Echo</option>
                <option value="sage">Sage</option>
                <option value="shimmer">Shimmer</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
