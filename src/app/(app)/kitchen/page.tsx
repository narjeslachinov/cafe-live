"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveDot } from "@/components/live-dot";
import { useSession, type Role } from "@/components/session";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/client";
import { fmtNum, timeAgo } from "@/lib/format";
import { useLive } from "@/lib/use-live";

type Status = "new" | "preparing" | "ready" | "served";
type QItem = {
  id: string;
  order_id: string;
  table_label: string;
  name_snapshot: string;
  quantity: number;
  note: string | null;
  status: "new" | "preparing" | "ready";
  created_at: string;
};
type Queue = { cursor: number; items: QItem[] };
type Move = { to: Status; label: string; main?: boolean; roles: Role[] };

// A mirror of the server's table, only to decide which buttons to show.
// The server is the authority and rejects anything else.
const MOVES: Record<QItem["status"], Move[]> = {
  new: [{ to: "preparing", label: "شروع", main: true, roles: ["kitchen", "manager"] }],
  preparing: [
    { to: "ready", label: "آماده شد", main: true, roles: ["kitchen", "manager"] },
    { to: "new", label: "برگشت", roles: ["kitchen", "manager"] },
  ],
  ready: [
    { to: "served", label: "سرو شد", main: true, roles: ["kitchen", "waiter", "manager"] },
    { to: "preparing", label: "برگشت", roles: ["kitchen", "manager"] },
  ],
};

/** Keeps a kitchen tablet awake; a sleeping screen is a screen that stopped updating. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          const l = await navigator.wakeLock.request("screen");
          if (cancelled) void l.release();
          else lock = l;
        }
      } catch {
        // unsupported, or not a secure context: nothing to do
      }
    };
    void request();
    const onVisible = () => void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);
}

export default function KitchenPage() {
  const { role } = useSession();
  const toast = useToast();
  const { data, error, connected, reload } = useLive<Queue>("/api/kitchen/queue");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useWakeLock();
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, { orderId: string; table: string; items: QItem[] }>();
    for (const i of data?.items ?? []) {
      const g = m.get(i.order_id) ?? { orderId: i.order_id, table: i.table_label, items: [] };
      g.items.push(i);
      m.set(i.order_id, g);
    }
    return Array.from(m.values()); // oldest order first: the queue is sorted by time
  }, [data]);

  async function move(item: QItem, to: Status) {
    setBusyId(item.id);
    try {
      await api("POST", `/api/order-items/${item.id}/status`, { from: item.status, to });
    } catch (e) {
      toast(errorMessage(e), "error"); // a stale screen gets a 409 here; the reload below fixes it
    } finally {
      setBusyId(null);
      await reload();
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">صف آشپزخانه</h1>
        <LiveDot connected={connected} />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          به‌روزرسانی ناموفق بود؛ اطلاعات روی صفحه ممکن است قدیمی باشند.
        </p>
      )}
      {!data && !error && <p className="text-stone-500">در حال بارگذاری…</p>}
      {data && groups.length === 0 && (
        <p className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
          سفارشی در صف نیست.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.orderId} className="rounded-2xl border border-stone-200 bg-white">
            <header className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <h2 className="text-lg font-bold">میز {g.table}</h2>
              <span className="text-sm text-stone-500">{timeAgo(g.items[0].created_at, now)}</span>
            </header>
            <ul className="divide-y divide-stone-100">
              {g.items.map((i) => {
                const moves = MOVES[i.status].filter((m) => m.roles.includes(role));
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-semibold">
                        {fmtNum(i.quantity)}× {i.name_snapshot}
                      </div>
                      {i.note && (
                        <div className="mt-1 rounded bg-yellow-100 px-2 py-1 text-sm">
                          توضیح: {i.note}
                        </div>
                      )}
                    </div>
                    <StatusBadge status={i.status} />
                    <div className="flex gap-2">
                      {moves.map((m) => (
                        <button
                          key={m.to}
                          disabled={busyId === i.id}
                          onClick={() => move(i, m.to)}
                          className={
                            m.main
                              ? "min-h-12 rounded-xl bg-amber-600 px-5 font-semibold text-white"
                              : "min-h-12 rounded-xl border border-stone-300 px-3 text-sm"
                          }
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}