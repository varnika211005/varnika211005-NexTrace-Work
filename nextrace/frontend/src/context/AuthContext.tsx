import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api, storeAuth, clearAuth, getStoredUser, isLoggedIn } from "../api/client";

interface UserInfo {
  analyst_id: string;
  name: string;
  role: "investigator" | "admin_investigator";
}

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  isAdmin: boolean;
  login: (analystId: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(getStoredUser() as UserInfo | null);
  const [loading, setLoading] = useState(isLoggedIn());

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((data) => setUser({ analyst_id: data.analyst_id, name: data.name, role: data.role }))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(analystId: string, password: string) {
    const result = await api.login(analystId, password);
    storeAuth(result.token, result.user);
    setUser(result.user as UserInfo);
  }

  function logout() {
    clearAuth();
    setUser(null);
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin: user?.role === "admin_investigator", login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
