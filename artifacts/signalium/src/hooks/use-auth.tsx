import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  googleId: string | null;
  createdAt: string;
  [key: string]: unknown;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  refetch: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const data = await customFetch<{ user: AuthUser }>("/api/auth/me", { method: "GET" });
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const signOut = useCallback(async () => {
    try {
      await customFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoaded, isSignedIn: !!user, refetch, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Drop-in replacement for the old `useUser()` from `@clerk/react`. */
export function useUser(): { user: AuthUser | null; isLoaded: boolean; isSignedIn: boolean } {
  const { user, isLoaded, isSignedIn } = useAuth();
  return { user, isLoaded, isSignedIn };
}
