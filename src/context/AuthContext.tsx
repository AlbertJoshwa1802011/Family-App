import {
  createContext,
  useContext,
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
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/auth/me"),
    // Auth state isn't worth retrying — a 401 should resolve to "logged out" fast.
    retry: false,
  });

  const value: AuthValue = {
    user: data?.user ?? null,
    families: data?.families ?? [],
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
