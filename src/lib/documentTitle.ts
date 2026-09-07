/**
 * Derive a human document title from an uploaded file name.
 * Strips a final extension and collapses leftover whitespace / underscores.
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? fileName.trim();
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  // Cap at the API title max (300); empty/extension-only names fall back.
  const title = (cleaned || base || "Untitled document").slice(0, 300);
  return title;
}
