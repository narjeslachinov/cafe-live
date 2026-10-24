"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/client";
import { fmtToman, parseToman } from "@/lib/format";
import { useLive } from "@/lib/use-live";

type Item = { id: string; name: string; description: string | null; price_toman: number; is_available: boolean };
type Menu = { categories: { id: string; name: string; items: Item[] }[] };

export default function ManageMenuPage() {
  const { data, error, reload } = useLive<Menu>("/api/manage/menu");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [priceText, setPriceText] = useState("");

  async function patch(item: Item, body: { price_toman?: number; is_available?: boolean }) {
    setBusy(item.id);
    try {
      await api("POST", `/api/manage/menu-items/${item.id}`, body);
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(null);
      await reload();
    }
  }

  const newPrice = parseToman(priceText);
  const priceOk = newPrice !== null && newPrice >= 1000 && newPrice <= 100_000_000;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">منو</h1>
        <Link href="/menu/import" className="min-h-11 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white">
          ورود منو از متن
        </Link>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</p>}
      {!data && !error && <p className="text-stone-500">در حال بارگذاری…</p>}

      <div className="space-y-5">
        {data?.categories.map((c) => (
          <section key={c.id}>
            <h2 className="mb-2 font-bold text-stone-700">{c.name}</h2>
            <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
              {c.items.length === 0 && <li className="p-4 text-sm text-stone-500">آیتمی ندارد.</li>}
              {c.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold ${i.is_available ? "" : "text-stone-400 line-through"}`}>{i.name}</div>
                    {i.description && <div className="text-sm text-stone-500">{i.description}</div>}
                  </div>
                  <button
                    onClick={() => { setEditing(i); setPriceText(String(i.price_toman)); }}
                    className="min-h-11 rounded-xl border border-stone-300 px-3 text-sm"
                    aria-label={`ویرایش قیمت ${i.name}`}
                  >
                    {fmtToman(i.price_toman)}
                  </button>
                  <button
                    disabled={busy === i.id}
                    onClick={() => patch(i, { is_available: !i.is_available })}
                    aria-pressed={!i.is_available}
                    className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
                      i.is_available ? "border border-red-300 text-red-700" : "bg-green-600 text-white"
                    }`}
                  >
                    {i.is_available ? "تمام شد" : "دوباره موجود"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {editing && (
        <Sheet title={`قیمت ${editing.name}`} onClose={() => setEditing(null)}>
          <label className="mb-2 block text-sm">
            قیمت (تومان)
            <input
              dir="ltr"
              inputMode="numeric"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-stone-300 px-3 text-start"
            />
          </label>
          <p className="mb-4 text-sm text-stone-600">
            {priceOk ? fmtToman(newPrice!) : "قیمت باید عددی بین ۱٬۰۰۰ و ۱۰۰ میلیون تومان باشد."}
            <br />
            سفارش‌های ثبت‌شده با همان قیمت قبلی می‌مانند.
          </p>
          <div className="flex gap-2">
            <button
              disabled={!priceOk}
              onClick={async () => { if (await patch(editing, { price_toman: newPrice! })) setEditing(null); }}
              className="min-h-12 flex-1 rounded-xl bg-amber-600 font-semibold text-white"
            >
              ذخیره
            </button>
            <button onClick={() => setEditing(null)} className="min-h-12 rounded-xl border border-stone-300 px-4">انصراف</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}