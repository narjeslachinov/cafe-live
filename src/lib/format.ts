export const fmtNum = (n: number) => n.toLocaleString("fa-IR");
export const fmtToman = (n: number) => `${fmtNum(n)} تومان`;

/** Clamped at zero: a tablet clock that runs behind must not show "-2 minutes". */
export function timeAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "هم‌اکنون";
  if (mins < 60) return `${fmtNum(mins)} دقیقه پیش`;
  return `${fmtNum(Math.floor(mins / 60))} ساعت پیش`;
}

export const STATUS_LABEL: Record<string, string> = {
  new: "جدید",
  preparing: "در حال آماده‌سازی",
  ready: "آماده",
  served: "سرو شد",
  cancelled: "لغو شد",
};