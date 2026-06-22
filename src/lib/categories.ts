import {
  BadgeCheck,
  BookMarked,
  Car,
  CreditCard,
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Plane,
  ShieldCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface DocCategory {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Predefined document categories. `id` is what we store in documents.category;
 * `other` is the catch-all (and the server default). Ordered roughly by how
 * commonly families need them.
 */
export const CATEGORIES: DocCategory[] = [
  { id: "passport", label: "Passport", icon: BookMarked },
  { id: "national_id", label: "ID card", icon: CreditCard },
  { id: "license", label: "License", icon: BadgeCheck },
  { id: "insurance", label: "Insurance", icon: ShieldCheck },
  { id: "vehicle", label: "Vehicle", icon: Car },
  { id: "property", label: "Property", icon: Home },
  { id: "medical", label: "Medical", icon: HeartPulse },
  { id: "education", label: "Education", icon: GraduationCap },
  { id: "finance", label: "Finance", icon: Landmark },
  { id: "warranty", label: "Warranty", icon: Wrench },
  { id: "travel", label: "Travel", icon: Plane },
  { id: "utility", label: "Utility", icon: Zap },
  { id: "other", label: "Other", icon: FileText },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryMeta(id: string | null | undefined): DocCategory {
  return (id && BY_ID.get(id)) || CATEGORIES[CATEGORIES.length - 1];
}
