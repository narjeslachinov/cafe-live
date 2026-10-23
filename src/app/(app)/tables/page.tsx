"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LiveDot } from "@/components/live-dot";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/client";
import { fmtNum } from "@/lib/format";
import { useLive } from "@/lib/use-live";

type Table = {
  id: string;
  label: string;
  seats: number;
  order_id: string | null;
  item_count: number;
  ready_count: number;
};

export default function TablesPage() {
  const { data, error, connected } = useLive<{ tables: Table[] }>("/api/tables");
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);

  async function openTable(t: Table) {
    if (t.order_id) {
      router.push(`/orders/${t.order_id}`);
      return;
    }
    setOpening(t.id);
    try {
      // Idempotent on the server: if someone just opened it, we get their order back.
      const r = await api<{ order: { id: string } }>("POST", "/api/orders", { tableId: t.id });
      router.push(`/orders/${r.order.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setOpening(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">میزها</h1>
        <LiveDot connected={connected} />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          به‌روزرسانی ناموفق بود؛ اطلاعات روی صفحه ممکن است قدیمی باشند.
        </p>
      )}
      {!data && !error && <p className="text-stone-500">در حال بارگذاری…</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {data?.tables.map((t) => {
          const occupied = Boolean(t.order_id);
          return (
            <li key={t.id}>
              <button
                onClick={() => openTable(t)}
                disabled={opening === t.id}
                className={`flex min-h-28 w-full flex-col items-start justify-between rounded-2xl border p-4 text-start ${
                  t.ready_count > 0
                    ? "border-green-600 bg-green-50"
                    : occupied
                      ? "border-amber-400 bg-amber-50"
                      : "border-stone-200 bg-white"
                }`}
              >
                <span className="text-2xl font-bold">میز {t.label}</span>
                <span className="text-sm text-stone-600">
                  {occupied ? `باز · ${fmtNum(t.item_count)} آیتم` : "خالی"}
                </span>
                {t.ready_count > 0 && (
                  <span className="rounded-full bg-green-600 px-2.5 py-1 text-xs font-semibold text-white">
                    {fmtNum(t.ready_count)} آیتم آمادهٔ سرو
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}