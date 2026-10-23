import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createRestaurant, type Fixture } from "./helpers/db";
import { BASE } from "./helpers/env";
import { login, openStream, sleep, waitUntil, type Api } from "./helpers/http";

let A: Fixture, B: Fixture;
let aWaiter: Api, aKitchen: Api, bKitchen: Api;
let tableIndex = 0;

beforeAll(async () => {
  [A, B] = await Promise.all([createRestaurant("str-a"), createRestaurant("str-b")]);
  [aWaiter, aKitchen, bKitchen] = await Promise.all([
    login(A.email.waiter), login(A.email.kitchen), login(B.email.kitchen),
  ]);
});

/** Opens a table in A and adds two items. Returns after the writes are committed. */
async function activityInA() {
  const orderId = (await aWaiter.call("POST", "/api/orders", { tableId: A.tables[tableIndex++] })).json.order.id;
  for (let i = 0; i < 2; i++) {
    await aWaiter.call("POST", `/api/orders/${orderId}/items`, {
      requestId: randomUUID(), menuItemId: A.menu.tea.id, quantity: 1,
    });
  }
}
const cursorOf = async (who: Api) => (await who.call("GET", "/api/kitchen/queue")).json.cursor as number;

describe("the live stream", () => {
  it("needs a session and a sane cursor", async () => {
    expect((await fetch(`${BASE}/api/events/stream`)).status).toBe(401);
    const bad = await fetch(`${BASE}/api/events/stream?after=abc`, { headers: { cookie: aKitchen.cookie } });
    expect(bad.status).toBe(400);
    void bad.body?.cancel();
    const badHeader = await fetch(`${BASE}/api/events/stream`, {
      headers: { cookie: aKitchen.cookie, "Last-Event-ID": "not-a-number" },
    });
    expect(badHeader.status).toBe(400);
    void badHeader.body?.cancel();
  });

  it("replays what happened while the screen was disconnected, in order, without duplicates", async () => {
    const cursor = await cursorOf(aKitchen);
    await activityInA(); // nobody is listening
    const s = await openStream(aKitchen.cookie, cursor);
    await waitUntil(() => s.events.filter((e) => e.data.type === "item_added").length >= 2);
    expect(s.events.map((e) => e.data.type)).toEqual(["order_opened", "item_added", "item_added"]);
    const ids = s.events.map((e) => Number(e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    s.close();
  });

  it("prefers Last-Event-ID over ?after, which is what a browser sends when it reconnects", async () => {
    const cursor = await cursorOf(aKitchen);
    await activityInA();
    const s = await openStream(aKitchen.cookie, 999_999_999, { "Last-Event-ID": String(cursor) });
    await waitUntil(() => s.events.some((e) => e.data.type === "item_added"));
    s.close();
  });

  it("never lets what happens in restaurant A reach restaurant B", async () => {
    const [cursorA, cursorB] = [await cursorOf(aKitchen), await cursorOf(bKitchen)];
    const streamA = await openStream(aKitchen.cookie, cursorA);
    const streamB = await openStream(bKitchen.cookie, cursorB);
    await activityInA();
    await waitUntil(() => streamA.events.length >= 3); // control: events really flowed in A
    await sleep(2500); // several polling rounds
    expect(streamB.events).toHaveLength(0);
    streamA.close();
    streamB.close();
  });

  it("is closed by the server when the member loses access", async () => {
    const w2 = await login(A.email.waiter2);
    const s = await openStream(w2.cookie, await cursorOf(w2));
    expect(s.status).toBe(200);
    await admin((c) => c.query("UPDATE memberships SET is_active = false WHERE user_id = $1", [A.userIds.waiter2]));
    await waitUntil(() => s.isEnded(), 6000);
    await admin((c) => c.query("UPDATE memberships SET is_active = true WHERE user_id = $1", [A.userIds.waiter2]));
  });
});