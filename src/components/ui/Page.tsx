import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Width presets for the Page container.
 *
 * Mobile stays compact (phone column). From `md` upward we intentionally
 * widen so laptop/desktop no longer look like a stretched phone mockup.
 *
 * - prose: forms & detail pages
 * - list:  item lists / Money tabs
 * - wide:  dashboards and data-heavy layouts
 * - full:  edge-to-edge with horizontal padding only
 */
export type PageWidth = "prose" | "list" | "wide" | "full";

const WIDTH_CLASSES: Record<PageWidth, string> = {
  prose: "mx-auto w-full max-w-xl px-4 md:max-w-2xl md:px-6 lg:max-w-3xl",
  list: "mx-auto w-full max-w-2xl px-4 md:max-w-3xl md:px-6 lg:max-w-5xl xl:max-w-6xl",
  wide: "mx-auto w-full max-w-5xl px-4 md:px-6 lg:max-w-6xl xl:max-w-7xl",
  full: "w-full px-4 md:px-6 lg:px-8",
};

/**
 * Standard content container. Clears the floating bottom nav on mobile
 * (`pb-nav`); optional width presets keep Money/Vault layouts usable on laptop.
 */
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
    <div
      className={cn(
        WIDTH_CLASSES[width],
        "pt-3 pb-nav md:pt-6 md:pb-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
