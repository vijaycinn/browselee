import { useState, useRef, useCallback, useEffect } from 'react';
import { useChannel } from './useChannel';
import { useExtraction } from './useExtraction';
import { loadSettings } from '../lib/settings';
import { formatCorpusAsInstructions } from '../lib/corpusFormatter';
import type { SessionResponse, PageCorpus } from '../../shared/messages';

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  createdAt: number;
}

export interface UseRealtimeReturn {
  status: RealtimeStatus;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  sendText: (text: string) => Promise<void>;
  transcript: TranscriptEntry[];
  error: string | null;
}

const VERBOSE = false;

const NOT_READY_TEXT =
  'I am still reading this page. Please wait until extraction completes, then ask again.';

function hasUsableCorpus(corpus: PageCorpus | null): boolean {
  if (!corpus) return false;
  const cp = corpus.currentPage;
  if (!cp) return false;
  if (!cp.content || cp.content.trim().length < 200) return false;
  return true;
}

export function useRealtime(): UseRealtimeReturn {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const initialInstructionsRef = useRef<string | undefined>(undefined);
  const lastAppliedInstructionsRef = useRef<string>('');

  const { send, on } = useChannel();
  const { corpus } = useExtraction();
  const corpusRef = useRef<PageCorpus | null>(null);

  useEffect(() => {
    corpusRef.current = corpus;
  }, [corpus]);

  // ── Transcript helpers ────────────────────────────────────────────────────

  const appendAssistantDelta = useCallback((delta: string, final: boolean) => {
    setTranscript(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && !last.final) {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta, final }];
      }
      return [...prev, { role: 'assistant', text: delta, final, createdAt: Date.now() }];
    });
  }, []);

  // ── Session request via SW ────────────────────────────────────────────────

  const requestSession = useCallback(
    (voice?: string, instructions?: string): Promise<SessionResponse & { ok: true }> => {
      return new Promise((resolve, reject) => {
        let off: (() => void) | null = null;

        const timer = setTimeout(() => {
          off?.();
          reject(new Error('session_request_timeout'));
        }, 10_000);

        off = on('session:response', msg => {
          clearTimeout(timer);
          off?.();
          const resp = msg as SessionResponse;
          if (resp.ok) {
            resolve(resp as SessionResponse & { ok: true });
          } else {
            reject(new Error(resp.error));
          }
        });

        send({ kind: 'session:request', voice, instructions });
      });
    },
    [send, on],
  );

  // ── Data channel event dispatcher ────────────────────────────────────────

  const handleDcMessage = useCallback(
    (evt: MessageEvent<string>) => {
      let event: { type: string; [k: string]: unknown };
      try {
        event = JSON.parse(evt.data) as { type: string; [k: string]: unknown };
      } catch {
        return;
      }

      switch (event.type) {
        // Audio transcript (GA name)
        case 'response.output_audio_transcript.delta':
          appendAssistantDelta((event.delta as string | undefined) ?? '', false);
          break;
        case 'response.output_audio_transcript.done':
          appendAssistantDelta('', true);
          break;

        // Text delta (GA name + legacy alias)
        case 'response.output_text.delta':
        case 'response.text.delta':
          appendAssistantDelta((event.delta as string | undefined) ?? '', false);
          break;
        case 'response.output_text.done':
        case 'response.text.done':
          appendAssistantDelta('', true);
          break;

        // User audio transcription complete
        case 'conversation.item.input_audio_transcription.completed':
          setTranscript(prev => [
            ...prev,
            { role: 'user', text: (event.transcript as string | undefined) ?? '', final: true, createdAt: Date.now() },
          ]);
          break;

        case 'error': {
          const msg = (event.message as string | undefined) ?? 'Realtime error';
          setError(msg);
          setStatus('error');
          break;
        }

        default:
          if (VERBOSE) console.debug('[browselee/rt] dc event', event.type, event);
      }
    },
    [appendAssistantDelta],
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch { /* ignore */ }
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      try {
        pcRef.current.close();
      } catch { /* ignore */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const setLocalAudioEnabled = useCallback((enabled: boolean) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }, []);

  const waitForDataChannelOpen = useCallback(async (timeoutMs = 5_000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dc = dcRef.current;
      if (dc && dc.readyState === 'open') return;
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    throw new Error('data_channel_open_timeout');
  }, []);

  const buildInstructions = useCallback((userInstructions?: string): string => {
    const currentCorpus = corpusRef.current;
    return formatCorpusAsInstructions(
      currentCorpus ?? {
        currentPage: { url: '', title: '', content: '', wordCount: 0 },
        linkedPages: [],
        totalChars: 0,
        truncated: false,
      },
      userInstructions,
    );
  }, []);

  const sendGroundingUpdate = useCallback((userInstructions?: string): boolean => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return false;

    const instructions = buildInstructions(userInstructions);
    if (instructions === lastAppliedInstructionsRef.current) return true;

    try {
      dc.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions,
            temperature: 0.6,
            max_response_output_tokens: 200,
          },
        }),
      );
      lastAppliedInstructionsRef.current = instructions;
      console.info(
        `[browselee/rt] grounding sent: ${instructions.length}ch; preview:\n` +
          instructions.slice(0, 400) + '\n…\n' + instructions.slice(-400),
      );
      return true;
    } catch {
      return false;
    }
  }, [buildInstructions]);

  // ── Internal connect ──────────────────────────────────────────────────────

  const connect = useCallback(
    async (opts?: { voice?: string; instructions?: string }): Promise<void> => {
      if (status === 'connecting' || status === 'live') return;

      setStatus('connecting');
      setError(null);
      initialInstructionsRef.current = opts?.instructions;

      let sessionData: SessionResponse & { ok: true };
      try {
        const settings = await loadSettings();
        const voice = opts?.voice ?? settings.voice;
        sessionData = await requestSession(voice, opts?.instructions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
        return;
      }

      const { clientSecret, webrtcUrl, model } = sessionData;

      try {
        const settings = await loadSettings();
        const voice = settings.voice;

        // Peer connection
        const pc = new RTCPeerConnection({});
        pcRef.current = pc;

        // Remote audio element
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = document.createElement('audio');
          remoteAudioRef.current.autoplay = true;
        }
        const remoteAudio = remoteAudioRef.current;
        pc.ontrack = e => {
          remoteAudio.srcObject = e.streams[0];
          remoteAudio.play().catch(() => { /* autoplay policy; will play on user gesture */ });
        };

        // Local microphone
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localStreamRef.current = localStream;
        // Start muted; push-to-talk toggles track state.
        localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
        localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));

        // Data channel — MUST be named 'oai-events' per Foundry GA contract
        const dc = pc.createDataChannel('oai-events', { ordered: true });
        dcRef.current = dc;

        dc.onopen = () => {
          // First message MUST be session.update with session.type:"realtime" (GA requirement)
          const instructions = buildInstructions(opts?.instructions);

          const whisperDeployment = settings.whisperDeployment;

          const sessionUpdate = {
            type: 'session.update',
            session: {
              type: 'realtime',
              model,
              instructions,
              output_modalities: ['audio', 'text'],
              // Strict grounding: lowest supported temperature, hard cap on response length.
              temperature: 0.6,
              max_response_output_tokens: 200,
              audio: {
                input: {
                  ...(whisperDeployment
                    ? { transcription: { model: whisperDeployment } }
                    : {}),
                  turn_detection: { type: 'server_vad' },
                },
                output: { voice },
              },
            },
          };

          try {
            dc.send(JSON.stringify(sessionUpdate));
            lastAppliedInstructionsRef.current = instructions;
          } catch {
            // Channel may have closed before first send
          }
          setStatus('live');
        };

        dc.onmessage = handleDcMessage;

        dc.onerror = () => {
          setError('data_channel_error');
          setStatus('error');
          cleanup();
        };

        dc.onclose = () => {
          if (status === 'live' || status === 'connecting') {
            setStatus('idle');
          }
          cleanup();
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') {
            setError('webrtc_connection_failed');
            setStatus('error');
            cleanup();
          } else if (pc.connectionState === 'disconnected') {
            setStatus('idle');
            cleanup();
          }
        };

        // SDP offer
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);

        // POST SDP to Foundry GA calls endpoint
        const sdpController = new AbortController();
        const sdpTimeout = setTimeout(() => sdpController.abort(), 15_000);
        let sdpResponse: Response;
        try {
          sdpResponse = await fetch(webrtcUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${clientSecret}`,
              'Content-Type': 'application/sdp',
            },
            body: offer.sdp,
            signal: sdpController.signal,
          });
        } finally {
          clearTimeout(sdpTimeout);
        }

        if (sdpResponse.status !== 201) {
          throw new Error(`SDP exchange failed: ${sdpResponse.status}`);
        }

        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
        cleanup();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, requestSession, handleDcMessage, cleanup, buildInstructions],
  );

  useEffect(() => {
    if (status !== 'live') return;
    sendGroundingUpdate(initialInstructionsRef.current);
  }, [status, corpus, sendGroundingUpdate]);

  // ── Public API ────────────────────────────────────────────────────────────

  const startVoice = useCallback(async () => {
    await connect();
    try {
      await waitForDataChannelOpen();
      setLocalAudioEnabled(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
    }
  }, [connect, waitForDataChannelOpen, setLocalAudioEnabled]);

  const stopVoice = useCallback(() => {
    // Push-to-talk release should end capture, not tear down the whole session.
    setLocalAudioEnabled(false);

    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify({ type: 'response.create' }));
      } catch { /* ignore */ }
    }
  }, [setLocalAudioEnabled]);

  const sendText = useCallback(
    async (text: string) => {
      // HARD GATE: refuse client-side if no usable page corpus yet.
      if (!hasUsableCorpus(corpusRef.current)) {
        setTranscript(prev => [
          ...prev,
          { role: 'assistant', text: NOT_READY_TEXT, final: true, createdAt: Date.now() },
        ]);
        return;
      }

      if (status !== 'live') {
        await connect();
      }

      try {
        await waitForDataChannelOpen();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.warn('[browselee/rt] sendText:', msg);
        return;
      }

      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') {
        console.warn('[browselee/rt] sendText: data channel not open');
        return;
      }

      // Guarantee latest corpus is applied to the session before this turn.
      sendGroundingUpdate(initialInstructionsRef.current);

      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        }),
      );
      dc.send(JSON.stringify({ type: 'response.create' }));
    },
    [status, connect, waitForDataChannelOpen, sendGroundingUpdate],
  );

  return { status, startVoice, stopVoice, sendText, transcript, error };
}

