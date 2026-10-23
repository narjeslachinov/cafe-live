import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failed = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${cond ? "" : extra}`);
  if (!cond) failed++;
}

async function login(email) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test-12345" }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  return async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status, json };
  };
}

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await admin.connect();

// Start from a clean floor so reruns work.
await admin.query(
  `UPDATE orders SET status = 'closed', closed_at = now()
    WHERE status = 'open'
      AND restaurant_id IN (SELECT id FROM restaurants WHERE slug IN ('cafe-a', 'cafe-b'))`,
);

const A = await login("waiter@a.test");
const B = await login("waiter@b.test");
const K = await login("kitchen@a.test");

const tablesA = (await A("GET", "/api/tables")).json.tables;
const tableId = (label) => tablesA.find((t) => t.label === label).id;
const menuA = (await A("GET", "/api/menu")).json.categories.flatMap((c) => c.items);
const menuB = (await B("GET", "/api/menu")).json.categories.flatMap((c) => c.items);
const latte = menuA.find((i) => i.name === "لاته");
const uuid = () => crypto.randomUUID();

console.log("\n-- roles");
const kf = await K("POST", "/api/orders", { tableId: tableId("1") });
check("kitchen cannot open orders -> 403", kf.status === 403);

console.log("\n-- opening orders");
const o1 = await A("POST", "/api/orders", { tableId: tableId("1") });
const o1b = await A("POST", "/api/orders", { tableId: tableId("1") });
check("open order -> 201", o1.status === 201);
check("opening again returns the same order -> 200", o1b.status === 200 && o1b.json?.order?.id === o1.json?.order?.id);
const orderId = o1.json.order.id;

const par = await Promise.all(
  Array.from({ length: 6 }, () => A("POST", "/api/orders", { tableId: tableId("2") })),
);
check(
  "6 parallel opens on one table create exactly one order",
  par.filter((r) => r.status === 201).length === 1 &&
    new Set(par.map((r) => r.json?.order?.id)).size === 1,
);

console.log("\n-- adding items");
const itemsUrl = `/api/orders/${orderId}/items`;
const rid = uuid();
const add1 = await A("POST", itemsUrl, { requestId: rid, menuItemId: latte.id, quantity: 2 });
check("add item -> 201", add1.status === 201);
check("price is the server's price", add1.json?.item?.unit_price_toman === latte.price_toman);
const add1b = await A("POST", itemsUrl, { requestId: rid, menuItemId: latte.id, quantity: 2 });
check("same requestId again -> 200 with the same item", add1b.status === 200 && add1b.json?.item?.id === add1.json?.item?.id);
const reuse = await A("POST", itemsUrl, { requestId: rid, menuItemId: latte.id, quantity: 3 });
check("same requestId, different quantity -> 409", reuse.status === 409);
const tamper = await A("POST", itemsUrl, { requestId: uuid(), menuItemId: latte.id, quantity: 1, unitPrice: 1 });
check("client-supplied price is rejected -> 400", tamper.status === 400);

const dupRid = uuid();
const dups = await Promise.all(
  Array.from({ length: 5 }, () => A("POST", itemsUrl, { requestId: dupRid, menuItemId: latte.id, quantity: 1 })),
);
check(
  "5 parallel duplicates create exactly one item",
  dups.filter((r) => r.status === 201).length === 1 && dups.every((r) => [200, 201].includes(r.status)),
);

const N = 10;
const adds = await Promise.all(
  Array.from({ length: N }, (_, i) =>
    A("POST", itemsUrl, { requestId: uuid(), menuItemId: menuA[i % menuA.length].id, quantity: 1 }),
  ),
);
check(`${N} parallel adds all succeed`, adds.every((r) => r.status === 201));

const full = await A("GET", `/api/orders/${orderId}`);
check("nothing lost: 1 + 1 + 10 items", full.json?.items?.length === 12, `got ${full.json?.items?.length}`);
const expected = full.json.items
  .filter((i) => i.status !== "cancelled")
  .reduce((s, i) => s + i.unit_price_toman * i.quantity, 0);
check("server total matches the items", full.json.total_toman === expected);

console.log("\n-- restaurant isolation");
check("B cannot read A's order -> 404", (await B("GET", `/api/orders/${orderId}`)).status === 404);
check(
  "B cannot add to A's order -> 404",
  (await B("POST", itemsUrl, { requestId: uuid(), menuItemId: menuB[0].id, quantity: 1 })).status === 404,
);
check("B cannot open an order on A's table -> 404", (await B("POST", "/api/orders", { tableId: tableId("3") })).status === 404);
check(
  "A cannot order B's menu item -> 404",
  (await A("POST", itemsUrl, { requestId: uuid(), menuItemId: menuB[0].id, quantity: 1 })).status === 404,
);
const itemId = add1.json.item.id;
check("B cannot cancel A's item -> 404", (await B("POST", `/api/order-items/${itemId}/cancel`, {})).status === 404);

console.log("\n-- cancelling");
const cx = await A("POST", `/api/order-items/${itemId}/cancel`, {});
check("cancel a new item -> 200", cx.status === 200 && cx.json?.item?.status === "cancelled");
check("cancelling again is harmless -> 200", (await A("POST", `/api/order-items/${itemId}/cancel`, {})).status === 200);
const prepId = adds[0].json.item.id;
await admin.query("UPDATE order_items SET status = 'preparing', version = version + 1 WHERE id = $1", [prepId]);
check("cannot cancel an item already in preparation -> 409", (await A("POST", `/api/order-items/${prepId}/cancel`, {})).status === 409);

console.log("\n-- closing");
check("cannot close with unserved items -> 409", (await A("POST", `/api/orders/${orderId}/close`, {})).status === 409);
await admin.query("UPDATE order_items SET status = 'served' WHERE order_id = $1 AND status <> 'cancelled'", [orderId]);
check("close after everything is served -> 200", (await A("POST", `/api/orders/${orderId}/close`, {})).status === 200);
check(
  "cannot add to a closed order -> 409",
  (await A("POST", itemsUrl, { requestId: uuid(), menuItemId: latte.id, quantity: 1 })).status === 409,
);
check("closing twice is harmless -> 200", (await A("POST", `/api/orders/${orderId}/close`, {})).status === 200);
const reopened = await A("POST", "/api/orders", { tableId: tableId("1") });
check("the table is free again -> new order 201", reopened.status === 201 && reopened.json?.order?.id !== orderId);

await admin.end();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);