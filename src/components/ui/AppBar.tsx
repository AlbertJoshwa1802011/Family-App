import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantButton } from "../AssistantButton";
import { cn } from "../../lib/cn";

/**
 * Floating liquid-glass title bar. The capsule hovers over the content while a
 * scrim behind it fades whatever scrolls underneath, so the blur always has
 * something to refract without the text ever colliding with it.
 */
export function AppBar({
  title,
  back = false,
  trailing,
  className,
}: {
  title: ReactNode;
  back?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <header className={cn("pt-safe sticky top-0 z-20", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-8 -bottom-6 bg-linear-to-b from-ink-950 via-ink-950/70 to-transparent"
      />
      <div className="relative mx-auto max-w-md px-3 pt-2 pb-1">
        <div className="lq lq-chrome flex h-14 items-center gap-1 rounded-full pr-1.5 pl-2">
          {back && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="lq-press flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/8 hover:text-fg"
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
          )}
          <h1
            className={cn(
              "flex-1 truncate text-[17px] font-semibold tracking-tight text-fg",
              back ? "px-0.5" : "px-3",
            )}
          >
            {title}
          </h1>
          {trailing}
          <AssistantButton />
        </div>
      </div>
    </header>
  );
}
