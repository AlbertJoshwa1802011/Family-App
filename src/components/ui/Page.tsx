import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Standard mobile content container: centered, max-w-md, clears the bottom nav. */
export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-md px-4 pt-4 pb-28", className)}>
      {children}
    </div>
  );
}
