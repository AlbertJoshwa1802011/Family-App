import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AccountMenu } from "../AccountMenu";
import { VaultMark } from "../brand/VaultMark";
import { cn } from "../../lib/cn";

/**
 * AppBar — the single application header.
 *
 * Every in-shell page renders exactly one of these, so it carries the brand and
 * the account menu rather than duplicating them in the shell. Layout is
 * [back | brand] · title · [page actions] · account.
 *
 * The brand mark is mobile-only: on md+ the nav rail/sidebar already shows it,
 * and repeating it in the header reads as a duplicate.
 */
export function AppBar({
  title,
  back = false,
  trailing,
  /** Hide the account avatar (e.g. a focused full-screen form). */
  hideAccount = false,
}: {
  title: ReactNode;
  back?: boolean;
  trailing?: ReactNode;
  hideAccount?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-ink-950/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-4">
        {back ? (
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
        ) : (
          <VaultMark className="size-7 shrink-0 md:hidden" />
        )}

        <h1
          className={cn(
            "min-w-0 flex-1 truncate text-lg font-semibold text-fg",
            back ? "px-1" : "px-0.5",
          )}
        >
          {title}
        </h1>

        {trailing}
        {!hideAccount && <AccountMenu />}
      </div>
    </header>
  );
}
