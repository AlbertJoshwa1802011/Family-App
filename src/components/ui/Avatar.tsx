import { cn } from "../../lib/cn";

function initials(name?: string | null, email?: string | null) {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase() || src[0]?.toUpperCase() || "?";
}

export function Avatar({
  name,
  email,
  src,
  className,
}: {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  className?: string;
}) {
  const base = cn(
    "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
    className,
  );
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? "avatar"}
        className={cn(
          base,
          "object-cover shadow-[0_0_0_1px_#ffffff26,0_6px_18px_-10px_#000d]",
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        base,
        "lq lq-tint text-vault-200 [--lq-tint:var(--color-vault-400)]",
      )}
      aria-hidden="true"
    >
      {initials(name, email)}
    </span>
  );
}
