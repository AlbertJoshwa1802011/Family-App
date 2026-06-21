import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Width presets for the Page container.
 *
 * - prose: max-w-xl  — default; comfortable reading width, suits forms & detail pages
 * - list:  max-w-2xl — wider; suits item lists where more horizontal space helps
 * - wide:  max-w-5xl — full-ish; suits dashboards and data-heavy layouts
 * - full:  no max-w  — edge-to-edge with only horizontal padding
 */
export type PageWidth = "prose" | "list" | "wide" | "full";

const WIDTH_CLASSES: Record<PageWidth, string> = {
  prose: "max-w-xl mx-auto px-4",
  list: "max-w-2xl mx-auto px-4",
  wide: "max-w-5xl mx-auto px-4",
  full: "px-4",
};

/** Standard content container. Clears the bottom nav on mobile; no extra offset on tablet/desktop. */
export function Page({
  children,
  className,
  width = "prose",
}: {
  children: ReactNode;
  className?: string;
  /** Controls the max-width of the inner container. Default: 'prose'. */
  width?: PageWidth;
}) {
  return (
    <div className={cn(WIDTH_CLASSES[width], "pt-4 pb-8", className)}>
      {children}
    </div>
  );
}
