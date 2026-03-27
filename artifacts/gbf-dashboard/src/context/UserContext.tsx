import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { fetchUsers, type UserRow } from "@/lib/api";

interface UserContextValue {
  currentUser: UserRow | null;
  users: UserRow[];
  setCurrentUser: (u: UserRow) => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextValue>({
  currentUser: null,
  users: [],
  setCurrentUser: () => {},
  isLoading: true,
});

const STORAGE_KEY = "gbf_current_user_id";

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers]           = useState<UserRow[]>([]);
  const [currentUser, _setCurrent]  = useState<UserRow | null>(null);
  const [isLoading, setIsLoading]   = useState(true);

  useEffect(() => {
    fetchUsers().then((rows) => {
      setUsers(rows);
      const savedId = Number(localStorage.getItem(STORAGE_KEY));
      const saved   = rows.find((u) => u.id === savedId);
      _setCurrent(saved ?? rows[0] ?? null);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  function setCurrentUser(u: UserRow) {
    _setCurrent(u);
    localStorage.setItem(STORAGE_KEY, String(u.id));
  }

  return (
    <UserContext.Provider value={{ currentUser, users, setCurrentUser, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
