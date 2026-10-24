import { withTenant } from "./db";

export type EventRow = {
  id: string;
  type: string;
  order_id: string | null;
  order_item_id: string | null;
};

export async function currentCursor(restaurantId: string): Promise<number> {
  return withTenant(restaurantId, async (c) => {
    const r = await c.query<{ cursor: string }>(
      `SELECT coalesce(max(id), 0)::text AS cursor FROM order_events`,
    );
    return Number(r.rows[0].cursor);
  });
}

/**
 * Events after `after`, or null if the member lost access in the meantime
 * (the stream then ends instead of leaking data to a revoked user).
 */
export async function pollEvents(p: {
  restaurantId: string;
  userId: string;
  after: number;
  limit: number;
}): Promise<EventRow[] | null> {
  return withTenant(p.restaurantId, async (c) => {
    const m = await c.query(
      `SELECT 1 FROM memberships
        WHERE user_id = $1 AND restaurant_id = app_restaurant_id() AND is_active`,
      [p.userId],
    );
    if (!m.rows[0]) return null;
    const r = await c.query<EventRow>(
      `SELECT id::text AS id, type, order_id, order_item_id
         FROM order_events WHERE id > $1 ORDER BY id LIMIT $2`,
      [p.after, p.limit],
    );
    return r.rows;
  });
}