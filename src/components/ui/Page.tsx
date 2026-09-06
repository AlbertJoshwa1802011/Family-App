import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Standard mobile content container: centered, max-w-md, with enough bottom
 * room to clear the floating bottom nav bubble.
 */
export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-md px-4 pt-3 pb-36", className)}>
      {children}
    </div>
  );
}
