import { cn } from "./cn";

/**
 * Recessed liquid-glass field class. `lq-field` inverts the specular recipe —
 * the highlight pools at the bottom instead of the top — so inputs read as
 * carved into the surface while cards and buttons float above it.
 *
 * Lives here rather than beside the `Input` component so pages can apply it to
 * bespoke `<input>`s without pulling components through a hot-reload boundary.
 */
export const inputCls = cn(
  "lq lq-field w-full rounded-2xl px-4 py-3 text-sm text-fg",
  "placeholder:text-fg-subtle focus:outline-none",
  // native date/time pickers draw their glyphs from the colour scheme
  "[color-scheme:dark]",
  "transition-shadow duration-300",
);
