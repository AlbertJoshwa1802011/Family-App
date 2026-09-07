/** Active pill color for the Money tab (matches AppShell NAV_ITEMS Money). */
export const MONEY_ACCENT = "#22c55e";

/**
 * Which Money sub-nav tab owns a pathname. Exported so tests can pin nested
 * routes (`/money/expenses/:id`) without mounting React Router.
 */
export type MoneyTab =
  | "overview"
  | "spending"
  | "funds"
  | "committed"
  | "wishlist"
  | null;

export function moneyTabForPath(pathname: string): MoneyTab {
  if (pathname === "/money") return "overview";
  if (pathname.startsWith("/money/expenses")) return "spending";
  if (pathname.startsWith("/money/funds")) return "funds";
  if (pathname.startsWith("/money/commitments")) return "committed";
  if (pathname.startsWith("/money/wishlist")) return "wishlist";
  return null; // settings / unknown
}
