"use client";

/* ============================================================
   Auth state. The session itself lives in an httpOnly cookie the
   backend sets — this context only mirrors who that cookie belongs
   to, so nothing sensitive is held in JS.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthUser,
} from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial "who am I" check settles — lets the navbar avoid
   *  flashing "Sign in" at someone who is already signed in. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    fullName: string;
    phoneNumber?: string;
    email: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Ask the backend once on boot. The cookie is httpOnly, so this is the only
  // way the client can know whether a session exists.
  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => !cancelled && setUser(u))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await apiLogin(email, password));
  }, []);

  const signUp = useCallback(
    async (input: { fullName: string; phoneNumber?: string; email: string; password: string }) => {
      setUser(await apiRegister(input));
    },
    [],
  );

  const signOut = useCallback(async () => {
    // Clear locally even if the request fails — a user who clicked "log out"
    // should never still look signed in.
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
