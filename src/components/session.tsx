"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Role = "waiter" | "kitchen" | "manager";
type SessionInfo = { name: string; role: Role };

const Ctx = createContext<SessionInfo | null>(null);

export function SessionProvider({ value, children }: { value: SessionInfo; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionInfo {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession used outside SessionProvider");
  return v;
}