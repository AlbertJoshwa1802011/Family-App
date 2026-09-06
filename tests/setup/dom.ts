/**
 * Global test setup. Safe to load in both the `node` and `jsdom` environments —
 * jest-dom only extends `expect`, it does not touch `document` at import time.
 * Component test files opt into a DOM with a `@vitest-environment jsdom`
 * docblock so the worker/unit suites keep running in fast plain Node.
 */
import "@testing-library/jest-dom/vitest";
