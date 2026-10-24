import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/server/auth";

export default async function MenuLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  if (!s || s.role !== "manager") redirect("/tables");
  return <>{children}</>;
}