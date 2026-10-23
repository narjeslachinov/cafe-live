import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failed = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${cond ? "" : extra}`);
  if (!cond) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

async function login(email) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test-12345" }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  const call = async (method, path, body) => {
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
  return { call, cookie };
}

function parseBlock(block) {
  const ev = { id: null, event: "message", data: null };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("id:")) ev.id = line.slice(3).trim();
    else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      try {
        ev.data = JSON.parse(line.slice(5).trim());
      } catch {}
    }
  }
  return ev.data ? ev : null;
}

async function openStream(cookie, after) {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/events/stream?after=${after}`, {
    headers: { cookie },
    signal: ctrl.signal,
  });
  const events = [];
  let ended = false;
  void (async () => {
    if (res.status !== 200 || !res.body) {
      ended = true;
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const ev = parseBlock(buf.slice(0, i));
          buf = buf.slice(i + 2);
          if (ev) events.push(ev);
        }
      }
    } catch {}
    ended = true;
  })();
  return { status: res.status, events, isEnded: () => ended, close: () => ctrl.abort() };
}

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await admin.connect();
await admin.query(
  `UPDATE orders SET status = 'closed', closed_at = now()
    WHERE status = 'open'
      AND restaurant_id IN (SELECT id FROM restaurants WHERE slug IN ('cafe-a', 'cafe-b'))`,
);

const A = await login("waiter@a.test");
const KA = await login("kitchen@a.test");
const B = await login("waiter@b.test");
const KB = await login("kitchen@b.test");

const tablesA = (await A.call("GET", "/api/tables")).json.tables;
const tableId = (l) => tablesA.find((t) => t.label === l).id;
const menuA = (await A.call("GET", "/api/menu")).json.categories.flatMap((c) => c.items);
const uuid = () => crypto.randomUUID();
const setStatus = (who, id, from, to) =>
  who.call("POST", `/api/order-items/${id}/status`, { from, to });

// B's stream is opened first: nothing that happens in A may ever reach it.
const qb0 = await KB.call("GET", "/api/kitchen/queue");
const streamB = await openStream(KB.cookie, qb0.json.cursor);

console.log("\n-- setup: one order, three items");
const order = await A.call("POST", "/api/orders", { tableId: tableId("1") });
const orderId = order.json.order.id;
const itemsUrl = `/api/orders/${orderId}/items`;
const addItem = async (m, qty = 1) =>
  (await A.call("POST", itemsUrl, { requestId: uuid(), menuItemId: m.id, quantity: qty })).json.item.id;
const i1 = await addItem(menuA[0], 2);
const i2 = await addItem(menuA[1]);
const i3 = await addItem(menuA[0]);

console.log("\n-- kitchen queue");
const q = await KA.call("GET", "/api/kitchen/queue");
check("kitchen sees all three items", [i1, i2, i3].every((id) => q.json.items.some((x) => x.id === id)));
check("rows carry the table label", q.json.items.find((x) => x.id === i1)?.table_label === "1");
check("waiter can look at the queue too", (await A.call("GET", "/api/kitchen/queue")).status === 200);
const qb = await KB.call("GET", "/api/kitchen/queue");
check("restaurant B's kitchen sees none of A's items", !qb.json.items.some((x) => x.id === i1));

console.log("\n-- live stream");
check("unauthenticated stream -> 401", (await fetch(BASE + "/api/events/stream")).status === 401);
check(
  "garbage cursor -> 400",
  (await fetch(BASE + "/api/events/stream?after=abc", { headers: { cookie: KA.cookie } })).status === 400,
);
const streamA = await openStream(KA.cookie, q.json.cursor);
check("stream opens -> 200", streamA.status === 200);
const i4 = await addItem(menuA[1]);
check(
  "kitchen stream receives the new item",
  await waitFor(() => streamA.events.some((e) => e.data.type === "item_added" && e.data.itemId === i4)),
);

console.log("\n-- status changes");
check("waiter cannot start preparation -> 403", (await setStatus(A, i1, "new", "preparing")).status === 403);
check("a move that does not exist (new -> ready) -> 400", (await setStatus(KA, i1, "new", "ready")).status === 400);
const s1 = await setStatus(KA, i1, "new", "preparing");
check("kitchen starts preparation -> changed", s1.status === 200 && s1.json.changed === true && s1.json.item.status === "preparing");
check(
  "kitchen stream sees the change",
  await waitFor(() => streamA.events.some((e) => e.data.type === "item_status_changed" && e.data.itemId === i1)),
);
const s1b = await setStatus(KA, i1, "new", "preparing");
check("repeating the same tap -> 200, not changed", s1b.status === 200 && s1b.json.changed === false);
check("preparing -> ready", (await setStatus(KA, i1, "preparing", "ready")).status === 200);
const stale = await setStatus(KA, i1, "new", "preparing");
check("stale screen (still shows 'new') -> 409 with the real status", stale.status === 409 && stale.json?.error?.details?.status === "ready");
check("B's kitchen cannot touch A's item -> 404", (await setStatus(KB, i1, "ready", "served")).status === 404);
check("B's waiter cannot touch A's item -> 404", (await setStatus(B, i1, "ready", "served")).status === 404);
check("waiter marks it served -> 200", (await setStatus(A, i1, "ready", "served")).status === 200);
const mistake = await setStatus(KA, i3, "new", "preparing");
check("mistaken tap can be undone by the kitchen", mistake.status === 200 && (await setStatus(KA, i3, "preparing", "new")).status === 200);

console.log("\n-- concurrency");
const par = await Promise.all(Array.from({ length: 5 }, () => setStatus(KA, i2, "new", "preparing")));
check(
  "5 parallel identical taps: all 200, exactly one changed",
  par.every((r) => r.status === 200) && par.filter((r) => r.json.changed).length === 1,
);
const [cx, start] = await Promise.all([
  A.call("POST", `/api/order-items/${i3}/cancel`, {}),
  setStatus(KA, i3, "new", "preparing"),
]);
check(
  "cancel vs start race: exactly one wins",
  (cx.status === 200 && start.status === 409) || (cx.status === 409 && start.status === 200),
  `cancel=${cx.status} start=${start.status}`,
);
const final = (await A.call("GET", `/api/orders/${orderId}`)).json.items.find((i) => i.id === i3).status;
check("the loser's side is consistent with the winner", cx.status === 200 ? final === "cancelled" : final === "preparing", `final=${final}`);

console.log("\n-- reconnect");
streamA.close();
const cursorNow = (await KA.call("GET", "/api/kitchen/queue")).json.cursor;
await setStatus(KA, i2, "preparing", "ready"); // happens while no stream is connected
const stream2 = await openStream(KA.cookie, cursorNow);
check(
  "reconnecting with the last id replays what was missed",
  await waitFor(() => stream2.events.some((e) => e.data.type === "item_status_changed" && e.data.itemId === i2)),
);
await sleep(2500);
const ids = stream2.events.map((e) => e.id);
check("no event arrives twice", new Set(ids).size === ids.length);
check("event ids only go up", ids.every((id, k) => k === 0 || Number(id) > Number(ids[k - 1])));

console.log("\n-- isolation and revocation");
check("B's stream received nothing from A's activity", streamB.events.length === 0, `got ${streamB.events.length}`);
const latest = (await KA.call("GET", "/api/kitchen/queue")).json.cursor;
const stream3 = await openStream(KA.cookie, latest);
await admin.query(
  "UPDATE memberships SET is_active = false WHERE user_id = (SELECT id FROM users WHERE email = 'kitchen@a.test')",
);
check("a revoked member's stream is closed by the server", await waitFor(() => stream3.isEnded(), 5000));
await admin.query(
  "UPDATE memberships SET is_active = true WHERE user_id = (SELECT id FROM users WHERE email = 'kitchen@a.test')",
);

streamB.close();
stream2.close();
await admin.end();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);