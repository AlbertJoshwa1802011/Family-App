/**
 * Frontend mirror of worker/lib/modules.ts — keep labels in sync.
 * Enabled-module lists come from /auth/me (activeFamily.modules).
 */
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

/** Route prefix → module (for deep-link guards). */
export const ROUTE_MODULE: Array<{ prefix: string; module: FamilyModule }> = [
  { prefix: "/documents", module: "documents" },
  { prefix: "/calendar", module: "calendar" },
  { prefix: "/tasks", module: "tasks" },
  { prefix: "/notes", module: "notes" },
  { prefix: "/contacts", module: "contacts" },
  { prefix: "/chat", module: "chat" },
  { prefix: "/expenses", module: "expenses" },
  { prefix: "/assistant", module: "assistant" },
  { prefix: "/locations", module: "location" },
];

export function hasModuleAccess(
  modules: FamilyModule[] | undefined | null,
  module: FamilyModule,
  role?: string,
): boolean {
  if (role === "owner") return true;
  if (!modules || modules.length === 0) {
    // Empty array = explicitly none. Undefined/null treated as all (legacy).
    if (modules && modules.length === 0) return false;
    return true;
  }
  return modules.includes(module);
}

export function moduleForPath(pathname: string): FamilyModule | null {
  for (const { prefix, module } of ROUTE_MODULE) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module;
  }
  return null;
}
