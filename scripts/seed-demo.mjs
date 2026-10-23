import pg from "pg";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/server/password.mjs";

const PASSWORD = process.env.DEMO_PASSWORD || "Demo-1234!";
const HISTORY_DAYS = 14;
const TEHRAN_OFFSET_MIN = 210; // Iran dropped daylight saving in 2022: UTC+3:30 all year
const MIN = 60_000;

const toFa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const round5000 = (n) => Math.round(n / 5000) * 5000;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedIndex(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

// [name, description, price (toman, approximate), popularity weight, available?]
const MENU = [
  ["قهوه و نوشیدنی گرم", [
    ["اسپرسو", "دو شات قهوهٔ عربیکا", 120000, 5],
    ["آمریکانو", null, 140000, 5],
    ["کاپوچینو", null, 180000, 8],
    ["لاته", "اسپرسو و شیر بخارداده", 185000, 12],
    ["چای ماسالا", "چای با ادویه و شیر", 140000, 6],
    ["هات‌چاکلت", null, 170000, 4],
    ["چای ایرانی", "قوری دم‌کرده با نبات", 85000, 9],
  ]],
  ["نوشیدنی سرد", [
    ["آیس‌لاته", null, 195000, 6],
    ["لیموناد", "لیموی تازه و نعنا", 110000, 5],
    ["شیک شکلات", null, 210000, 4],
    ["دوغ محلی", null, 70000, 7],
    ["نوشابه", null, 55000, 6],
    ["آب معدنی", null, 35000, 5],
  ]],
  ["پیش‌غذا", [
    ["سوپ جو", "با سبزیجات و خامه", 160000, 4],
    ["سالاد سزار", "با مرغ گریل‌شده", 280000, 5],
    ["کشک بادمجان", "با نان تازه", 250000, 5],
    ["میرزاقاسمی", "با نان تازه", 290000, 4],
  ]],
  ["غذای اصلی", [
    ["کباب کوبیده", "دو سیخ با برنج، کره و گوجه کبابی", 480000, 14],
    ["جوجه‌کباب", "سینهٔ مرغ زعفرانی با برنج", 550000, 12],
    ["زرشک‌پلو با مرغ", null, 420000, 10],
    ["قورمه‌سبزی", "با برنج ایرانی", 460000, 7],
    ["قیمه", "با سیب‌زمینی سرخ‌کرده و برنج", 440000, 6, false], // sold out today
    ["برگر مخصوص", "با سیب‌زمینی", 380000, 8],
    ["پاستا آلفردو", null, 360000, 5],
    ["پیتزا مارگاریتا", null, 350000, 5],
  ]],
  ["دسر", [
    ["چیزکیک", "با سس توت‌فرنگی", 220000, 6],
    ["براونی", "با بستنی وانیل", 200000, 5],
    ["شیر برنج", "با دارچین", 150000, 3],
  ]],
];

const BAGH_EXCLUDE = new Set([
  "سوپ جو", "کشک بادمجان", "میرزاقاسمی", "کباب کوبیده", "جوجه‌کباب",
  "زرشک‌پلو با مرغ", "قورمه‌سبزی", "قیمه", "دوغ محلی",
]);

// Live scene. Item: [name, quantity, status, minutes ago it was added, note?]
const RESTAURANTS = [
  {
    slug: "niloofar",
    name: "کافه‌رستوران نیلوفر",
    seed: 1101,
    perDay: 30,
    priceFactor: 1,
    exclude: new Set(),
    tables: [
      ...Array.from({ length: 10 }, (_, i) => [toFa(i + 1), [2, 2, 4, 4, 4, 4, 6, 6, 8, 4][i]]),
      ["تراس ۱", 4],
      ["تراس ۲", 4],
    ],
    staff: [
      { email: "waiter@niloofar.test", name: "علی رضایی", role: "waiter" },
      { email: "waiter2@niloofar.test", name: "سارا کریمی", role: "waiter" },
      { email: "kitchen@niloofar.test", name: "رضا احمدی", role: "kitchen" },
      { email: "manager@niloofar.test", name: "مریم حسینی", role: "manager" },
    ],
    live: [
      { table: "۳", openedAgo: 48, waiter: 0, items: [
        ["کباب کوبیده", 1, "served", 45], ["جوجه‌کباب", 1, "served", 45],
        ["دوغ محلی", 2, "served", 44], ["چای ایرانی", 2, "preparing", 6],
        ["چیزکیک", 2, "new", 3],
      ]},
      { table: "۵", openedAgo: 6, waiter: 1, items: [
        ["لاته", 2, "new", 4, "کم‌شیرین"], ["براونی", 1, "new", 4],
      ]},
      { table: "۷", openedAgo: 25, waiter: 0, items: [
        ["زرشک‌پلو با مرغ", 2, "ready", 22], ["سالاد سزار", 1, "ready", 22],
        ["نوشابه", 2, "served", 21],
      ]},
      { table: "۲", openedAgo: 70, waiter: 1, items: [
        ["پاستا آلفردو", 1, "served", 66], ["برگر مخصوص", 1, "cancelled", 65],
        ["پیتزا مارگاریتا", 1, "served", 64], ["آب معدنی", 2, "served", 63],
      ]},
      { table: "تراس ۱", openedAgo: 12, waiter: 0, items: [
        ["پیتزا مارگاریتا", 1, "preparing", 10], ["برگر مخصوص", 1, "preparing", 10, "بدون پیاز"],
        ["لیموناد", 2, "ready", 9], ["آب معدنی", 2, "served", 9],
      ]},
      { table: "۹", openedAgo: 2, waiter: 1, items: [
        ["کاپوچینو", 2, "new", 1], ["اسپرسو", 1, "new", 1],
      ]},
      { table: "۱۰", openedAgo: 33, waiter: 0, items: [
        ["کشک بادمجان", 1, "served", 30], ["قورمه‌سبزی", 2, "preparing", 14],
        ["دوغ محلی", 2, "served", 29],
      ]},
    ],
  },
  {
    slug: "bagh",
    name: "کافه باغ",
    seed: 2207,
    perDay: 18,
    priceFactor: 1.1,
    exclude: BAGH_EXCLUDE,
    tables: [
      ...Array.from({ length: 6 }, (_, i) => [toFa(i + 1), [2, 2, 2, 4, 4, 6][i]]),
      ["حیاط ۱", 4],
      ["حیاط ۲", 6],
    ],
    staff: [
      { email: "waiter@bagh.test", name: "نیما صادقی", role: "waiter" },
      { email: "kitchen@bagh.test", name: "حمید قاسمی", role: "kitchen" },
      { email: "manager@bagh.test", name: "شیدا موسوی", role: "manager" },
    ],
    live: [
      { table: "۲", openedAgo: 14, waiter: 0, items: [
        ["کاپوچینو", 2, "preparing", 9], ["چیزکیک", 1, "new", 9],
      ]},
      { table: "حیاط ۱", openedAgo: 30, waiter: 0, items: [
        ["پیتزا مارگاریتا", 1, "ready", 26], ["لیموناد", 2, "served", 25],
      ]},
    ],
  },
];

async function bulkInsert(client, sql, columns, rows, chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await client.query(sql, columns.map((_, c) => part.map((r) => r[c])));
  }
}

async function seedRestaurant(client, cfg, nowMs) {
  const rng = mulberry32(cfg.seed);
  const rid = (
    await client.query("INSERT INTO restaurants (name, slug) VALUES ($1, $2) RETURNING id", [cfg.name, cfg.slug])
  ).rows[0].id;

  // --- staff
  const staff = [];
  for (const s of cfg.staff) {
    const u = await client.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [s.email, await hashPassword(PASSWORD)],
    );
    await client.query(
      "INSERT INTO memberships (user_id, restaurant_id, role, display_name) VALUES ($1, $2, $3, $4)",
      [u.rows[0].id, rid, s.role, s.name],
    );
    staff.push({ ...s, id: u.rows[0].id });
  }
  const waiters = staff.filter((s) => s.role === "waiter");

  // --- tables
  const tables = [];
  for (const [label, seats] of cfg.tables) {
    const t = await client.query(
      "INSERT INTO dining_tables (restaurant_id, label, seats) VALUES ($1, $2, $3) RETURNING id",
      [rid, label, seats],
    );
    tables.push({ id: t.rows[0].id, label });
  }
  const tableByLabel = new Map(tables.map((t) => [t.label, t.id]));

  // --- menu
  const menu = [];
  let sort = 0;
  for (const [cat, entries] of MENU) {
    const list = entries.filter((e) => !cfg.exclude.has(e[0]));
    if (list.length === 0) continue;
    const c = await client.query(
      "INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id",
      [rid, cat, sort++],
    );
    for (const [name, description, basePrice, weight, available = true] of list) {
      const price = round5000(basePrice * cfg.priceFactor);
      const m = await client.query(
        `INSERT INTO menu_items (restaurant_id, category_id, name, description, price_toman, is_available)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [rid, c.rows[0].id, name, description, price, available],
      );
      menu.push({ id: m.rows[0].id, name, price, weight });
    }
  }
  const menuByName = new Map(menu.map((m) => [m.name, m]));

  // --- history: closed orders over the last two weeks
  const orders = [];
  const items = [];
  const busyUntil = new Map();
  const liveTableIds = cfg.live.map((l) => {
    const id = tableByLabel.get(l.table);
    if (!id) throw new Error(`live scene: unknown table ${l.table} in ${cfg.slug}`);
    return id;
  });

  const SLOTS = [ // [from minute of day, to minute of day, weight] in Tehran local time
    [10 * 60, 12 * 60, 2],
    [12 * 60 + 30, 15 * 60, 4],
    [16 * 60, 18 * 60 + 30, 3],
    [19 * 60 + 30, 22 * 60 + 30, 5],
  ];
  const localNow = new Date(nowMs + TEHRAN_OFFSET_MIN * MIN);
  const [Y, M, D] = [localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()];

  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = new Date(Date.UTC(Y, M, D - back));
    const dow = day.getUTCDay(); // 4 = Thursday, 5 = Friday
    const dayFactor = dow === 5 ? 1.6 : dow === 4 ? 1.4 : 1;
    if (back === 0) for (const id of liveTableIds) busyUntil.set(id, nowMs);
    const cutoff = back === 0 ? nowMs - 100 * MIN : Infinity;

    const count = Math.round(cfg.perDay * dayFactor * (0.8 + rng() * 0.4));
    const opens = [];
    for (let k = 0; k < count; k++) {
      const slot = SLOTS[weightedIndex(rng, SLOTS.map((s) => s[2]))];
      opens.push(slot[0] + Math.floor(rng() * (slot[1] - slot[0])));
    }
    opens.sort((a, b) => a - b);

    for (const minute of opens) {
      const openedMs =
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minute) -
        TEHRAN_OFFSET_MIN * MIN;
      if (openedMs > cutoff) continue;

      const start = Math.floor(rng() * tables.length);
      let table = null;
      for (let k = 0; k < tables.length; k++) {
        const t = tables[(start + k) % tables.length];
        if ((busyUntil.get(t.id) ?? 0) <= openedMs) {
          table = t;
          break;
        }
      }
      if (!table) continue; // restaurant was full at that moment

      const closedMs = openedMs + (25 + Math.floor(rng() * 60)) * MIN;
      busyUntil.set(table.id, closedMs + 5 * MIN);
      const waiter = waiters[Math.floor(rng() * waiters.length)];
      const orderId = randomUUID();
      orders.push([orderId, rid, table.id, "closed", waiter.id,
        new Date(openedMs).toISOString(), new Date(closedMs).toISOString()]);

      const lines = 1 + weightedIndex(rng, [1, 3, 4, 3, 2, 1]);
      for (let l = 0; l < lines; l++) {
        const m = menu[weightedIndex(rng, menu.map((x) => x.weight))];
        const qty = 1 + weightedIndex(rng, [70, 25, 5]);
        const cancelled = rng() < 0.03;
        const createdMs = openedMs + Math.floor(rng() * 15) * MIN;
        const updatedMs = cancelled
          ? createdMs + 2 * MIN
          : Math.min(createdMs + (10 + Math.floor(rng() * 20)) * MIN, closedMs);
        // The menu got ~8% dearer a week ago; old orders keep the price they were made at.
        const price = back >= 7 ? round5000(m.price / 1.08) : m.price;
        items.push([randomUUID(), rid, orderId, m.id, m.name, price, qty, null,
          cancelled ? "cancelled" : "served", cancelled ? 2 : 4, randomUUID(), waiter.id,
          new Date(createdMs).toISOString(), new Date(updatedMs).toISOString()]);
      }
    }
  }

  // --- live scene: orders open right now
  const STEPS = { new: 0, preparing: 1, ready: 2, served: 3, cancelled: 1 };
  const SHARE = { preparing: 0.6, ready: 0.4, served: 0.25, cancelled: 0.5 };
  for (const o of cfg.live) {
    const waiter = waiters[o.waiter % waiters.length];
    const orderId = randomUUID();
    orders.push([orderId, rid, tableByLabel.get(o.table), "open", waiter.id,
      new Date(nowMs - o.openedAgo * MIN).toISOString(), null]);
    for (const [name, qty, status, agoMin, note] of o.items) {
      const m = menuByName.get(name);
      if (!m) throw new Error(`live scene: ${name} is not on the ${cfg.slug} menu`);
      const updatedAgo = status === "new" ? agoMin : Math.max(1, Math.floor(agoMin * SHARE[status]));
      items.push([randomUUID(), rid, orderId, m.id, m.name, m.price, qty, note ?? null,
        status, 1 + STEPS[status], randomUUID(), waiter.id,
        new Date(nowMs - agoMin * MIN).toISOString(), new Date(nowMs - updatedAgo * MIN).toISOString()]);
    }
  }

  await bulkInsert(
    client,
    `INSERT INTO orders (id, restaurant_id, table_id, status, opened_by, opened_at, closed_at)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::order_status[], $5::uuid[],
                          $6::timestamptz[], $7::timestamptz[])`,
    [0, 1, 2, 3, 4, 5, 6],
    orders,
  );
  await bulkInsert(
    client,
    `INSERT INTO order_items (id, restaurant_id, order_id, menu_item_id, name_snapshot,
                             unit_price_toman, quantity, note, status, version, request_id,
                             added_by, created_at, updated_at)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::int[],
                          $7::int[], $8::text[], $9::item_status[], $10::int[], $11::uuid[],
                          $12::uuid[], $13::timestamptz[], $14::timestamptz[])`,
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    items,
  );

  return { slug: cfg.slug, orders: orders.length, items: items.length, live: cfg.live.length };
}

async function verify(client, slugs) {
  const from = `
    FROM order_items i
    JOIN orders o ON o.id = i.order_id AND o.restaurant_id = i.restaurant_id
    JOIN restaurants r ON r.id = i.restaurant_id
   WHERE r.slug = ANY($1)`;
  const checks = [
    ["closed orders with unfinished items", `o.status = 'closed' AND i.status NOT IN ('served', 'cancelled')`],
    ["items created before their order opened", `i.created_at < o.opened_at`],
    ["items updated after their order closed", `o.closed_at IS NOT NULL AND i.updated_at > o.closed_at`],
    ["items dated in the future", `(i.created_at > now() OR i.updated_at > now())`],
  ];
  for (const [label, cond] of checks) {
    const r = await client.query(
      `SELECT r.slug, o.id AS order_id, i.name_snapshot, i.status,
              i.created_at, i.updated_at, o.opened_at, o.closed_at
       ${from} AND ${cond} LIMIT 5`,
      [slugs],
    );
    if (r.rows.length > 0) {
      console.error(`seed check failed: ${label} (showing up to 5)`);
      console.table(r.rows);
      throw new Error(`seed check failed: ${label}`);
    }
  }
}

const slugs = RESTAURANTS.map((r) => r.slug);
const emails = RESTAURANTS.flatMap((r) => r.staff.map((s) => s.email.toLowerCase()));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await client.connect();
try {
  await client.query("BEGIN");
  // Only the demo restaurants and demo users are touched. Cascades remove their orders.
  await client.query("DELETE FROM restaurants WHERE slug = ANY($1)", [slugs]);
  await client.query("DELETE FROM users WHERE lower(email) = ANY($1)", [emails]);

  const nowMs = Date.now();
  const results = [];
  for (const cfg of RESTAURANTS) results.push(await seedRestaurant(client, cfg, nowMs));
  await verify(client);
  await client.query("COMMIT");

  for (const r of results) {
    console.log(`${r.slug}: ${r.orders} orders (${r.live} open), ${r.items} items`);
  }
  console.log("\nDemo logins (password from DEMO_PASSWORD, default shown in README):");
  for (const r of RESTAURANTS) for (const s of r.staff) console.log(`  ${s.email.padEnd(26)} ${s.role}`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}