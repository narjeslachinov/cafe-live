import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "../../src/server/password.mjs";
import { adminUrl, appUrl } from "./env";

export const PASSWORD = "Test-pass-12345";
const passwordHash = hashPassword(PASSWORD); // one hash is enough for every test user

export type Item = { id: string; price: number };
export type Fixture = {
  id: string;
  slug: string;
  email: { waiter: string; waiter2: string; kitchen: string; manager: string };
  userIds: { waiter: string; waiter2: string; kitchen: string; manager: string };
  tables: string[]; // labels "1".."40", in order
  menu: { latte: Item; cake: Item; tea: Item; soldOut: Item };
};

export async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function appClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: appUrl() });
  await c.connect();
  return c;
}

/** One transaction as the restricted app role, with the tenant set (or deliberately not set). */
export async function asTenant<T>(c: pg.Client, restaurantId: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    if (restaurantId) await c.query("SELECT set_config('app.restaurant_id', $1, true)", [restaurantId]);
    const result = await fn();
    await c.query("COMMIT");
    return result;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}

export async function countWhere(sql: string, params: unknown[] = []): Promise<number> {
  return admin(async (c) => (await c.query(sql, params)).rows[0].n as number);
}

export async function createRestaurant(tag: string): Promise<Fixture> {
  const slug = `${tag}-${randomBytes(3).toString("hex")}`;
  const hash = await passwordHash;
  return admin(async (c) => {
    await c.query("BEGIN");
    try {
      const r = await c.query("INSERT INTO restaurants (name, slug) VALUES ($1, $2) RETURNING id", [`Test ${slug}`, slug]);
      const id: string = r.rows[0].id;

      const staff = [
        ["waiter", "waiter"], ["waiter2", "waiter"], ["kitchen", "kitchen"], ["manager", "manager"],
      ] as const;
      const email = {} as Fixture["email"];
      const userIds = {} as Fixture["userIds"];
      for (const [key, role] of staff) {
        const e = `${key}@${slug}.test`;
        const u = await c.query("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", [e, hash]);
        await c.query(
          "INSERT INTO memberships (user_id, restaurant_id, role, display_name) VALUES ($1, $2, $3, $4)",
          [u.rows[0].id, id, role, key],
        );
        email[key] = e;
        userIds[key] = u.rows[0].id;
      }

      const t = await c.query(
        `INSERT INTO dining_tables (restaurant_id, label)
         SELECT $1::uuid, g::text FROM generate_series(1, 40) g RETURNING id, label`,
        [id],
      );
      const tables = (t.rows as { id: string; label: string }[])
        .sort((a, b) => Number(a.label) - Number(b.label))
        .map((x) => x.id);

      const cat = await c.query(
        "INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'Drinks') RETURNING id",
        [id],
      );
      const item = async (name: string, price: number, available = true): Promise<Item> => {
        const m = await c.query(
          `INSERT INTO menu_items (restaurant_id, category_id, name, price_toman, is_available)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [id, cat.rows[0].id, name, price, available],
        );
        return { id: m.rows[0].id, price };
      };
      const menu = {
        latte: await item("Latte", 185000),
        cake: await item("Cheesecake", 220000),
        tea: await item("Tea", 85000),
        soldOut: await item("Sold-out stew", 440000, false),
      };

      await c.query("COMMIT");
      return { id, slug, email, userIds, tables, menu };
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  });
}