import type { PoolClient } from "pg";
import type { Role } from "./auth";
import { HttpError } from "./http";
import { ITEM_COLS, logEvent, type OrderItem } from "./orders";

export type KitchenStatus = "new" | "preparing" | "ready" | "served";

const TRANSITIONS: Record<string, Role[]> = {
  "new>preparing": ["kitchen", "manager"],
  "preparing>ready": ["kitchen", "manager"],
  "ready>served": ["kitchen", "waiter", "manager"],
  "preparing>new": ["kitchen", "manager"], // undo a mistaken tap
  "ready>preparing": ["kitchen", "manager"], // undo a mistaken tap
};

/** Roles allowed to make this move, or undefined if the move does not exist. */
export function allowedRoles(from: KitchenStatus, to: KitchenStatus): Role[] | undefined {
  return TRANSITIONS[`${from}>${to}`];
}

/**
 * Compare-and-set: the UPDATE only applies if the item is still in the status
 * the caller saw. The same target twice is harmless; a stale screen gets 409.
 */
export async function changeItemStatus(
  client: PoolClient,
  p: { itemId: string; from: KitchenStatus; to: KitchenStatus; userId: string },
) {
  const upd = await client.query<OrderItem>(
    `UPDATE order_items
        SET status = $3, version = version + 1, updated_at = now()
      WHERE id = $1 AND status = $2
      RETURNING ${ITEM_COLS}`,
    [p.itemId, p.from, p.to],
  );
  if (upd.rows[0]) {
    await logEvent(client, {
      orderId: upd.rows[0].order_id,
      itemId: upd.rows[0].id,
      type: "item_status_changed",
      actorId: p.userId,
      payload: { from: p.from, to: p.to },
    });
    return { item: upd.rows[0], changed: true };
  }

  const cur = await client.query<OrderItem>(
    `SELECT ${ITEM_COLS} FROM order_items WHERE id = $1`,
    [p.itemId],
  );
  const row = cur.rows[0];
  if (!row) throw new HttpError(404, "Item not found", "item_not_found");
  if (row.status === p.to) return { item: row, changed: false }; // someone did the same thing
  throw new HttpError(409, "Item status has changed, refresh the screen", "stale_status", {
    status: row.status,
  });
}

/** Everything still on the kitchen's plate, oldest first, plus the event cursor. */
export async function getQueue(client: PoolClient) {
  // Cursor first: the state read below is at least as new as the cursor, so a
  // client that subscribes after this id can only see an event twice, never miss one.
  const cur = await client.query<{ cursor: string }>(
    `SELECT coalesce(max(id), 0)::text AS cursor FROM order_events`,
  );
  const items = await client.query(
    `SELECT i.id, i.order_id, t.label AS table_label, i.name_snapshot, i.quantity,
            i.note, i.status, i.created_at, i.updated_at
       FROM order_items i
       JOIN orders o ON o.id = i.order_id AND o.restaurant_id = i.restaurant_id
       JOIN dining_tables t ON t.id = o.table_id AND t.restaurant_id = o.restaurant_id
      WHERE i.status IN ('new', 'preparing', 'ready')
      ORDER BY i.created_at, i.id`,
  );
  return { cursor: Number(cur.rows[0].cursor), items: items.rows };
}