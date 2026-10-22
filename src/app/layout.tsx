import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazir = Vazirmatn({ subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: "سفارش‌ یار",
  description: "سفارش زنده برای کافه‌رستوران‌ها",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className={vazir.className}>{children}</body>
    </html>
  );
}