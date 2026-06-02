import { useState, useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { useExtraction } from './hooks/useExtraction';
import { useChannel } from './hooks/useChannel';
import { loadSettings, saveSettings } from './lib/settings';
import type { Settings } from './lib/settings';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
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

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({ model: 'gpt-realtime-mini', voice: 'alloy' });
  const [micActive, setMicActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const { status, startVoice, stopVoice, sendText, transcript, error } = useRealtime();
  const { isExtracting, progress } = useExtraction();
  const { send } = useChannel();

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
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', text: `⚠️ ${error}`, final: true }]);
    }
  }, [error]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setMessages(prev => [...prev, { id: nextId(), role: 'user', text, final: true }]);
    setInputText('');
    await sendText(text);
    // Also signal a session request to SW (no-op handled by ext-realtime later)
    send({ kind: 'session:request' });
  }, [inputText, sendText, send]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const startMic = useCallback(async () => {
    if (micActive) return;
    try {
      // Lazy getUserMedia — only on press (UX requirement)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicActive(true);
      await startVoice();
    } catch (err) {
      console.warn('[browselee] mic access denied', err);
    }
  }, [micActive, startVoice]);

  const stopMic = useCallback(() => {
    if (!micActive) return;
    setMicActive(false);
    stopVoice();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  }, [micActive, stopVoice]);

  const handleSettingChange = useCallback(async (key: keyof Settings, value: string) => {
    const next: Settings = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

  // Merge transcript into visible list
  const allMessages: ChatMessage[] = [
    ...messages,
    ...transcript.map((t, i) => ({
      id: `tr-${i}`,
      role: t.role,
      text: t.text,
      final: t.final,
    })),
  ];

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
            placeholder="Ask about this page…"
            rows={1}
            aria-label="Message input"
            aria-multiline="true"
          />
          <button
            className="send-btn"
            onClick={() => void handleSend()}
            disabled={!inputText.trim()}
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
