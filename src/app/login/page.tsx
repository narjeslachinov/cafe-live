"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: { role: string } }>("POST", "/api/auth/login", {
        email,
        password,
      });
      window.location.href = r.user.role === "kitchen" ? "/kitchen" : "/tables";
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-bold text-amber-700">سفارش‌یار</h1>
      <p className="mb-6 text-sm text-stone-600">برای ادامه وارد شوید.</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          ایمیل
          <input
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-start"
          />
        </label>
        <label className="block text-sm">
          رمز عبور
          <input
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-start"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-amber-600 font-semibold text-white"
        >
          {busy ? "در حال ورود…" : "ورود"}
        </button>
      </form>
    </main>
  );
}