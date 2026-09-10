/**
 * Per-member module access (family-scoped).
 *
 * Role (owner/admin/member) stays the privilege ladder. Modules control which
 * product areas a member may open — set at invite time or later by admin+.
 *
 * Storage: `family_members.modules_json` / `invites.modules_json` as a JSON
 * array of enabled module ids. `null` means "all modules" (backward compatible).
 * Owners always have every module regardless of the stored value.
 */
import { z } from "zod";

export const FAMILY_MODULES = [
  "documents",
  "calendar",
  "tasks",
  "notes",
  "contacts",
  "chat",
  "expenses",
  "assistant",
  "location",
] as const;

export type FamilyModule = (typeof FAMILY_MODULES)[number];

export const familyModuleSchema = z.enum(FAMILY_MODULES);

/** Human labels + short copy for invite / access UI. */
export const MODULE_META: Record<
  FamilyModule,
  { label: string; description: string }
> = {
  documents: {
    label: "Vault",
    description: "Documents, uploads, and expiry reminders",
  },
  calendar: {
    label: "Calendar",
    description: "Events, RSVPs, and shared schedules",
  },
  tasks: {
    label: "Tasks",
    description: "To-dos, assignments, and due dates",
  },
  notes: {
    label: "Notes",
    description: "Family notebook and Bible notes",
  },
  contacts: {
    label: "Contacts",
    description: "Emergency and household contacts",
  },
  chat: {
    label: "Chat",
    description: "Family messages and @mentions",
  },
  expenses: {
    label: "Money",
    description: "Expenses, settlements, and balances",
  },
  assistant: {
    label: "Assistant",
    description: "In-app helper that can read and write for you",
  },
  location: {
    label: "Location",
    description: "Opt-in travel map, weekly km, and family sharing",
  },
};

export function isFamilyModule(value: string): value is FamilyModule {
  return (FAMILY_MODULES as readonly string[]).includes(value);
}

/** Parse stored JSON. Invalid / empty → all modules (safe default). */
export function parseModulesJson(raw: string | null | undefined): FamilyModule[] {
  if (raw == null || raw === "") return [...FAMILY_MODULES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...FAMILY_MODULES];
    const cleaned = parsed.filter(
      (m): m is FamilyModule => typeof m === "string" && isFamilyModule(m),
    );
    // Deduplicate while preserving order of FAMILY_MODULES.
    return FAMILY_MODULES.filter((m) => cleaned.includes(m));
  } catch {
    return [...FAMILY_MODULES];
  }
}

/** Serialize for DB. Full set → null (compact / default). */
export function serializeModules(modules: FamilyModule[] | null | undefined): string | null {
  if (modules == null) return null;
  const enabled = FAMILY_MODULES.filter((m) => modules.includes(m));
  if (enabled.length === FAMILY_MODULES.length) return null;
  return JSON.stringify(enabled);
}

export function hasModule(
  modulesJson: string | null | undefined,
  module: FamilyModule,
  role?: string,
): boolean {
  if (role === "owner") return true;
  return parseModulesJson(modulesJson).includes(module);
}

/** Zod for invite/PATCH bodies — optional list of enabled modules. */
export const modulesFieldSchema = z
  .array(familyModuleSchema)
  .max(FAMILY_MODULES.length)
  .optional();
