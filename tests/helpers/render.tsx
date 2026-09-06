/**
 * Render helpers for component tests.
 *
 * Most UI primitives are pure and need no providers. The ones that navigate
 * (ListItem, AppBar, BottomNav) need a router, and app chrome additionally
 * needs TanStack Query + the auth/assistant contexts. Compose only what a test
 * actually needs so failures point at the component, not the harness.
 */
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantUiProvider } from "../../src/context/AssistantUiContext";

/** A query client that never retries or caches across tests. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderUiOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial history entries for the MemoryRouter. */
  route?: string;
  /** Wrap in QueryClientProvider + AssistantUiProvider as well as the router. */
  withProviders?: boolean;
}

/** Render inside a MemoryRouter (and optionally the app-level providers). */
export function renderUi(
  ui: ReactElement,
  { route = "/", withProviders = false, ...options }: RenderUiOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;
    if (!withProviders) return inner;
    return (
      <QueryClientProvider client={testQueryClient()}>
        <AssistantUiProvider>{inner}</AssistantUiProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

/** The liquid-glass classes an element carries, as a Set for easy assertions. */
export function classes(el: Element): Set<string> {
  return new Set(el.className.toString().split(/\s+/).filter(Boolean));
}

/** Assert an element is built from the shared `.lq` glass recipe. */
export function expectGlass(el: Element | null): void {
  if (!el) throw new Error("expected an element, got null");
  if (!classes(el).has("lq")) {
    throw new Error(`expected .lq glass on <${el.tagName.toLowerCase()}>, got "${el.className}"`);
  }
}

/**
 * The sliding-pill indicators (SegmentedControl, BottomNav) position themselves
 * with `calc(<pad> + <fraction> * (100% - <pad2>))`. jsdom normalises that to a
 * decimal, so tests assert on the fraction rather than the literal string.
 *
 *   left:  calc(0.25rem + 0.3333 * (100% - 0.5rem))  -> 0.3333  (index / count)
 *   width: calc(0.3333 * (100% - 0.5rem))            -> 0.3333  (1 / count)
 */
export function calcFraction(value: string): number {
  const withOffset = /\+\s*([\d.]+)\s*\*/.exec(value);
  if (withOffset) return Number(withOffset[1]);
  const bare = /calc\(\s*([\d.]+)\s*\*/.exec(value);
  if (bare) return Number(bare[1]);
  throw new Error(`no calc fraction in "${value}"`);
}
