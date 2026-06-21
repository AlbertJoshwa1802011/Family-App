import { useEffect, useRef } from 'react';
import { useVoice } from '../../context/VoiceContext';
import type { VoiceState } from '../../context/VoiceContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateLabel(state: VoiceState): string {
  switch (state) {
    case 'listening':
      return 'Listening…';
    case 'processing':
      return 'Processing…';
    case 'speaking':
      return 'Speaking…';
    case 'error':
      return 'Something went wrong';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceOverlay() {
  const { state, transcript, cancelSpeaking, stopListening } = useVoice();

  const isVisible = state !== 'idle';

  // Keep a ref to the overlay so we can manage focus trap
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Move focus into the overlay when it opens
  useEffect(() => {
    if (isVisible && cancelBtnRef.current) {
      cancelBtnRef.current.focus();
    }
  }, [isVisible]);

  function handleCancel() {
    if (state === 'speaking') {
      cancelSpeaking();
    } else {
      stopListening();
    }
  }

  // Dismiss on Escape key
  useEffect(() => {
    if (!isVisible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  if (!isVisible) return null;

  return (
    <>
      <style>{`
        @keyframes fv-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fv-overlay-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes fv-bar-bounce {
          0%, 100% { transform: scaleY(0.3); }
          50%       { transform: scaleY(1); }
        }
        .fv-overlay-enter {
          animation: fv-overlay-in 200ms ease forwards;
        }
        .fv-waveform-bar {
          animation: fv-bar-bounce 0.9s ease-in-out infinite;
          transform-origin: bottom;
        }
        .fv-waveform-bar:nth-child(2) { animation-delay: 0.15s; }
        .fv-waveform-bar:nth-child(3) { animation-delay: 0.30s; }
        @media (prefers-reduced-motion: reduce) {
          .fv-overlay-enter  { animation: none; }
          .fv-waveform-bar   { animation: none; transform: none; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label={stateLabel(state)}
        className="fv-overlay-enter"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.82)',
          padding: '2rem',
          gap: '2rem',
        }}
      >
        {/* State label */}
        <p
          style={{
            color: '#ffffff',
            fontSize: '1.125rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
            margin: 0,
          }}
        >
          {stateLabel(state)}
        </p>

        {/* Waveform placeholder — 3 animated bars */}
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '0.5rem',
            height: '48px',
          }}
        >
          {[20, 40, 20].map((h, i) => (
            <div
              key={i}
              className={state === 'listening' ? 'fv-waveform-bar' : ''}
              style={{
                width: '10px',
                height: `${h}px`,
                borderRadius: '4px',
                backgroundColor:
                  state === 'error'
                    ? 'var(--color-warning, #f59e0b)'
                    : 'var(--color-vault-400, #818cf8)',
              }}
            />
          ))}
        </div>

        {/* Live transcript */}
        <div
          aria-live="polite"
          aria-atomic="false"
          style={{
            minHeight: '3rem',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
          }}
        >
          {transcript ? (
            <p
              style={{
                color: '#e2e8f0',
                fontSize: '1rem',
                lineHeight: 1.6,
                margin: 0,
                wordBreak: 'break-word',
              }}
            >
              {transcript}
            </p>
          ) : (
            <p
              style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: '0.875rem',
                margin: 0,
              }}
            >
              {state === 'listening' ? 'Speak now…' : ''}
            </p>
          )}
        </div>

        {/* Cancel button — ≥44px touch target */}
        <button
          ref={cancelBtnRef}
          type="button"
          onClick={handleCancel}
          style={{
            minWidth: '120px',
            minHeight: '48px',
            paddingInline: '2rem',
            borderRadius: '9999px',
            border: '2px solid rgba(255,255,255,0.3)',
            backgroundColor: 'transparent',
            color: '#ffffff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.02em',
            transition: 'background-color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              'rgba(255,255,255,0.12)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              'transparent';
          }}
        >
          Cancel
        </button>
      </div>
    </>
  );
}
