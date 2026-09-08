import {
  FAMILY_MODULES,
  MODULE_META,
  type FamilyModule,
} from "../lib/modules";

/**
 * Checklist of modules for invite + member-access editors.
 * One job: pick which areas this person can use.
 */
export function ModuleAccessPicker({
  value,
  onChange,
  disabled,
  locked,
}: {
  value: FamilyModule[];
  onChange: (next: FamilyModule[]) => void;
  disabled?: boolean;
  /** When true (owner), all modules stay on and controls are read-only. */
  locked?: boolean;
}) {
  function toggle(id: FamilyModule) {
    if (disabled || locked) return;
    if (value.includes(id)) {
      onChange(value.filter((m) => m !== id));
    } else {
      onChange(FAMILY_MODULES.filter((m) => m === id || value.includes(m)));
    }
  }

  function setAll(on: boolean) {
    if (disabled || locked) return;
    onChange(on ? [...FAMILY_MODULES] : []);
  }

  const allOn = value.length === FAMILY_MODULES.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg-muted">What they can use</p>
        {!locked && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAll(!allOn)}
            className="text-[11px] font-semibold text-vault-300 hover:text-vault-200"
          >
            {allOn ? "Clear all" : "Enable all"}
          </button>
        )}
      </div>
      {locked && (
        <p className="text-xs text-fg-subtle">
          Owners always have every module.
        </p>
      )}
      <ul className="lq lq-flat divide-y divide-white/8 overflow-hidden rounded-2xl">
        {FAMILY_MODULES.map((id) => {
          const on = locked || value.includes(id);
          const meta = MODULE_META[id];
          return (
            <li key={id}>
              <button
                type="button"
                disabled={disabled || locked}
                onClick={() => toggle(id)}
                className="lq-press flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">
                    {meta.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">
                    {meta.description}
                  </span>
                </span>
                <span
                  role="switch"
                  aria-checked={on}
                  className={`relative h-7 w-11 shrink-0 rounded-full transition-colors ${
                    on ? "lq lq-primary" : "lq lq-field"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] ${
                      on ? "left-[1.125rem]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
