import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { inputCls } from "../../lib/fieldCls";
import { api } from "../../lib/api";
import {
  BUILTIN_LABELS,
  EMOJI_PICKER,
  type FamilyLabel,
  type LabelDomain,
} from "../../lib/labels";

/**
 * Selectable type/category chips with emoji, plus "+ New" to create a
 * family-scoped custom label at runtime.
 *
 * `valueMode`:
 * - `slug` (default) — stores the stable slug on the entity (events, docs, …)
 * - `label` — stores the human label (contacts.relationship free text)
 */
export function TypePicker({
  domain,
  familyId,
  value,
  onChange,
  title = "Type",
  allowCreate = true,
  valueMode = "slug",
  className,
}: {
  domain: LabelDomain;
  familyId: string | undefined;
  value: string;
  onChange: (next: string) => void;
  title?: string;
  allowCreate?: boolean;
  valueMode?: "slug" | "label";
  className?: string;
}) {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(EMOJI_PICKER[0]);
  const [error, setError] = useState("");

  const { data } = useQuery({
    queryKey: ["labels", familyId, domain],
    queryFn: () =>
      api<{ labels: FamilyLabel[] }>(
        `/labels?familyId=${familyId}&domain=${domain}`,
      ),
    enabled: Boolean(familyId),
  });
  const labels = data?.labels ?? BUILTIN_LABELS[domain];

  const create = useMutation({
    mutationFn: () =>
      api<{ label: FamilyLabel }>("/labels", {
        method: "POST",
        body: JSON.stringify({
          familyId,
          domain,
          label: name.trim(),
          emoji,
        }),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["labels", familyId, domain] });
      onChange(valueMode === "label" ? res.label.label : res.label.slug);
      setSheetOpen(false);
      setName("");
      setEmoji(EMOJI_PICKER[0]);
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  function isSelected(l: FamilyLabel): boolean {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    if (valueMode === "label") {
      return l.label.toLowerCase() === v || l.slug.toLowerCase() === v;
    }
    return l.slug.toLowerCase() === v;
  }

  function pick(l: FamilyLabel) {
    onChange(valueMode === "label" ? l.label : l.slug);
  }

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!emoji) {
      setError("Pick an emoji");
      return;
    }
    setError("");
    create.mutate();
  }

  return (
    <div className={className}>
      {title ? (
        <p className="mb-2 text-xs font-semibold text-fg-muted">{title}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {labels.map((l) => (
          <Chip key={l.slug} selected={isSelected(l)} onClick={() => pick(l)}>
            <span aria-hidden="true" className="mr-1">
              {l.emoji}
            </span>
            {l.label}
          </Chip>
        ))}
        {allowCreate && familyId ? (
          <Chip
            type="button"
            selected={false}
            onClick={() => setSheetOpen(true)}
            className="border border-dashed border-white/20"
          >
            <Plus className="mr-1 inline size-3.5" aria-hidden="true" />
            New
          </Chip>
        ) : null}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setError("");
        }}
        title={`New ${title.toLowerCase()}`}
      >
        <form onSubmit={submitNew} className="space-y-4 pb-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-fg-muted">
              Name <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Family reunion"
              maxLength={40}
              autoFocus
              className={inputCls}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-fg-muted">Emoji</p>
            <div className="grid max-h-40 grid-cols-8 gap-1.5 overflow-y-auto pr-1">
              {EMOJI_PICKER.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-label={`Choose ${e}`}
                  aria-pressed={emoji === e}
                  className={`lq lq-flat lq-press flex size-9 items-center justify-center rounded-xl text-lg ${
                    emoji === e
                      ? "lq-primary text-white ring-2 ring-vault-400/70"
                      : "hover:bg-white/8"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              className="flex-1"
            >
              Add {emoji} {name.trim() || title.toLowerCase()}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSheetOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
