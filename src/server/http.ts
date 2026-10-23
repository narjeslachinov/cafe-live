import { ZodError } from "zod";
import { logger } from "@/lib/logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error",
  ) {
    super(message);
  }
}

/** Browsers always send Origin on cross-site POSTs; a mismatch means CSRF. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (tests, curl)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = new URL(origin).host === host;
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(403, "Cross-origin request blocked", "bad_origin");
}

/** Wraps a handler so every failure becomes a safe, uniform JSON error. */
export function route(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return Response.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status },
        );
      }
      if (err instanceof ZodError) {
        return Response.json(
          { error: { code: "invalid_input", message: "Invalid input" } },
          { status: 400 },
        );
      }
      const requestId = crypto.randomUUID();
      logger.error({ err, requestId, path: new URL(req.url).pathname }, "unhandled error");
      return Response.json(
        { error: { code: "internal", message: "Internal error", requestId } },
        { status: 500 },
      );
    }
  };
}