import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AccountMenu } from "../AccountMenu";
import { AssistantButton } from "../money/AssistantButton";
import { VaultMark } from "../brand/VaultMark";
import { cn } from "../../lib/cn";

/**
 * Floating liquid-bubble title bar — same frosted capsule on phone and laptop.
 * A short scrim sits *behind* the capsule only (not over the first content
 * row) so Money/Vault titles and hero figures stay fully readable on phones.
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
    <header className="pt-safe sticky top-0 z-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-8 bottom-0 bg-gradient-to-b from-ink-950 via-ink-950/70 to-transparent"
      />
      <div className="relative mx-auto w-full max-w-5xl px-3 pt-2 pb-1 sm:px-4 md:px-6 lg:max-w-6xl xl:max-w-7xl">
        <div className="liquid-bubble liquid-chrome flex h-14 items-center gap-1 rounded-full pr-1.5 pl-2">
          {back ? (
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="liquid-press flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/8 hover:text-fg"
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
          ) : (
            <VaultMark className="ml-1.5 size-7 shrink-0 md:hidden" />
          )}

          <h1
            className={cn(
              "min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-fg",
              back ? "px-0.5" : "px-3",
            )}
          >
            {title}
          </h1>

          {trailing}
          <AssistantButton />
          {!hideAccount && <AccountMenu />}
        </div>
      </div>
    </header>
  );
}
