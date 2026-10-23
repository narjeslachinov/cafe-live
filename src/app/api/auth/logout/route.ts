import { cookies } from "next/headers";
import { assertSameOrigin, route } from "@/server/http";
import { SESSION_COOKIE } from "@/server/session";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
});