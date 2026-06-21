import { z } from "zod";

export interface ModuleDef {
  type: string;
  label: string;
  icon: string; // lucide icon name (string, not import)
  schema: z.ZodObject<z.ZodRawShape>;
  searchFields?: string[]; // keys from data to include in searchText
}

const subscriptionModule: ModuleDef = {
  type: "subscription",
  label: "Subscription",
  icon: "CreditCard",
  schema: z.object({
    vendor: z.string().min(1).max(100),
    renewalDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    amountCents: z.number().int().optional(),
    cycle: z.enum(["monthly", "yearly", "weekly", "one_time"]).optional(),
  }),
  searchFields: ["vendor"],
};

const warrantyModule: ModuleDef = {
  type: "warranty",
  label: "Warranty",
  icon: "ShieldCheck",
  schema: z.object({
    product: z.string().min(1).max(200),
    brand: z.string().max(100).optional(),
    purchaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    receiptUrl: z.string().url().optional(),
  }),
  searchFields: ["product", "brand"],
};

export const registry = new Map<string, ModuleDef>([
  ["subscription", subscriptionModule],
  ["warranty", warrantyModule],
]);

export function getModule(type: string): ModuleDef | undefined {
  return registry.get(type);
}

export function allModules(): ModuleDef[] {
  return Array.from(registry.values());
}
