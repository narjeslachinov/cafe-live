export class ApiError extends Error {
  constructor(
    public status: number, // 0 = the request never got an answer
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public requestId?: string,
  ) {
    super(message);
  }
}

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
};

export async function api<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "network error");
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {}

  if (!res.ok) {
    const e = (json as ErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "error",
      e?.message ?? "error",
      e?.details,
      e?.requestId,
    );
  }
  return json as T;
}

const MESSAGES: Record<string, string> = {
  network: "ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.",
  invalid_credentials: "ایمیل یا رمز عبور درست نیست.",
  rate_limited: "تلاش‌های زیاد. چند دقیقه بعد دوباره امتحان کنید.",
  multiple_memberships: "این حساب برای ورود در دسترس نیست.",
  unauthenticated: "نشست شما تمام شده است. دوباره وارد شوید.",
  forbidden: "اجازهٔ این کار را ندارید.",
  invalid_input: "اطلاعات واردشده درست نیست.",
  order_closed: "این سفارش بسته شده است.",
  order_not_found: "سفارش پیدا نشد.",
  table_not_found: "میز پیدا نشد.",
  menu_item_unavailable: "این آیتم فعلاً موجود نیست.",
  menu_item_not_found: "این آیتم در منو پیدا نشد.",
  item_not_cancellable: "آشپزخانه آماده‌سازی را شروع کرده؛ دیگر قابل لغو نیست.",
  stale_status: "وضعیت این مورد تغییر کرده بود. صفحه به‌روز شد.",
  request_id_reused: "این درخواست قبلاً با اطلاعات دیگری ثبت شده است.",
  retry: "وضعیت میز تغییر کرد. دوباره تلاش کنید.",
  busy: "سرور مشغول است. دوباره تلاش کنید.",
};

export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "خطای ناشناخته.";
  if (e.code === "items_not_served") {
    const n = Number(e.details?.pending ?? 0);
    return n > 0
      ? `${n.toLocaleString("fa-IR")} آیتم هنوز سرو نشده است.`
      : "همهٔ آیتم‌ها باید سرو یا لغو شوند.";
  }
  if (e.code === "internal") {
    return `خطای داخلی سرور.${e.requestId ? ` کد پیگیری: ${e.requestId.slice(0, 8)}` : ""}`;
  }
  return MESSAGES[e.code] ?? "خطایی رخ داد. دوباره تلاش کنید.";
}

/** crypto.randomUUID only exists on HTTPS/localhost; this also works on a plain-http LAN address. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}