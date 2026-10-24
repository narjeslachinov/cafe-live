import type { PoolClient } from "pg";
import { HttpError } from "./http";
import { logEvent } from "./orders";

export type ManagedItem = {
  id: string;
  name: string;
  description: string | null;
  price_toman: number;
  is_available: boolean;
};

export async function listMenuForManager(client: PoolClient) {
  const r = await client.query(
    `SELECT c.id AS category_id, c.name AS category_name,
            m.id, m.name, m.description, m.price_toman, m.is_available
       FROM menu_categories c
       LEFT JOIN menu_items m ON m.category_id = c.id AND m.restaurant_id = c.restaurant_id
      ORDER BY c.sort_order, c.name, m.name`,
  );
  const cats = new Map<string, { id: string; name: string; items: ManagedItem[] }>();
  for (const row of r.rows) {
    if (!cats.has(row.category_id)) cats.set(row.category_id, { id: row.category_id, name: row.category_name, items: [] });
    if (row.id) {
      cats.get(row.category_id)!.items.push({
        id: row.id, name: row.name, description: row.description,
        price_toman: row.price_toman, is_available: row.is_available,
      });
    }
  }
  return { categories: [...cats.values()] };
}

export async function updateMenuItem(
  client: PoolClient,
  p: { id: string; price?: number; available?: boolean; userId: string },
) {
  const r = await client.query(
    `WITH old AS (
       SELECT id, price_toman, is_available FROM menu_items WHERE id = $1 FOR UPDATE
     )
     UPDATE menu_items m
        SET price_toman = COALESCE($2::int, m.price_toman),
            is_available = COALESCE($3::boolean, m.is_available)
       FROM old
      WHERE m.id = old.id
      RETURNING m.id, m.name, m.description, m.price_toman, m.is_available,
                old.price_toman AS old_price, old.is_available AS old_available`,
    [p.id, p.price ?? null, p.available ?? null],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, "Menu item not found", "menu_item_not_found");

  // Saving the same values again changes nothing, so it announces nothing.
  if (row.old_price !== row.price_toman || row.old_available !== row.is_available) {
    await logEvent(client, {
      type: "menu_changed",
      actorId: p.userId,
      payload: {
        itemId: p.id,
        oldPrice: row.old_price,
        newPrice: row.price_toman,
        oldAvailable: row.old_available,
        newAvailable: row.is_available,
      },
    });
  }
  return row;
}

export type NewItem = { category: string; name: string; description?: string | null; price_toman: number };

/** Adds items; names that already exist are skipped, so sending the same batch twice is harmless. */
export async function commitItems(client: PoolClient, input: NewItem[], userId: string) {
      // A fixed order keeps two imports running together from deadlocking on category creation.
  const items = [...input].sort(
    (a, b) => a.category.toLowerCase().localeCompare(b.category.toLowerCase()) || a.name.localeCompare(b.name),
  );
  const categoryIds = new Map<string, string>();
  let created = 0;
  const skipped: string[] = [];

  for (const it of items) {
    const key = it.category.toLowerCase();
    let categoryId = categoryIds.get(key);
    if (!categoryId) {
      await client.query(
        `INSERT INTO menu_categories (restaurant_id, name, sort_order)
         SELECT app_restaurant_id(), $1::text, coalesce(max(sort_order), -1) + 1 FROM menu_categories
         ON CONFLICT (restaurant_id, lower(name)) DO NOTHING`,
        [it.category],
      );
      const c = await client.query<{ id: string }>(
        "SELECT id FROM menu_categories WHERE lower(name) = lower($1)",
        [it.category],
      );
      categoryId = c.rows[0].id;
      categoryIds.set(key, categoryId);
    }
    const ins = await client.query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, description, price_toman)
       VALUES (app_restaurant_id(), $1, $2, $3, $4)
       ON CONFLICT (restaurant_id, lower(name)) DO NOTHING
       RETURNING id`,
      [categoryId, it.name, it.description ?? null, it.price_toman],
    );
    if (ins.rows[0]) created++;
    else skipped.push(it.name);
  }
   if (created > 0) {
    await logEvent(client, { type: "menu_changed", actorId: userId, payload: { added: created } });
  }
  return { created, skipped };
}