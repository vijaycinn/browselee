// REPLACED BY ext-realtime — do not call /api/session here, this is a render stub.

export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export interface UseRealtimeReturn {
  status: RealtimeStatus;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  sendText: (text: string) => Promise<void>;
  transcript: TranscriptEntry[];
  error: string | null;
}

export function useRealtime(): UseRealtimeReturn {
  return {
    status: 'idle',
    startVoice: async () => {
      console.warn('[browselee] useRealtime not wired yet');
    },
    stopVoice: () => {},
    sendText: async (_text: string) => {
      console.warn('[browselee] sendText not wired yet');
    },
    transcript: [],
    error: null,
  };
}
