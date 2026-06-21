import { AlertCircle, Loader2, Mic, MicOff } from 'lucide-react';
import { useVoice } from '../../context/VoiceContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Size = 'sm' | 'md' | 'lg';

interface MicButtonProps {
  size?: Size;
  className?: string;
}

// ---------------------------------------------------------------------------
// Size maps
// ---------------------------------------------------------------------------

const SIZE_PX: Record<Size, number> = {
  sm: 36,
  md: 48,
  lg: 60,
};

const ICON_PX: Record<Size, number> = {
  sm: 16,
  md: 22,
  lg: 28,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MicButton({ size = 'md', className = '' }: MicButtonProps) {
  const { state, isSupported, startListening, stopListening } = useVoice();

  const buttonPx = SIZE_PX[size];
  const iconPx = ICON_PX[size];

  function handleClick() {
    if (!isSupported) return;
    if (state === 'listening') {
      stopListening();
    } else if (state === 'idle' || state === 'error') {
      startListening();
    }
    // processing/speaking states: button is disabled
  }

  const isDisabled = !isSupported || state === 'processing' || state === 'speaking';

  const ariaLabel =
    state === 'listening'
      ? 'Stop listening'
      : state === 'processing'
        ? 'Processing…'
        : state === 'speaking'
          ? 'Speaking…'
          : state === 'error'
            ? 'Voice error — tap to retry'
            : 'Start voice input';

  return (
    <>
      {/* Inline keyframes injected once via a style tag.
          Tailwind alone cannot express the pulse ring + spin animations
          we need, and we must respect prefers-reduced-motion. */}
      <style>{`
        @keyframes fv-mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
          50%       { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
        }
        @keyframes fv-spin {
          to { transform: rotate(360deg); }
        }
        .fv-mic-pulse {
          animation: fv-mic-pulse 1.4s ease-in-out infinite;
        }
        .fv-mic-spin {
          animation: fv-spin 0.8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .fv-mic-pulse { animation: none; }
          .fv-mic-spin  { animation: none; }
        }
      `}</style>

      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-label={ariaLabel}
        style={{
          width: buttonPx,
          height: buttonPx,
          minWidth: buttonPx,
          minHeight: buttonPx,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          // Colors via CSS custom properties so themes apply
          backgroundColor:
            state === 'listening'
              ? 'var(--color-danger, #ef4444)'
              : state === 'error'
                ? 'var(--color-warning, #f59e0b)'
                : 'var(--color-vault-500, #6366f1)',
          color: '#ffffff',
          opacity: isDisabled && state !== 'processing' ? 0.5 : 1,
          transition: 'background-color 200ms ease, opacity 200ms ease',
          flexShrink: 0,
        }}
        className={[
          // Pulse ring while listening (disabled when motion reduced via CSS)
          state === 'listening' ? 'fv-mic-pulse' : '',
          // Focus ring via Tailwind
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-vault-500',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {state === 'processing' ? (
          <Loader2 size={iconPx} className="fv-mic-spin" aria-hidden="true" />
        ) : state === 'listening' ? (
          <MicOff size={iconPx} aria-hidden="true" />
        ) : state === 'error' ? (
          <AlertCircle size={iconPx} aria-hidden="true" />
        ) : (
          <Mic size={iconPx} aria-hidden="true" />
        )}
      </button>
    </>
  );
}
