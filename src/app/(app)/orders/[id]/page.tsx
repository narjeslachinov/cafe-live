"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LiveDot } from "@/components/live-dot";
import { Sheet } from "@/components/sheet";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
import { api, ApiError, errorMessage, uuid } from "@/lib/client";
import { fmtNum, fmtToman } from "@/lib/format";
import { useLive } from "@/lib/use-live";
import { useSession } from "@/components/session";

type Item = {
  id: string;
  name_snapshot: string;
  unit_price_toman: number;
  quantity: number;
  note: string | null;
  status: string;
};
type OrderData = {
  order: { id: string; table_label: string; status: string };
  items: Item[];
  total_toman: number;
};
type MenuItem = { id: string; name: string; description: string | null; price_toman: number };
type Menu = { categories: { id: string; name: string; items: MenuItem[] }[] };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { role } = useSession();
  const { data, error, connected, reload } = useLive<OrderData>(`/api/orders/${id}`);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<MenuItem | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Menu>("GET", "/api/menu")
      .then((m) => {
        if (!alive) return;
        setMenu(m);
        setCat(m.categories[0]?.id ?? null);
      })
      .catch((e) => toast(errorMessage(e), "error"));
    return () => {
      alive = false;
    };
  }, [toast]);

  async function act(itemId: string, call: () => Promise<unknown>) {
    setBusyId(itemId);
    try {
      await call();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
      await reload();
    }
  }

  async function closeTable() {
    try {
      await api("POST", `/api/orders/${id}/close`, {});
      router.push("/tables");
    } catch (e) {
      toast(errorMessage(e), "error");
      setConfirmClose(false);
      void reload();
    }
  }
  async function forceClose() {
    try {
      await api("POST", `/api/orders/${id}/force-close`, {});
      router.push("/tables");
    } catch (e) {
      toast(errorMessage(e), "error");
      setConfirmClose(false);
      void reload();
    }
  }

  if (error?.status === 404) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4">سفارش پیدا نشد.</p>
        <Link href="/tables" className="text-amber-700 underline">
          بازگشت به میزها
        </Link>
      </div>
    );
  }
  if (!data) {
    return <p className="text-stone-500">{error ? errorMessage(error) : "در حال بارگذاری…"}</p>;
  }

  const open = data.order.status === "open";
  const visibleMenu = menu?.categories.find((c) => c.id === cat)?.items ?? [];
  const toServe = data.items.filter((i) => i.status === "ready").length;
  const toCancel = data.items.filter((i) => i.status === "new" || i.status === "preparing").length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/tables" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
            ← میزها
          </Link>
          <h1 className="text-xl font-bold">میز {data.order.table_label}</h1>
        </div>
        <LiveDot connected={connected} />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          به‌روزرسانی ناموفق بود؛ اطلاعات روی صفحه ممکن است قدیمی باشند.
        </p>
      )}
      {!open && (
        <p className="mb-3 rounded-lg bg-stone-200 px-3 py-2 text-sm">این سفارش بسته شده است.</p>
      )}

      <section aria-label="آیتم‌های سفارش" className="mb-6 rounded-2xl border border-stone-200 bg-white">
        {data.items.length === 0 ? (
          <p className="p-4 text-stone-500">هنوز آیتمی ثبت نشده. از منوی پایین اضافه کنید.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className={`font-semibold ${i.status === "cancelled" ? "text-stone-400 line-through" : ""}`}>
                    {fmtNum(i.quantity)}× {i.name_snapshot}
                  </div>
                  <div className="text-sm text-stone-500">
                    {fmtToman(i.unit_price_toman * i.quantity)}
                  </div>
                  {i.note && <div className="mt-1 text-sm text-stone-700">توضیح: {i.note}</div>}
                </div>
                <StatusBadge status={i.status} />
                {open && i.status === "new" && (
                  <button
                    disabled={busyId === i.id}
                    onClick={() => act(i.id, () => api("POST", `/api/order-items/${i.id}/cancel`, {}))}
                    className="min-h-11 rounded-xl border border-red-300 px-3 text-sm text-red-700"
                  >
                    لغو
                  </button>
                )}
                {open && i.status === "ready" && (
                  <button
                    disabled={busyId === i.id}
                    onClick={() =>
                      act(i.id, () =>
                        api("POST", `/api/order-items/${i.id}/status`, { from: "ready", to: "served" }),
                      )
                    }
                    className="min-h-11 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white"
                  >
                    سرو شد
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-stone-200 p-4 font-bold">
          <span>جمع</span>
          <span>{fmtToman(data.total_toman)}</span>
        </div>
      </section>

      {open && (
        <section aria-label="منو">
          <h2 className="mb-2 font-bold">افزودن آیتم</h2>
          {!menu && <p className="text-stone-500">در حال بارگذاری منو…</p>}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {menu?.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                aria-pressed={cat === c.id}
                className={`min-h-11 whitespace-nowrap rounded-full px-4 text-sm ${
                  cat === c.id ? "bg-amber-600 text-white" : "border border-stone-300 bg-white"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {visibleMenu.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setPicked(m)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-start"
                >
                  <span>
                    <span className="block font-semibold">{m.name}</span>
                    {m.description && (
                      <span className="block text-sm text-stone-500">{m.description}</span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-sm text-stone-700">
                    {fmtToman(m.price_toman)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-5xl">
            <button
              onClick={() => setConfirmClose(true)}
              className="min-h-12 w-full rounded-xl border border-stone-400 font-semibold"
            >
              بستن میز
            </button>
          </div>
        </div>
      )}

      {picked && (
        <AddSheet
          item={picked}
          orderId={id}
          onClose={() => setPicked(null)}
          onAdded={() => {
            setPicked(null);
            toast("به سفارش اضافه شد");
            void reload();
          }}
        />
      )}

      {confirmClose && (
        <Sheet title="میز بسته شود؟" onClose={() => setConfirmClose(false)}>
          <p className="mb-4 text-sm text-stone-600">
            فقط وقتی همهٔ آیتم‌ها سرو یا لغو شده‌اند میز بسته می‌شود.
          </p>
          {role === "manager" && toServe + toCancel > 0 && (
            <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm">
              <p className="mb-2">
                {fmtNum(toServe + toCancel)} آیتم هنوز تمام نشده است. با «بستن اجباری»، {fmtNum(toServe)} آیتم آماده «سرو شده» و {fmtNum(toCancel)} آیتم دیگر «لغو» می‌شوند. این کار قابل‌برگشت نیست.
              </p>
              <button onClick={forceClose} className="min-h-11 w-full rounded-xl border border-red-400 font-semibold text-red-700">
                بستن اجباری
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={closeTable}
              className="min-h-12 flex-1 rounded-xl bg-amber-600 font-semibold text-white"
            >
              بله، ببند
            </button>
            <button
              onClick={() => setConfirmClose(false)}
              className="min-h-12 flex-1 rounded-xl border border-stone-300"
            >
              انصراف
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function AddSheet({
  item,
  orderId,
  onClose,
  onAdded,
}: {
  item: MenuItem;
  orderId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Outcome unknown (network/5xx): keep the same id AND freeze the fields, so a
  // retry is exactly the same request and can never create a second item.
  const [locked, setLocked] = useState(false);
  const [requestId, setRequestId] = useState(uuid);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("POST", `/api/orders/${orderId}/items`, {
        requestId,
        menuItemId: item.id,
        quantity: qty,
        note: note.trim() || undefined,
      });
      onAdded();
    } catch (e) {
      setErr(errorMessage(e));
      if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) setLocked(true);
      else setRequestId(uuid()); // definite refusal: nothing was created, a fresh id is safe
      setBusy(false);
    }
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="mb-4 flex items-center justify-center gap-4">
        <button
          aria-label="کم کردن"
          disabled={locked || busy || qty <= 1}
          onClick={() => setQty((q) => q - 1)}
          className="h-12 w-12 rounded-full border border-stone-300 text-2xl"
        >
          −
        </button>
        <span className="min-w-10 text-center text-2xl font-bold">{fmtNum(qty)}</span>
        <button
          aria-label="زیاد کردن"
          disabled={locked || busy || qty >= 50}
          onClick={() => setQty((q) => q + 1)}
          className="h-12 w-12 rounded-full border border-stone-300 text-2xl"
        >
          +
        </button>
      </div>

      <label className="mb-4 block text-sm">
        توضیح (اختیاری)
        <textarea
          value={note}
          maxLength={200}
          disabled={locked || busy}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-stone-300 p-3"
        />
      </label>

      {err && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
          {locked && " با زدن «تلاش دوباره» آیتم دوبار ثبت نمی‌شود."}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="min-h-12 flex-1 rounded-xl bg-amber-600 font-semibold text-white"
        >
          {busy
            ? "در حال ثبت…"
            : locked
              ? "تلاش دوباره"
              : `افزودن · ${fmtToman(item.price_toman * qty)}`}
        </button>
        <button onClick={onClose} className="min-h-12 rounded-xl border border-stone-300 px-4">
          بستن
        </button>
      </div>
    </Sheet>
  );
}