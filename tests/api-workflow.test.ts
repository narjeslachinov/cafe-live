/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createRestaurant, type Fixture } from "./helpers/db";
import { login, openStream, waitUntil, type Api } from "./helpers/http";

let F: Fixture;
let waiter: Api;
let kitchen: Api;

beforeAll(async () => {
  F = await createRestaurant("flow");
  waiter = await login(F.email.waiter);
  kitchen = await login(F.email.kitchen);
});

const move = (who: Api, itemId: string, from: string, to: string) =>
  who.call("POST", `/api/order-items/${itemId}/status`, { from, to });

describe("a table's service from start to finish", () => {
  it("goes from empty to ordered, cooked, served and closed, with the kitchen following live", async () => {
    const tableId = F.tables[0];

    const before = await waiter.call("GET", "/api/tables");
    expect(before.json.tables.find((t: any) => t.id === tableId).order_id).toBeNull();

    const q0 = await kitchen.call("GET", "/api/kitchen/queue");
    const stream = await openStream(kitchen.cookie, q0.json.cursor);
    expect(stream.status).toBe(200);

    // The waiter opens the table and takes the order.
    const opened = await waiter.call("POST", "/api/orders", { tableId });
    expect(opened.status).toBe(201);
    const orderId: string = opened.json.order.id;
    const add = (menuItemId: string, quantity: number, note?: string) =>
      waiter.call("POST", `/api/orders/${orderId}/items`, { requestId: randomUUID(), menuItemId, quantity, note });

    const latte = await add(F.menu.latte.id, 2);
    const cake = await add(F.menu.cake.id, 1, "without cream");
    expect([latte.status, cake.status]).toEqual([201, 201]);
    expect(latte.json.item.unit_price_toman).toBe(F.menu.latte.price);
    const latteId: string = latte.json.item.id;
    const cakeId: string = cake.json.item.id;

    // The kitchen sees both, with the table label and the note.
    const queue = await kitchen.call("GET", "/api/kitchen/queue");
    expect(queue.json.items.find((i: any) => i.id === cakeId)).toMatchObject({
      table_label: "1", note: "without cream", status: "new", quantity: 1,
    });
    expect(queue.json.items.some((i: any) => i.id === latteId)).toBe(true);

    // The menu gets dearer afterwards; the order keeps the price it was taken at.
    await admin((c) => c.query("UPDATE menu_items SET price_toman = 999000 WHERE id = $1", [F.menu.latte.id]));
    const priced = await waiter.call("GET", `/api/orders/${orderId}`);
    expect(priced.json.total_toman).toBe(2 * F.menu.latte.price + F.menu.cake.price);
    await admin((c) => c.query("UPDATE menu_items SET price_toman = $2 WHERE id = $1", [F.menu.latte.id, F.menu.latte.price]));

    // Cooking starts: that item can no longer be cancelled, the untouched one still can.
    expect((await move(kitchen, latteId, "new", "preparing")).status).toBe(200);
    const late = await waiter.call("POST", `/api/order-items/${latteId}/cancel`, {});
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("item_not_cancellable");
    expect((await waiter.call("POST", `/api/order-items/${cakeId}/cancel`, {})).status).toBe(200);
    const afterCancel = await waiter.call("GET", `/api/orders/${orderId}`);
    expect(afterCancel.json.total_toman).toBe(2 * F.menu.latte.price);

    // The table cannot be closed while something is still in flight.
    const early = await waiter.call("POST", `/api/orders/${orderId}/close`, {});
    expect(early.status).toBe(409);
    expect(early.json.error.details.pending).toBe(1);

    // Ready: the waiter's table card shows it, the waiter serves it, the table closes.
    expect((await move(kitchen, latteId, "preparing", "ready")).status).toBe(200);
    const mid = await waiter.call("GET", "/api/tables");
    expect(mid.json.tables.find((t: any) => t.id === tableId).ready_count).toBe(1);
    expect((await move(waiter, latteId, "ready", "served")).status).toBe(200);
    expect((await waiter.call("POST", `/api/orders/${orderId}/close`, {})).status).toBe(200);

    const after = await waiter.call("GET", "/api/tables");
    expect(after.json.tables.find((t: any) => t.id === tableId).order_id).toBeNull();

    // The live stream told the kitchen everything, in order. (Refused requests produce no events.)
    await waitUntil(() => stream.events.some((e) => e.data.type === "order_closed"));
    expect(stream.events.map((e) => e.data.type)).toEqual([
      "order_opened", "item_added", "item_added", "item_status_changed",
      "item_cancelled", "item_status_changed", "item_status_changed", "order_closed",
    ]);
    stream.close();

    // The table is free for the next guests.
    const again = await waiter.call("POST", "/api/orders", { tableId });
    expect(again.status).toBe(201);
    expect(again.json.order.id).not.toBe(orderId);
  });

  it("treats a closed order as history that cannot be touched", async () => {
    const tableId = F.tables[1];
    const orderId = (await waiter.call("POST", "/api/orders", { tableId })).json.order.id;
    const item = (
      await waiter.call("POST", `/api/orders/${orderId}/items`, {
        requestId: randomUUID(), menuItemId: F.menu.tea.id, quantity: 1,
      })
    ).json.item.id;
    await move(kitchen, item, "new", "preparing");
    await move(kitchen, item, "preparing", "ready");
    await move(waiter, item, "ready", "served");
    expect((await waiter.call("POST", `/api/orders/${orderId}/close`, {})).status).toBe(200);

    const add = await waiter.call("POST", `/api/orders/${orderId}/items`, {
      requestId: randomUUID(), menuItemId: F.menu.tea.id, quantity: 1,
    });
    expect(add.status).toBe(409);
    expect(add.json.error.code).toBe("order_closed");
    expect((await waiter.call("POST", `/api/order-items/${item}/cancel`, {})).status).toBe(409);
    expect((await waiter.call("POST", `/api/orders/${orderId}/close`, {})).status).toBe(200); // pressing twice is harmless

    const view = await waiter.call("GET", `/api/orders/${orderId}`);
    expect(view.json.order.status).toBe("closed");
    expect(view.json.total_toman).toBe(F.menu.tea.price);
  });

  it("keeps a sold-out dish off the menu and out of orders", async () => {
    const menu = await waiter.call("GET", "/api/menu");
    const ids = menu.json.categories.flatMap((c: any) => c.items.map((i: any) => i.id));
    expect(ids).toContain(F.menu.latte.id);
    expect(ids).not.toContain(F.menu.soldOut.id);

    const orderId = (await waiter.call("POST", "/api/orders", { tableId: F.tables[2] })).json.order.id;
    const r = await waiter.call("POST", `/api/orders/${orderId}/items`, {
      requestId: randomUUID(), menuItemId: F.menu.soldOut.id, quantity: 1,
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("menu_item_unavailable");
  });
});