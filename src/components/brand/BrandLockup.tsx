import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";
import { VaultMark } from "./VaultMark";

type LockupSize = "sm" | "md" | "lg";

const MARK_SIZE: Record<LockupSize, string> = {
  sm: "size-6",
  md: "size-7",
  lg: "size-9",
};

const TEXT_SIZE: Record<LockupSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

/**
 * BrandLockup — the symbol plus the "Family Vault" wordmark.
 *
 * The wordmark is two-tone: "Family" in the standard foreground, "Vault" in the
 * brand teal, so the product name still reads as one phrase while the vault half
 * carries the brand colour. Set `markOnly` for tight spots (the tablet rail).
 */
export function BrandLockup({
  size = "md",
  markOnly = false,
  to = "/",
  className,
}: {
  size?: LockupSize;
  markOnly?: boolean;
  /** Link destination. Pass `null` to render a plain, non-interactive lockup. */
  to?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <VaultMark className={cn(MARK_SIZE[size], "shrink-0")} />
      {!markOnly && (
        <span
          className={cn(
            "no-select truncate font-semibold tracking-tight",
            TEXT_SIZE[size],
          )}
        >
          <span className="text-fg">Family</span>
          <span className="text-vault-400"> Vault</span>
        </span>
      )}
    </>
  );

  const classes = cn("flex items-center gap-2", className);

  if (to === null) {
    return (
      <span className={classes} aria-label="Family Vault">
        {content}
      </span>
    );
  }

  return (
    <Link to={to} aria-label="Family Vault — go to home" className={classes}>
      {content}
    </Link>
  );
}
