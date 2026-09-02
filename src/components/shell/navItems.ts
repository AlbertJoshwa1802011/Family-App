import { FileText, Home, Shield, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** CSS color for the active bubble and icon. */
  color: string;
  /** If set, the nav item is active when location.pathname starts with this prefix. */
  matchPrefix?: string;
}

/**
 * Single source of truth for primary navigation destinations.
 *
 * Five tabs is the mobile ceiling. Calendar, Tasks, Contacts, Notifications and
 * Settings are reached from the account menu (see components/AccountMenu.tsx),
 * which keeps the tab bar to the destinations used daily.
 */
export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Home", icon: Home, color: "#f59e0b" },
  { path: "/vault", label: "Vault", icon: Shield, color: "#a855f7", matchPrefix: "/vault" },
  { path: "/documents", label: "Docs", icon: FileText, color: "#38bdf8", matchPrefix: "/documents" },
  { path: "/money", label: "Money", icon: Wallet, color: "#22c55e", matchPrefix: "/money" },
  { path: "/family", label: "Family", icon: Users, color: "#f472b6", matchPrefix: "/family" },
];
