import { FileText, Home, Shield, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
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
  { path: "/", label: "Home", icon: Home },
  { path: "/vault", label: "Vault", icon: Shield, matchPrefix: "/vault" },
  { path: "/documents", label: "Docs", icon: FileText, matchPrefix: "/documents" },
  { path: "/expenses", label: "Expenses", icon: Wallet, matchPrefix: "/expenses" },
  { path: "/family", label: "Family", icon: Users, matchPrefix: "/family" },
];
