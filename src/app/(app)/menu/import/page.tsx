"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/client";
import { fmtNum, fmtToman, parseToman } from "@/lib/format";
import { useSession } from "@/components/session";

type DraftItem = {
  category: string; name: string; description: string | null; price_toman: number | null; flags: string[];
};
type Draft = { source: "rules" | "ai"; notice: string | null; items: DraftItem[]; ignored_lines: string[] };
type Row = {
  key: number; include: boolean; category: string; name: string; description: string; price: string; flags: string[];
};

const MAX_TEXT = 6000;

const FLAG_TEXT: Record<string, string> = {
  price_unit_guessed: "قیمت را به هزار تومان حدس زدیم. درستی‌اش را بررسی کنید.",
  price_low: "قیمت خیلی کم است؛ شاید به هزار تومان نوشته شده.",
  price_high: "قیمت خیلی زیاد است؛ شاید ریال است.",
  price_missing: "قیمت پیدا نشد. خودتان وارد کنید.",
  price_unparsed: "قیمت خوانده نشد. خودتان وارد کنید.",
  name_long: "نام طولانی است؛ شاید چند آیتم در یک خط بوده.",
  already_on_menu: "این نام از قبل در منو هست و ثبت نمی‌شود.",
  duplicate_in_draft: "در همین متن تکرار شده است.",
};

const NOTICE_TEXT: Record<string, string> = {
  ai_disabled: "متن با قواعد ساده خوانده شد (هوش مصنوعی فعال نیست). موارد را با دقت بررسی کنید.",
  ai_failed: "سرویس هوش مصنوعی پاسخ نداد؛ نتیجهٔ خواندن ساده نشان داده می‌شود و ممکن است ناقص باشد.",
  ai_invalid: "پاسخ هوش مصنوعی معتبر نبود؛ نتیجهٔ خواندن ساده نشان داده می‌شود.",
  nothing_found: "هیچ آیتمی پیدا نشد. هر خط را به شکل «نام - قیمت» بنویسید، یا «تحلیل با هوش مصنوعی» را امتحان کنید.",
};

const rowPrice = (r: Row) => parseToman(r.price);
const rowValid = (r: Row) => {
  const p = rowPrice(r);
  return r.name.trim().length > 0 && r.name.length <= 100 && r.category.trim().length > 0 &&
    r.category.length <= 60 && p !== null && p >= 1000 && p <= 100_000_000;
};

export default function ImportPage() {
    const router = useRouter();
    const toast = useToast();
    const { role } = useSession();
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [rows, setRows] = useState<Row[]>([]);

  async function analyze(mode: "auto" | "ai") {
    setBusy(true);
    try {
      const d = await api<Draft>("POST", "/api/manage/menu-import/draft", { text, mode });
      setDraft(d);
      setRows(
        d.items.map((i, k) => ({
          key: k,
          include: !i.flags.includes("already_on_menu") && !i.flags.includes("duplicate_in_draft"),
          category: i.category,
          name: i.name,
          description: i.description ?? "",
          price: i.price_toman === null ? "" : String(i.price_toman),
          flags: i.flags,
        })),
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const selected = rows.filter((r) => r.include);
  const allValid = selected.length > 0 && selected.every(rowValid);

  async function commit() {
    setBusy(true);
    try {
      const r = await api<{ created: number; skipped: string[] }>("POST", "/api/manage/menu-import/commit", {
        items: selected.map((x) => ({
          category: x.category.trim(),
          name: x.name.trim(),
          description: x.description.trim() || null,
          price_toman: rowPrice(x)!,
        })),
      });
      toast(`${fmtNum(r.created)} آیتم اضافه شد${r.skipped.length ? `، ${fmtNum(r.skipped.length)} مورد تکراری رد شد` : ""}`);
      router.push("/menu");
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <Link href="/menu" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">← منو</Link>
          <h1 className="text-xl font-bold">ورود منو از متن</h1>
        </div>
        <p className="mb-3 text-sm text-stone-600">
          متن منو را اینجا بچسبانید. هر آیتم یک خط، مثل «لاته - ۱۸۵٬۰۰۰». چیزی ذخیره نمی‌شود تا شما همه‌چیز را ببینید و تأیید کنید.
          فقط خود متن منو برای تحلیل استفاده می‌شود، نه اطلاعات سفارش یا مشتری.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          maxLength={MAX_TEXT}
          className="mb-1 w-full rounded-xl border border-stone-300 bg-white p-3"
          placeholder={"نوشیدنی گرم\nلاته - ۱۸۵٬۰۰۰\nچای ماسالا ۱۴۰ هزار تومان\n\nدسر\nچیزکیک ........ ۲۲۰"}
        />
        <p className="mb-4 text-xs text-stone-500">{fmtNum(text.length)} از {fmtNum(MAX_TEXT)} نویسه</p>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || text.trim().length < 3}
            onClick={() => analyze("auto")}
            className="min-h-12 rounded-xl bg-amber-600 px-5 font-semibold text-white"
          >
            {busy ? "در حال تحلیل…" : "تحلیل متن"}
          </button>
          <button
            disabled={busy || text.trim().length < 3}
            onClick={() => analyze("ai")}
            className="min-h-12 rounded-xl border border-stone-400 px-5"
          >
            تحلیل با هوش مصنوعی
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => setDraft(null)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
          ← ویرایش متن
        </button>
        <h1 className="text-xl font-bold">بررسی پیش‌نویس</h1>
      </div>

      <p className="mb-2 text-sm">
        منبع: <strong>{draft.source === "ai" ? "هوش مصنوعی" : "خواندن ساده"}</strong>. هیچ‌چیز تا زدن «ثبت» ذخیره نمی‌شود.
      </p>
      {draft.notice && (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{NOTICE_TEXT[draft.notice]}</p>
      )}
      {draft.ignored_lines.length > 0 && (
        <details className="mb-3 text-sm text-stone-600">
          <summary>{fmtNum(draft.ignored_lines.length)} خط خوانده نشد</summary>
          <ul className="mt-1 list-disc ps-5">{draft.ignored_lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
        </details>
      )}

      <ul className="space-y-3">
        {rows.map((r) => {
          const p = rowPrice(r);
          const bad = r.include && !rowValid(r);
          return (
            <li key={r.key} className={`rounded-2xl border bg-white p-3 ${bad ? "border-red-400" : "border-stone-200"}`}>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} className="h-5 w-5" />
                ثبت شود
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label="نام" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className="min-h-11 rounded-xl border border-stone-300 px-3" />
                <input aria-label="دسته" value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} className="min-h-11 rounded-xl border border-stone-300 px-3" />
                <input aria-label="توضیح" placeholder="توضیح (اختیاری)" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="min-h-11 rounded-xl border border-stone-300 px-3" />
                <div>
                  <input aria-label="قیمت به تومان" dir="ltr" inputMode="numeric" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} className="min-h-11 w-full rounded-xl border border-stone-300 px-3 text-start" />
                  <div className="mt-1 text-xs text-stone-600">{p !== null ? fmtToman(p) : "قیمت وارد نشده"}</div>
                </div>
              </div>
              {r.flags.map((f) => FLAG_TEXT[f] && (
                <p key={f} className="mt-2 rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-900">{FLAG_TEXT[f]}</p>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-5xl">
          <button
            disabled={busy || !allValid}
            onClick={commit}
            className="min-h-12 w-full rounded-xl bg-amber-600 font-semibold text-white"
          >
            {allValid ? `ثبت ${fmtNum(selected.length)} آیتم` : "همهٔ موارد انتخاب‌شده باید نام، دسته و قیمت معتبر داشته باشند"}
          </button>
        </div>
      </div>
    </div>
  );
}