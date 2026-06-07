import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function AppBar({
  title,
  back = false,
  trailing,
}: {
  title: ReactNode;
  back?: boolean;
  trailing?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-ink-950/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-2">
        {back && (
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex size-11 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-white/5 active:scale-95"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
        )}
        <h1 className="flex-1 truncate px-1 text-lg font-semibold text-fg">
          {title}
        </h1>
        {trailing}
      </div>
    </header>
  );
}
