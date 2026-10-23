import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { route } from "@/server/http";

export const GET = route(async () => {
  const s = await requireSession();
  const tables = await withTenant(s.restaurantId, async (c) => {
    const r = await c.query(
      `SELECT t.id, t.label, t.seats, o.id AS order_id, o.opened_at,
              (SELECT count(*)::int FROM order_items i
                WHERE i.order_id = o.id AND i.status <> 'cancelled') AS item_count,
              (SELECT count(*)::int FROM order_items i
                WHERE i.order_id = o.id AND i.status = 'ready') AS ready_count
         FROM dining_tables t
         LEFT JOIN orders o
                ON o.table_id = t.id AND o.restaurant_id = t.restaurant_id AND o.status = 'open'
        WHERE t.is_active
        ORDER BY length(t.label), t.label`,
    );
    return r.rows;
  });
  return Response.json({ tables });
});