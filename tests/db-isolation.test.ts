import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, appClient, asTenant, createRestaurant, type Fixture } from "./helpers/db";

const TENANT_TABLES = [
  "restaurants", "memberships", "dining_tables", "menu_categories",
  "menu_items", "orders", "order_items", "order_events","ai_requests",
];

let A: Fixture;
let B: Fixture;
let db: pg.Client; // connected as the restricted application role
const seeded: Record<string, { orderId: string; requestId: string }> = {};

beforeAll(async () => {
  A = await createRestaurant("iso-a");
  B = await createRestaurant("iso-b");
  for (const f of [A, B]) {
    seeded[f.slug] = await admin(async (c) => {
      const o = await c.query(
        "INSERT INTO orders (restaurant_id, table_id, opened_by) VALUES ($1, $2, $3) RETURNING id",
        [f.id, f.tables[0], f.userIds.waiter],
      );
      const requestId = randomUUID();
      await c.query(
        `INSERT INTO order_items (restaurant_id, order_id, menu_item_id, name_snapshot,
                                  unit_price_toman, quantity, request_id, added_by)
         VALUES ($1, $2, $3, 'seed', 1000, 1, $4, $5)`,
        [f.id, o.rows[0].id, f.menu.latte.id, requestId, f.userIds.waiter],
      );
      await c.query(
        "INSERT INTO order_events (restaurant_id, order_id, type, actor_id) VALUES ($1, $2, 'order_opened', $3)",
        [f.id, o.rows[0].id, f.userIds.waiter],
      );
      await c.query(
        "INSERT INTO ai_requests (restaurant_id, user_id, feature, provider, input_chars) VALUES ($1, $2, 'menu_import', 'mock', 10)",
        [f.id, f.userIds.manager],
      );
      return { orderId: o.rows[0].id, requestId };
    });
  }
  db = await appClient();
});

afterAll(async () => {
  await db.end();
});

describe("row level security", () => {
  it.each(TENANT_TABLES)("%s: with no tenant set, no row is visible", async (table) => {
    const r = await asTenant(db, null, () => db.query(`SELECT count(*)::int AS n FROM ${table}`));
    expect(r.rows[0].n).toBe(0);
  });

  it.each(TENANT_TABLES)("%s: tenant A sees its own rows and none of B's", async (table) => {
    const col = table === "restaurants" ? "id" : "restaurant_id";
    const r = await asTenant(db, A.id, () =>
      db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE ${col} <> $1)::int AS foreign_rows FROM ${table}`,
        [A.id],
      ),
    );
    expect(r.rows[0].total).toBeGreaterThan(0); // not vacuous: A really has rows here
    expect(r.rows[0].foreign_rows).toBe(0);
  });

  it("cannot insert into another restaurant", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query("INSERT INTO dining_tables (restaurant_id, label) VALUES ($1, 'hack')", [B.id]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot move a row into another restaurant", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query("UPDATE dining_tables SET restaurant_id = $1 WHERE id = $2", [B.id, A.tables[1]]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("an update aimed at another restaurant's row changes nothing", async () => {
    const r = await asTenant(db, A.id, () =>
      db.query("UPDATE menu_items SET price_toman = 1 WHERE id = $1", [B.menu.latte.id]),
    );
    expect(r.rowCount).toBe(0);
    const price = await admin((c) => c.query("SELECT price_toman FROM menu_items WHERE id = $1", [B.menu.latte.id]));
    expect(price.rows[0].price_toman).toBe(B.menu.latte.price);
  });

  it("the tenant setting does not survive the transaction on a reused connection", async () => {
    await asTenant(db, A.id, async () => {});
    const r = await db.query("SELECT count(*)::int AS n FROM orders"); // same connection, no tenant now
    expect(r.rows[0].n).toBe(0);
  });
});

describe("composite foreign keys (the second lock behind RLS)", () => {
  it("an order item of restaurant A cannot point at a menu item of restaurant B", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query(
          `INSERT INTO order_items (restaurant_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_toman, quantity, request_id, added_by)
           VALUES ($1, $2, $3, 'x', 1, 1, gen_random_uuid(), $4)`,
          [A.id, seeded[A.slug].orderId, B.menu.latte.id, A.userIds.waiter],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("an order of restaurant A cannot be put on a table of restaurant B", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query("INSERT INTO orders (restaurant_id, table_id, opened_by) VALUES ($1, $2, $3)", [
          A.id, B.tables[5], A.userIds.waiter,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("what the application role is not allowed to do", () => {
  it("cannot read the users table", async () => {
    await expect(db.query("SELECT 1 FROM users")).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot delete anything", async () => {
    await expect(db.query("DELETE FROM orders")).rejects.toMatchObject({ code: "42501" });
  });

  it("can look up a login only through the dedicated function", async () => {
    const r = await db.query("SELECT user_id, restaurant_id FROM auth_find_login($1)", [A.email.waiter]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].restaurant_id).toBe(A.id);
  });
});

describe("rules the database itself enforces", () => {
  it("allows only one open order per table", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query("INSERT INTO orders (restaurant_id, table_id, opened_by) VALUES ($1, $2, $3)", [
          A.id, A.tables[0], A.userIds.waiter,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a zero quantity", async () => {
    await expect(
      asTenant(db, A.id, () =>
        db.query(
          `INSERT INTO order_items (restaurant_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_toman, quantity, request_id, added_by)
           VALUES ($1, $2, $3, 'x', 1, 0, gen_random_uuid(), $4)`,
          [A.id, seeded[A.slug].orderId, A.menu.latte.id, A.userIds.waiter],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("scopes idempotency keys per restaurant: the same key in another restaurant is not a conflict", async () => {
    // If it were global, a duplicate-key error would reveal that another tenant used that key.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO order_items (restaurant_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_toman, quantity, request_id, added_by)
           VALUES ($1, $2, $3, 'x', 1, 1, $4, $5)`,
          [B.id, seeded[B.slug].orderId, B.menu.latte.id, seeded[A.slug].requestId, B.userIds.waiter],
        ),
      ),
    ).resolves.toBeDefined();
  });
});