import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, countWhere, createRestaurant, type Fixture } from "./helpers/db";
import { login, openStream, waitUntil, type Api } from "./helpers/http";

let F: Fixture;
let waiter: Api;
let kitchen: Api;
let nextIndex = 0;
const nextTable = () => F.tables[nextIndex++]; // every test uses fresh tables

beforeAll(async () => {
  F = await createRestaurant("conc");
  waiter = await login(F.email.waiter);
  kitchen = await login(F.email.kitchen);
});

const openOrder = async (tableId = nextTable()) =>
  (await waiter.call("POST", "/api/orders", { tableId })).json.order.id as string;
const add = (orderId: string, menuItemId = F.menu.tea.id, quantity = 1, requestId = randomUUID()) =>
  waiter.call("POST", `/api/orders/${orderId}/items`, { requestId, menuItemId, quantity });
const move = (who: Api, itemId: string, from: string, to: string) =>
  who.call("POST", `/api/order-items/${itemId}/status`, { from, to });
const itemStatus = (id: string) =>
  admin(async (c) => (await c.query("SELECT status FROM order_items WHERE id = $1", [id])).rows[0].status as string);

describe("many people touching the same thing at once", () => {
  it("8 waiters opening the same table at the same moment create exactly one order", async () => {
    const tableId = nextTable();
    const rs = await Promise.all(Array.from({ length: 8 }, () => waiter.call("POST", "/api/orders", { tableId })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(rs.map((r) => r.json.order.id)).size).toBe(1);
    expect(await countWhere("SELECT count(*)::int AS n FROM orders WHERE table_id = $1 AND status = 'open'", [tableId])).toBe(1);
  });

  it("the same request sent 5 times at once creates one item", async () => {
    const orderId = await openOrder();
    const requestId = randomUUID();
    const rs = await Promise.all(Array.from({ length: 5 }, () => add(orderId, F.menu.latte.id, 1, requestId)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(rs.map((r) => r.json.item.id)).size).toBe(1);
    expect(await countWhere("SELECT count(*)::int AS n FROM order_items WHERE request_id = $1", [requestId])).toBe(1);
  });

  it("20 different items added at once: none is lost and the total is right", async () => {
    const orderId = await openOrder();
    const menu = [F.menu.latte, F.menu.cake, F.menu.tea];
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => add(orderId, menu[i % 3].id, 1 + (i % 3))));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const view = await waiter.call("GET", `/api/orders/${orderId}`);
    expect(view.json.items).toHaveLength(20);
    const expected = Array.from({ length: 20 }, (_, i) => menu[i % 3].price * (1 + (i % 3))).reduce((a, b) => a + b, 0);
    expect(view.json.total_toman).toBe(expected);
  });

  it("refuses to reuse a request id for a different request", async () => {
    const [o1, o2] = [await openOrder(), await openOrder()];
    const requestId = randomUUID();
    expect((await add(o1, F.menu.tea.id, 1, requestId)).status).toBe(201);
    const otherQty = await add(o1, F.menu.tea.id, 2, requestId);
    expect(otherQty.status).toBe(409);
    expect(otherQty.json.error.code).toBe("request_id_reused");
    expect((await add(o2, F.menu.tea.id, 1, requestId)).status).toBe(409);
  });

  it("two kitchen tablets tapping 'start' together: both succeed, the change happens once", async () => {
    const orderId = await openOrder();
    const item = (await add(orderId)).json.item.id;
    const rs = await Promise.all(Array.from({ length: 6 }, () => move(kitchen, item, "new", "preparing")));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.json.changed)).toHaveLength(1);
    expect(await countWhere("SELECT version AS n FROM order_items WHERE id = $1", [item])).toBe(2);
  });

  it("cancel against 'start cooking', 10 times: exactly one wins, and the result agrees with the winner", async () => {
    for (let i = 0; i < 10; i++) {
      const orderId = await openOrder();
      const item = (await add(orderId)).json.item.id;
      const [cancel, start] = await Promise.all([
        waiter.call("POST", `/api/order-items/${item}/cancel`, {}),
        move(kitchen, item, "new", "preparing"),
      ]);
      const cancelWon = cancel.status === 200 && start.status === 409;
      const startWon = cancel.status === 409 && start.status === 200;
      expect(cancelWon || startWon, `round ${i}: cancel=${cancel.status} start=${start.status}`).toBe(true);
      expect(await itemStatus(item)).toBe(cancelWon ? "cancelled" : "preparing");
    }
  });

  it("closing a table against adding an item, 8 times: an item never ends up in a closed order", async () => {
    for (let i = 0; i < 8; i++) {
      const orderId = await openOrder();
      const item = (await add(orderId)).json.item.id;
      await move(kitchen, item, "new", "preparing");
      await move(kitchen, item, "preparing", "ready");
      await move(waiter, item, "ready", "served");
      const [close, late] = await Promise.all([
        waiter.call("POST", `/api/orders/${orderId}/close`, {}),
        add(orderId),
      ]);
      const closedFirst = close.status === 200 && late.status === 409;
      const addedFirst = close.status === 409 && late.status === 201;
      expect(closedFirst || addedFirst, `round ${i}: close=${close.status} add=${late.status}`).toBe(true);
    }
    const stranded = await countWhere(
      `SELECT count(*)::int AS n FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.restaurant_id = $1 AND o.status = 'closed' AND i.status NOT IN ('served', 'cancelled')`,
      [F.id],
    );
    expect(stranded).toBe(0);
  });

  // Runs last on purpose: it checks the events produced by everything above.
  it("the event feed contains every event exactly once, in order, after all that parallel work", async () => {
    const ids = await admin(async (c) =>
      (await c.query("SELECT id::text AS id FROM order_events WHERE restaurant_id = $1 ORDER BY id", [F.id])).rows.map(
        (r) => r.id as string,
      ),
    );
    expect(ids.length).toBeGreaterThan(100);
    const stream = await openStream(kitchen.cookie, 0);
    await waitUntil(() => stream.events.length >= ids.length, 20_000);
    expect(stream.events.map((e) => e.id)).toEqual(ids); // no gaps, no duplicates, ascending
    stream.close();
  });
});