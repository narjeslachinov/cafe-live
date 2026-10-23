import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { SessionProvider } from "@/components/session";
import { ToastProvider } from "@/components/toast";
import { getSession } from "@/server/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <SessionProvider value={{ name: s.displayName, role: s.role }}>
      <ToastProvider>
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4">{children}</main>
      </ToastProvider>
    </SessionProvider>
  );
}