/** Helpers for query-param section tabs (`?tab=`). */

export function tabFromSearch(search: string, fallback = "all"): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("tab") ?? fallback;
}

/** Build isActive for query-tab sub-navs under a base path. */
export function makeTabActive(
  basePath: string,
  tab: string,
  defaultTab = "all",
): (pathname: string, search: string) => boolean {
  return (pathname, search) => {
    if (pathname !== basePath) return false;
    const current = tabFromSearch(search, defaultTab);
    return current === tab;
  };
}
