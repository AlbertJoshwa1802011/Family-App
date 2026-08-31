import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  isPlatformAdmin?: boolean;
}

export interface Family {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
}

interface MeResponse {
  user: User | null;
  families: Family[];
}

interface AuthValue {
  user: User | null;
  families: Family[];
  isLoading: boolean;
  isAuthenticated: boolean;
  /** The family every family-scoped query should target. Null until /auth/me resolves. */
  activeFamily: Family | null;
  activeFamilyId: string | null;
  setActiveFamilyId: (id: string) => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

const ACTIVE_FAMILY_KEY = "fv:activeFamilyId";

function readStoredFamilyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_FAMILY_KEY);
  } catch {
    // Private mode / storage disabled — fall back to the first family.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/auth/me"),
    // Auth state isn't worth retrying — a 401 should resolve to "logged out" fast.
    retry: false,
  });

  const families = useMemo(() => data?.families ?? [], [data?.families]);
  const [storedId, setStoredId] = useState<string | null>(readStoredFamilyId);

  const setActiveFamilyId = useCallback((id: string) => {
    setStoredId(id);
    try {
      localStorage.setItem(ACTIVE_FAMILY_KEY, id);
    } catch {
      // Non-fatal: selection just won't survive a reload.
    }
  }, []);

  // Resolve the stored id against the memberships we actually have. A stale id
  // (family left or deleted) must not strand the user on a family they can't
  // read, so fall back to the first membership. The stored value is only a
  // preference — it is written when the user actually picks a family, never
  // healed from an effect.
  const activeFamily =
    families.find((f) => f.id === storedId) ?? families[0] ?? null;

  const value: AuthValue = {
    user: data?.user ?? null,
    families,
    isLoading,
    isAuthenticated: Boolean(data?.user),
    activeFamily,
    activeFamilyId: activeFamily?.id ?? null,
    setActiveFamilyId,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
