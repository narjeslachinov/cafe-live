"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import { useSession } from "./session";

const ROLE_LABEL = { waiter: "گارسون", kitchen: "آشپزخانه", manager: "مدیر" } as const;

export function Header() {
  const { name, role } = useSession();
  const path = usePathname();

  const links = [
    ...(role !== "kitchen"
      ? [{ href: "/tables", label: "میزها", match: ["/tables", "/orders"] }]
      : []),
    ...(role === "manager"
       ? [{ href: "/menu", label: "منو", match: ["/menu"] }] 
       : []),
    { href: "/kitchen", label: "آشپزخانه", match: ["/kitchen"] },
  ];

  async function logout() {
    try {
      await api("POST", "/api/auth/logout", {});
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <span className="font-bold text-amber-700">سفارش‌یار</span>
        <nav className="flex gap-1">
          {links.map((l) => {
            const active = l.match.some((m) => path.startsWith(m));
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${
                  active ? "bg-amber-100 font-semibold text-amber-900" : "text-stone-600"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ms-auto flex items-center gap-2 text-sm text-stone-600">
          <span className="hidden sm:inline">
            {name} · {ROLE_LABEL[role]}
          </span>
          <button onClick={logout} className="rounded-lg border border-stone-300 px-3 py-2">
            خروج
          </button>
        </div>
      </div>
    </header>
  );
}