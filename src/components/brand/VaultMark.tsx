import { useId } from "react";
import { cn } from "../../lib/cn";

/**
 * VaultMark — the Family Vault symbol.
 *
 * A protective shield (family) enclosing a vault dial (security). The dial is
 * drawn in a fixed dark ink rather than knocked out to transparency, so the mark
 * keeps its contrast on any surface — header, light card, or app icon.
 *
 * Brand colours are intentionally static (see `--color-vault-*` in index.css):
 * the mark must read identically in both themes.
 */
export function VaultMark({
  className,
  title,
}: {
  className?: string;
  /** Accessible name. Omit for decorative use (the default). */
  title?: string;
}) {
  // Gradient ids must be unique — several marks can share one document.
  const gid = useId();
  const shieldGradient = `vm-shield-${gid}`;

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={shieldGradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="55%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
      </defs>

      {/* Shield — family under protection */}
      <path
        d="M16 2.2 27 6.6v8.7c0 7.1-4.6 12.6-11 14.6-6.4-2-11-7.5-11-14.6V6.6Z"
        fill={`url(#${shieldGradient})`}
        strokeLinejoin="round"
      />

      {/* Vault dial — ring, spokes, hub */}
      <g stroke="#06231f" strokeLinecap="round" fill="none">
        <circle cx="16" cy="15.4" r="5.3" strokeWidth="2.1" />
        <path
          d="M16 7.6v2.5M16 20.7v2.5M8.2 15.4h2.5M21.3 15.4h2.5"
          strokeWidth="1.9"
        />
      </g>
      <circle cx="16" cy="15.4" r="1.9" fill="#06231f" />
    </svg>
  );
}
