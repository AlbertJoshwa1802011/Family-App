import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

interface ListItemProps {
  to?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  showChevron?: boolean;
  className?: string;
}

function Inner({ leading, title, subtitle, trailing, showChevron }: ListItemProps) {
  return (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{title}</div>
        {subtitle && (
          <div className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</div>
        )}
      </div>
      {trailing && (
        <div className="flex items-center shrink-0">
          {trailing}
        </div>
      )}
      {showChevron && (
        <ChevronRight className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
    </>
  );
}

export function ListItem(props: ListItemProps) {
  const interactive = Boolean(props.to || props.onClick);
  const base = cn(
    "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors",
    interactive && "hover:bg-white/5 active:bg-white/[0.07]",
    props.className,
  );
  if (props.to) {
    return (
      <Link to={props.to} className={base}>
        <Inner {...props} showChevron={props.showChevron ?? true} />
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={cn(base, "w-full text-left")}>
        <Inner {...props} showChevron={props.showChevron ?? true} />
      </button>
    );
  }
  return (
    <div className={base}>
      <Inner {...props} />
    </div>
  );
}
