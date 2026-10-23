/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, countWhere, createRestaurant, type Fixture } from "./helpers/db";
import { BASE, TEST_SESSION_SECRET } from "./helpers/env";
import { login, request, type Api } from "./helpers/http";

const ZERO = "00000000-0000-4000-8000-000000000000";
let A: Fixture, B: Fixture;
let aWaiter: Api, aKitchen: Api, aManager: Api, bWaiter: Api, bKitchen: Api, bManager: Api;
let orderA: string, itemA: string, reqA: string, orderB: string;

const items = (orderId: string) => `/api/orders/${orderId}/items`;
const secret = new TextEncoder().encode(TEST_SESSION_SECRET);
const sign = (sub: string, rid: string) =>
  new SignJWT({ rid }).setProtectedHeader({ alg: "HS256" }).setSubject(sub)
    .setIssuer("sarfaresh").setIssuedAt().setExpirationTime("1h").sign(secret);

beforeAll(async () => {
  [A, B] = await Promise.all([createRestaurant("sec-a"), createRestaurant("sec-b")]);
  [aWaiter, aKitchen, aManager, bWaiter, bKitchen, bManager] = await Promise.all([
    login(A.email.waiter), login(A.email.kitchen), login(A.email.manager),
    login(B.email.waiter), login(B.email.kitchen), login(B.email.manager),
  ]);
  orderA = (await aWaiter.call("POST", "/api/orders", { tableId: A.tables[0] })).json.order.id;
  reqA = randomUUID();
  itemA = (
    await aWaiter.call("POST", items(orderA), { requestId: reqA, menuItemId: A.menu.latte.id, quantity: 1 })
  ).json.item.id;
  orderB = (await bWaiter.call("POST", "/api/orders", { tableId: B.tables[0] })).json.order.id;
});

describe("without a session", () => {
  const routes: [string, string][] = [
    ["GET", "/api/auth/me"], ["GET", "/api/tables"], ["GET", "/api/menu"],
    ["POST", "/api/orders"], ["GET", `/api/orders/${ZERO}`], ["POST", `/api/orders/${ZERO}/items`],
    ["POST", `/api/orders/${ZERO}/close`], ["POST", `/api/order-items/${ZERO}/cancel`],
    ["POST", `/api/order-items/${ZERO}/status`], ["GET", "/api/kitchen/queue"], ["GET", "/api/events/stream"],
  ];
  it.each(routes)("%s %s -> 401", async (method, path) => {
    const r = await request(null, method as "GET" | "POST", path, method === "POST" ? {} : undefined);
    expect(r.status).toBe(401);
  });
});

describe("roles", () => {
  const cases = [
    { name: "kitchen cannot open an order", run: () => aKitchen.call("POST", "/api/orders", { tableId: A.tables[1] }), status: 403 },
    { name: "kitchen cannot add items", run: () => aKitchen.call("POST", items(orderA), { requestId: randomUUID(), menuItemId: A.menu.tea.id, quantity: 1 }), status: 403 },
    { name: "kitchen cannot cancel items", run: () => aKitchen.call("POST", `/api/order-items/${itemA}/cancel`, {}), status: 403 },
    { name: "kitchen cannot close tables", run: () => aKitchen.call("POST", `/api/orders/${orderA}/close`, {}), status: 403 },
    { name: "waiter cannot start cooking", run: () => aWaiter.call("POST", `/api/order-items/${itemA}/status`, { from: "new", to: "preparing" }), status: 403 },
    { name: "waiter cannot mark an item ready", run: () => aWaiter.call("POST", `/api/order-items/${itemA}/status`, { from: "preparing", to: "ready" }), status: 403 },
    { name: "waiter cannot undo a kitchen step", run: () => aWaiter.call("POST", `/api/order-items/${itemA}/status`, { from: "preparing", to: "new" }), status: 403 },
    { name: "a move that does not exist is refused for the kitchen", run: () => aKitchen.call("POST", `/api/order-items/${itemA}/status`, { from: "new", to: "ready" }), status: 400 },
    { name: "a move that does not exist is refused for the manager", run: () => aManager.call("POST", `/api/order-items/${itemA}/status`, { from: "served", to: "new" }), status: 400 },
  ];
  it.each(cases)("$name -> $status", async ({ run, status }) => {
    expect((await run()).status).toBe(status);
  });

  it.each([["waiter"], ["kitchen"], ["manager"]])("%s can read tables, menu and the kitchen queue", async (who) => {
    const api = { waiter: aWaiter, kitchen: aKitchen, manager: aManager }[who]!;
    for (const path of ["/api/tables", "/api/menu", "/api/kitchen/queue"]) {
      expect((await api.call("GET", path)).status).toBe(200);
    }
  });

  it("the manager can do the waiter's and the kitchen's work (today's behaviour)", async () => {
    const o = await aManager.call("POST", "/api/orders", { tableId: A.tables[2] });
    expect(o.status).toBe(201);
    const it1 = await aManager.call("POST", items(o.json.order.id), { requestId: randomUUID(), menuItemId: A.menu.tea.id, quantity: 1 });
    expect(it1.status).toBe(201);
    expect((await aManager.call("POST", `/api/order-items/${it1.json.item.id}/status`, { from: "new", to: "preparing" })).status).toBe(200);
  });
});

describe("restaurant B against restaurant A's data", () => {
  const cases = [
    { name: "reads A's order", run: () => bWaiter.call("GET", `/api/orders/${orderA}`) },
    { name: "adds A's menu item to A's order", run: () => bWaiter.call("POST", items(orderA), { requestId: randomUUID(), menuItemId: A.menu.latte.id, quantity: 1 }) },
    { name: "adds its own menu item to A's order", run: () => bWaiter.call("POST", items(orderA), { requestId: randomUUID(), menuItemId: B.menu.latte.id, quantity: 1 }) },
    { name: "closes A's order", run: () => bWaiter.call("POST", `/api/orders/${orderA}/close`, {}) },
    { name: "cancels A's item", run: () => bWaiter.call("POST", `/api/order-items/${itemA}/cancel`, {}) },
    { name: "moves A's item as B's manager", run: () => bManager.call("POST", `/api/order-items/${itemA}/status`, { from: "new", to: "preparing" }) },
    { name: "moves A's item as B's kitchen", run: () => bKitchen.call("POST", `/api/order-items/${itemA}/status`, { from: "new", to: "preparing" }) },
    { name: "opens an order on A's table", run: () => bWaiter.call("POST", "/api/orders", { tableId: A.tables[5] }) },
    { name: "puts A's menu item on its own order", run: () => bWaiter.call("POST", items(orderB), { requestId: randomUUID(), menuItemId: A.menu.latte.id, quantity: 1 }) },
  ];
  it.each(cases)("B $name -> 404", async ({ run }) => {
    expect((await run()).status).toBe(404);
  });

  it("B's lists never contain A's data", async () => {
    const tables = (await bWaiter.call("GET", "/api/tables")).json.tables;
    expect(tables.every((t: any) => B.tables.includes(t.id))).toBe(true);
    const queue = (await bKitchen.call("GET", "/api/kitchen/queue")).json.items;
    expect(queue.every((i: any) => i.id !== itemA && i.order_id !== orderA)).toBe(true);
    const menuIds = (await bWaiter.call("GET", "/api/menu")).json.categories.flatMap((c: any) => c.items.map((i: any) => i.id));
    expect(menuIds).not.toContain(A.menu.latte.id);
  });

  it("an idempotency key used by A does not collide with, or reveal itself to, B", async () => {
    const r = await bWaiter.call("POST", items(orderB), { requestId: reqA, menuItemId: B.menu.latte.id, quantity: 1 });
    expect(r.status).toBe(201);
  });
});

describe("input at the boundary", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["a client-supplied price", { unitPrice: 1 }],
    ["an unknown field", { foo: 1 }],
    ["quantity 0", { quantity: 0 }],
    ["quantity 51", { quantity: 51 }],
    ["a fractional quantity", { quantity: 1.5 }],
    ["a quantity sent as text", { quantity: "2" }],
    ["a 201-character note", { note: "x".repeat(201) }],
    ["a requestId that is not a uuid", { requestId: "abc" }],
    ["a menuItemId that is not a uuid", { menuItemId: "abc" }],
  ];
  it.each(bad)("rejects %s with 400", async (_name, patch) => {
    const body = { requestId: randomUUID(), menuItemId: A.menu.tea.id, quantity: 1, ...patch };
    expect((await aWaiter.call("POST", items(orderA), body)).status).toBe(400);
  });

  it("answers a malformed id in the path with 400, not a database error", async () => {
    expect((await aWaiter.call("GET", "/api/orders/not-a-uuid")).status).toBe(400);
  });

  it("answers a body that is not JSON with 400", async () => {
    const r = await fetch(`${BASE}${items(orderA)}`, {
      method: "POST", headers: { cookie: aWaiter.cookie, "Content-Type": "application/json" }, body: "not json",
    });
    expect(r.status).toBe(400);
  });

  it("refuses a request that comes from another website, accepts one from our own origin", async () => {
    const evil = await request(aWaiter.cookie, "POST", "/api/orders", { tableId: A.tables[10] }, { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const ours = await request(aWaiter.cookie, "POST", "/api/orders", { tableId: A.tables[10] }, { Origin: BASE });
    expect(ours.status).toBe(201);
  });
});

describe("sessions and login", () => {
  it("unknown user and wrong password give the same answer", async () => {
    const post = (email: string) =>
      fetch(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      });
    const [a, b] = await Promise.all([post(A.email.waiter), post("nobody@nowhere.test")]);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
  });

  it("sets an HttpOnly, SameSite=Lax cookie", async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: A.email.waiter, password: "Test-pass-12345" }),
    });
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toMatch(/httponly/i);
    expect(cookie).toMatch(/samesite=lax/i);
  });

  it("locks an email out after repeated failures", async () => {
    const email = `brute-${randomUUID()}@x.test`;
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await fetch(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "x" }),
      })).status;
    }
    expect(last).toBe(429);
  });

  it("rejects tampered, garbage and unsigned ('alg: none') cookies", async () => {
    const good = aWaiter.cookie;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: A.userIds.waiter, rid: A.id, iss: "sarfaresh", exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    for (const cookie of [good.slice(0, -3) + "xxx", "sy_session=garbage", `sy_session=${none}`]) {
      expect((await request(cookie, "GET", "/api/tables")).status).toBe(401);
    }
  });

  it("a correctly signed token still cannot reach a restaurant the user does not belong to", async () => {
    const forged = `sy_session=${await sign(A.userIds.waiter, B.id)}`;
    expect((await request(forged, "GET", "/api/tables")).status).toBe(401);
    // Control: the same signer with the right restaurant is accepted, so the test is not vacuous.
    const honest = `sy_session=${await sign(A.userIds.waiter, A.id)}`;
    expect((await request(honest, "GET", "/api/tables")).status).toBe(200);
  });

  it("deactivating a member locks them out on the very next request", async () => {
    const w = await login(A.email.waiter2);
    expect((await w.call("GET", "/api/tables")).status).toBe(200);
    await admin((c) => c.query("UPDATE memberships SET is_active = false WHERE user_id = $1", [A.userIds.waiter2]));
    expect((await w.call("GET", "/api/tables")).status).toBe(401);
    await expect(login(A.email.waiter2)).rejects.toThrow(/401/);
    await admin((c) => c.query("UPDATE memberships SET is_active = true WHERE user_id = $1", [A.userIds.waiter2]));
    expect((await w.call("GET", "/api/tables")).status).toBe(200);
  });
});

describe("after all those attempts", () => {
  it("restaurant A's data is exactly as A left it", async () => {
    const n = await countWhere("SELECT count(*)::int AS n FROM order_items WHERE order_id = $1", [orderA]);
    expect(n).toBe(1);
    const state = await admin((c) =>
      c.query("SELECT i.status AS item, o.status AS ord FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = $1", [itemA]),
    );
    expect(state.rows[0]).toEqual({ item: "new", ord: "open" });
  });
});