import { Calendar, FileText, Home, Shield, Users } from "lucide-react";
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
 * Settings is reached via a gear icon in the header/rail, not a main tab.
 */
export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/vault", label: "Vault", icon: Shield, matchPrefix: "/vault" },
  { path: "/documents", label: "Docs", icon: FileText, matchPrefix: "/documents" },
  { path: "/calendar", label: "Calendar", icon: Calendar, matchPrefix: "/calendar" },
  { path: "/family", label: "Family", icon: Users, matchPrefix: "/family" },
];
