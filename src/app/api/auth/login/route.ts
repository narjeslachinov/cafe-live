import { cookies } from "next/headers";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { pool } from "@/server/db";
import { assertSameOrigin, HttpError, route } from "@/server/http";
import { hashPassword, verifyPassword } from "@/server/password.mjs";
import { clearFailures, isBlocked, recordFailure } from "@/server/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/server/session";

const body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// Verified against when the email is unknown, so timing doesn't reveal it.
const DUMMY_HASH = hashPassword("not-a-real-password");

const BAD_CREDENTIALS = () =>
  new HttpError(401, "Invalid email or password", "invalid_credentials");

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { email, password } = body.parse(await req.json().catch(() => null));

  const key = email.toLowerCase();
  if (isBlocked(key)) {
    logger.warn({ event: "login_blocked" }, "login rate limited");
    throw new HttpError(429, "Too many attempts. Try again later.", "rate_limited");
  }

  const { rows } = await pool.query<{
    user_id: string;
    password_hash: string;
    restaurant_id: string;
    role: string;
    display_name: string;
  }>("SELECT * FROM auth_find_login($1)", [email]);

  if (rows.length === 0) {
    await verifyPassword(password, await DUMMY_HASH);
    recordFailure(key);
    logger.info({ event: "login_failed", reason: "unknown_user" }, "login failed");
    throw BAD_CREDENTIALS();
  }

  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) {
    recordFailure(key);
    logger.info({ event: "login_failed", reason: "bad_password" }, "login failed");
    throw BAD_CREDENTIALS();
  }

  if (rows.length > 1) {
    logger.warn({ userId: rows[0].user_id }, "login refused: multiple memberships");
    throw new HttpError(403, "Account is not available for login", "multiple_memberships");
  }

  const m = rows[0];
  clearFailures(key);
  const token = await signSession({ userId: m.user_id, restaurantId: m.restaurant_id });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  logger.info(
    { event: "login_ok", userId: m.user_id, restaurantId: m.restaurant_id, role: m.role },
    "login ok",
  );
  return Response.json({
    user: { displayName: m.display_name, role: m.role, restaurantId: m.restaurant_id },
  });
});