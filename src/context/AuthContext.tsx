import {
  createContext,
  useCallback,
  useContext,
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
  /**
   * The family every page operates on. All list/create calls MUST scope to
   * activeFamily.id — the API requires familyId and enforces membership.
   * Defaults to the first membership; persisted so multi-family users keep
   * their selection across sessions.
   */
  activeFamily: Family | null;
  setActiveFamilyId: (id: string) => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const ACTIVE_FAMILY_KEY = "fv.activeFamilyId";

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/auth/me"),
    // Auth state isn't worth retrying — a 401 should resolve to "logged out" fast.
    retry: false,
  });

  const [storedFamilyId, setStoredFamilyId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_FAMILY_KEY),
  );

  const setActiveFamilyId = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_FAMILY_KEY, id);
    setStoredFamilyId(id);
  }, []);

  const families = data?.families ?? [];
  const activeFamily =
    families.find((f) => f.id === storedFamilyId) ?? families[0] ?? null;

  const value: AuthValue = {
    user: data?.user ?? null,
    families,
    activeFamily,
    setActiveFamilyId,
    isLoading,
    isAuthenticated: Boolean(data?.user),
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
