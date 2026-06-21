import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceContextValue {
  state: VoiceState;
  transcript: string;
  isSupported: boolean;
  startListening(): void;
  stopListening(): void;
  speak(text: string, options?: SpeakOptions): void;
  cancelSpeaking(): void;
}

export interface SpeakOptions {
  slow?: boolean;
  charByChar?: boolean;
}

// ---------------------------------------------------------------------------
// Feature detection (must run at module level, not in render)
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

const SpeechRec: SpeechRecognitionConstructor | undefined =
  (typeof window !== 'undefined' &&
    ((window as unknown as Record<string, unknown>).SpeechRecognition as SpeechRecognitionConstructor | undefined ||
     (window as unknown as Record<string, unknown>).webkitSpeechRecognition as SpeechRecognitionConstructor | undefined)) ||
  undefined;


function detectSupport(): boolean {
  if (typeof window === 'undefined') return false;
  const hasRecognition = SpeechRec !== undefined;
  const hasSynthesis =
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined';
  const hasMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined';
  return hasRecognition && hasSynthesis && hasMedia;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const VoiceContext = createContext<VoiceContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function VoiceProvider({
  children,
  onCommand,
}: {
  children: ReactNode;
  onCommand?: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const isSupported = detectSupport();

  // Refs for imperative handles so callbacks never go stale
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const charByCharTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  // ------------------------------------------------------------------
  // SpeechRecognition setup — recreate on each startListening call
  // ------------------------------------------------------------------

  const startListening = useCallback(() => {
    if (!isSupported || !SpeechRec) return;
    if (state === 'listening') return;

    // Tear down any lingering recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setState('listening');
      setTranscript('');
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const raw = event.results[0][0].transcript;
      setTranscript(raw);
    };

    rec.onend = () => {
      setState((prev) => {
        if (prev === 'listening') {
          // Dispatch final transcript to command handler
          setTranscript((t) => {
            if (t.trim()) {
              onCommandRef.current?.(t.trim());
            }
            return t;
          });
          return 'processing';
        }
        return prev;
      });
      recognitionRef.current = null;
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'aborted' is a normal stop — not an error visible to the user
      if (event.error !== 'aborted') {
        setState('error');
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    rec.start();
  }, [isSupported, state]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
  }, []);

  // ------------------------------------------------------------------
  // SpeechSynthesis
  // ------------------------------------------------------------------

  const cancelSpeaking = useCallback(() => {
    // Clear any pending charByChar timers
    for (const t of charByCharTimersRef.current) clearTimeout(t);
    charByCharTimersRef.current = [];

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setState((prev) => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  const speak = useCallback(
    (text: string, options: SpeakOptions = {}) => {
      if (!isSupported) return;
      if (!text.trim()) return;

      cancelSpeaking();
      setState('speaking');

      if (options.charByChar) {
        const chars = text.split('');
        const timers: ReturnType<typeof setTimeout>[] = [];
        chars.forEach((ch, i) => {
          const t = setTimeout(() => {
            const u = new window.SpeechSynthesisUtterance(ch);
            u.rate = options.slow ? 0.7 : 1;
            window.speechSynthesis.speak(u);
            if (i === chars.length - 1) {
              setState((prev) => (prev === 'speaking' ? 'idle' : prev));
            }
          }, i * 300);
          timers.push(t);
        });
        charByCharTimersRef.current = timers;
        return;
      }

      const utterance = new window.SpeechSynthesisUtterance(text);
      if (options.slow) utterance.rate = 0.7;

      utterance.onend = () => {
        setState((prev) => (prev === 'speaking' ? 'idle' : prev));
      };
      utterance.onerror = () => {
        setState('error');
      };

      window.speechSynthesis.speak(utterance);
    },
    [isSupported, cancelSpeaking],
  );

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      for (const t of charByCharTimersRef.current) clearTimeout(t);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const value: VoiceContextValue = {
    state,
    transcript,
    isSupported,
    startListening,
    stopListening,
    speak,
    cancelSpeaking,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return ctx;
}
