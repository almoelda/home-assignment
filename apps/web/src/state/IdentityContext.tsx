import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Identity =
  | { role: "advertiser"; id: number; label: string }
  | { role: "creator"; id: number; label: string };

const STORAGE_KEY = "marketplace:identity";

interface IdentityContextValue {
  identity: Identity | null;
  setIdentity: (identity: Identity | null) => void;
}

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined);

function readStoredIdentity(): Identity | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

/**
 * No auth (brief: "The user picks who they're acting as"). The chosen identity is purely a
 * client-side convenience persisted in localStorage — the API treats X-Actor-Role/X-Actor-Id
 * headers as soft hints, not security (IMPLEMENTATION_PLAN.md §5), which is made explicit in
 * the README.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<Identity | null>(() => readStoredIdentity());

  useEffect(() => {
    if (identity) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [identity]);

  const value = useMemo(() => ({ identity, setIdentity: setIdentityState }), [identity]);

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used within an IdentityProvider");
  return ctx;
}
