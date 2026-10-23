import { cookies } from "next/headers";
import { logger } from "@/lib/logger";
import { withTenant } from "./db";
import { HttpError } from "./http";
import { readSessionToken, SESSION_COOKIE } from "./session";

export type Role = "waiter" | "kitchen" | "manager";

export type Session = {
  userId: string;
  restaurantId: string;
  role: Role;
  displayName: string;
};

/** Valid cookie AND an active membership right now. Anything else -> null. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await readSessionToken(token);
  if (!claims) return null;

  try {
    const row = await withTenant(claims.restaurantId, async (client) => {
      const r = await client.query<{ role: Role; display_name: string }>(
        `SELECT role, display_name FROM memberships
          WHERE user_id = $1 AND restaurant_id = $2 AND is_active`,
        [claims.userId, claims.restaurantId],
      );
      return r.rows[0];
    });
    if (!row) return null;
    return {
      userId: claims.userId,
      restaurantId: claims.restaurantId,
      role: row.role,
      displayName: row.display_name,
    };
  } catch (err) {
    logger.error({ err }, "session lookup failed");
    return null; // fail closed
  }
}

/** Use at the top of every protected handler. */
export async function requireSession(allowedRoles?: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Authentication required", "unauthenticated");
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    logger.warn(
      { userId: session.userId, role: session.role, allowedRoles },
      "forbidden: role not allowed",
    );
    throw new HttpError(403, "Not allowed", "forbidden");
  }
  return session;
}