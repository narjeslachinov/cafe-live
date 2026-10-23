import type { PoolClient } from "pg";
import { HttpError } from "./http";

export type ItemStatus = "new" | "preparing" | "ready" | "served" | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string;
  name_snapshot: string;
  unit_price_toman: number;
  quantity: number;
  note: string | null;
  status: ItemStatus;
  version: number;
  request_id: string;
  created_at: Date;
  updated_at: Date;
};

export const ITEM_COLS = `id, order_id, menu_item_id, name_snapshot, unit_price_toman,
  quantity, note, status, version, request_id, created_at, updated_at`;

export async function logEvent(
  client: PoolClient,
  e: { orderId: string; itemId?: string; type: string; actorId: string; payload?: object },
) {
  // One writer per restaurant at a time until commit, so event ids become
  // visible in id order and a polling reader can never skip an event.
  // This must stay the LAST lock a transaction takes (no deadlock cycles).
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(app_restaurant_id()::text, 0))`,
  );
  await client.query(
    `INSERT INTO order_events (restaurant_id, order_id, order_item_id, type, payload, actor_id)
     VALUES (app_restaurant_id(), $1, $2, $3, $4, $5)`,
    [e.orderId, e.itemId ?? null, e.type, JSON.stringify(e.payload ?? {}), e.actorId],
  );
}

/* ---------------- open order for a table ---------------- */

export async function openOrder(client: PoolClient, p: { tableId: string; userId: string }) {
  const ins = await client.query(
    `INSERT INTO orders (restaurant_id, table_id, opened_by)
     SELECT t.restaurant_id, t.id, $2::uuid FROM dining_tables t
      WHERE t.id = $1 AND t.is_active
     ON CONFLICT (restaurant_id, table_id) WHERE status = 'open' DO NOTHING
     RETURNING id, table_id, status, opened_at`,
    [p.tableId, p.userId],
  );
  if (ins.rows[0]) {
    await logEvent(client, {
      orderId: ins.rows[0].id,
      type: "order_opened",
      actorId: p.userId,
      payload: { tableId: p.tableId },
    });
    return { order: ins.rows[0], created: true };
  }

  // Someone else opened it first (or the table is unusable): look at what is there now.
  const existing = await client.query(
    `SELECT id, table_id, status, opened_at FROM orders
      WHERE table_id = $1 AND status = 'open'`,
    [p.tableId],
  );
  if (existing.rows[0]) return { order: existing.rows[0], created: false };

  const table = await client.query(
    `SELECT 1 FROM dining_tables WHERE id = $1 AND is_active`,
    [p.tableId],
  );
  if (!table.rows[0]) throw new HttpError(404, "Table not found", "table_not_found");
  throw new HttpError(409, "Table state changed, please retry", "retry");
}

/* ---------------- add item ---------------- */

type AddParams = {
  orderId: string;
  menuItemId: string;
  quantity: number;
  note?: string;
  requestId: string;
  userId: string;
};

async function findByRequest(client: PoolClient, requestId: string) {
  const r = await client.query<OrderItem>(
    `SELECT ${ITEM_COLS} FROM order_items WHERE request_id = $1 LIMIT 1`,
    [requestId],
  );
  return r.rows[0];
}

function assertSameRequest(row: OrderItem, p: AddParams): OrderItem {
  if (
    row.order_id !== p.orderId ||
    row.menu_item_id !== p.menuItemId ||
    row.quantity !== p.quantity
  ) {
    throw new HttpError(409, "requestId was already used for a different request", "request_id_reused");
  }
  return row;
}

export async function addItem(client: PoolClient, p: AddParams) {
  // 1. Replay of an earlier request: answer with the original result, even if the order is closed now.
  const replay = await findByRequest(client, p.requestId);
  if (replay) return { item: assertSameRequest(replay, p), created: false };

  // 2. Shared lock: many adds can run together, but not alongside closing the order.
  const o = await client.query<{ status: string }>(
    `SELECT status FROM orders WHERE id = $1 FOR SHARE`,
    [p.orderId],
  );
  if (!o.rows[0]) throw new HttpError(404, "Order not found", "order_not_found");
  if (o.rows[0].status !== "open") throw new HttpError(409, "Order is closed", "order_closed");

  // 3. Price and name are read and snapshotted in the same statement.
  const ins = await client.query<OrderItem>(
    `INSERT INTO order_items
       (restaurant_id, order_id, menu_item_id, name_snapshot, unit_price_toman,
        quantity, note, request_id, added_by)
     SELECT m.restaurant_id, $1::uuid, m.id, m.name, m.price_toman,
            $3::int, $4::text, $5::uuid, $6::uuid
       FROM menu_items m
      WHERE m.id = $2 AND m.is_available
     ON CONFLICT (restaurant_id, request_id) DO NOTHING
     RETURNING ${ITEM_COLS}`,
    [p.orderId, p.menuItemId, p.quantity, p.note || null, p.requestId, p.userId],
  );

  if (ins.rows[0]) {
    await logEvent(client, {
      orderId: p.orderId,
      itemId: ins.rows[0].id,
      type: "item_added",
      actorId: p.userId,
      payload: { name: ins.rows[0].name_snapshot, quantity: p.quantity },
    });
    return { item: ins.rows[0], created: true };
  }

  // 4. No row: either an identical request won a race, or the menu item is not orderable.
  const raced = await findByRequest(client, p.requestId);
  if (raced) return { item: assertSameRequest(raced, p), created: false };

  const m = await client.query(`SELECT 1 FROM menu_items WHERE id = $1`, [p.menuItemId]);
  if (!m.rows[0]) throw new HttpError(404, "Menu item not found", "menu_item_not_found");
  throw new HttpError(409, "Menu item is not available", "menu_item_unavailable");
}

/* ---------------- cancel item ---------------- */

export async function cancelItem(client: PoolClient, p: { itemId: string; userId: string }) {
  // The WHERE clause is the rule: only an item nobody has started can be cancelled.
  const upd = await client.query<OrderItem>(
    `UPDATE order_items
        SET status = 'cancelled', version = version + 1, updated_at = now()
      WHERE id = $1 AND status = 'new'
      RETURNING ${ITEM_COLS}`,
    [p.itemId],
  );
  if (upd.rows[0]) {
    await logEvent(client, {
      orderId: upd.rows[0].order_id,
      itemId: upd.rows[0].id,
      type: "item_cancelled",
      actorId: p.userId,
    });
    return upd.rows[0];
  }

  const cur = await client.query<OrderItem>(
    `SELECT ${ITEM_COLS} FROM order_items WHERE id = $1`,
    [p.itemId],
  );
  const row = cur.rows[0];
  if (!row) throw new HttpError(404, "Item not found", "item_not_found");
  if (row.status === "cancelled") return row; // idempotent
  throw new HttpError(409, "Item can no longer be cancelled", "item_not_cancellable", {
    status: row.status,
  });
}

/* ---------------- close order ---------------- */

export async function closeOrder(client: PoolClient, p: { orderId: string; userId: string }) {
  const o = await client.query<{ status: string }>(
    `SELECT status FROM orders WHERE id = $1 FOR UPDATE`,
    [p.orderId],
  );
  if (!o.rows[0]) throw new HttpError(404, "Order not found", "order_not_found");
  if (o.rows[0].status === "closed") return { closed: false }; // idempotent
  if (o.rows[0].status !== "open") throw new HttpError(409, "Order is not open", "order_not_open");

  const pending = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM order_items
      WHERE order_id = $1 AND status NOT IN ('served', 'cancelled')`,
    [p.orderId],
  );
  if (pending.rows[0].n > 0) {
    throw new HttpError(409, "Some items are not served yet", "items_not_served", {
      pending: pending.rows[0].n,
    });
  }

  await client.query(`UPDATE orders SET status = 'closed', closed_at = now() WHERE id = $1`, [
    p.orderId,
  ]);
  await logEvent(client, { orderId: p.orderId, type: "order_closed", actorId: p.userId });
  return { closed: true };
}

/* ---------------- read one order ---------------- */

export async function getOrder(client: PoolClient, orderId: string) {
  const o = await client.query(
    `SELECT o.id, o.table_id, t.label AS table_label, o.status, o.opened_at, o.closed_at
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id AND t.restaurant_id = o.restaurant_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!o.rows[0]) throw new HttpError(404, "Order not found", "order_not_found");

  const items = await client.query<OrderItem>(
    `SELECT ${ITEM_COLS} FROM order_items WHERE order_id = $1 ORDER BY created_at, id`,
    [orderId],
  );
  const total = items.rows
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + i.unit_price_toman * i.quantity, 0);

  return { order: o.rows[0], items: items.rows, total_toman: total };
}