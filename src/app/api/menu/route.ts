import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { route } from "@/server/http";

export const GET = route(async () => {
  const s = await requireSession();
  const rows = await withTenant(s.restaurantId, async (c) => {
    const r = await c.query<{
      category_id: string;
      category_name: string;
      id: string;
      name: string;
      description: string | null;
      price_toman: number;
    }>(
      `SELECT c.id AS category_id, c.name AS category_name,
              m.id, m.name, m.description, m.price_toman
         FROM menu_categories c
         JOIN menu_items m ON m.category_id = c.id AND m.restaurant_id = c.restaurant_id
        WHERE m.is_available
        ORDER BY c.sort_order, c.name, m.name`,
    );
    return r.rows;
  });

  const categories = new Map<string, { id: string; name: string; items: unknown[] }>();
  for (const r of rows) {
    if (!categories.has(r.category_id)) {
      categories.set(r.category_id, { id: r.category_id, name: r.category_name, items: [] });
    }
    categories.get(r.category_id)!.items.push({
      id: r.id,
      name: r.name,
      description: r.description,
      price_toman: r.price_toman,
    });
  }
  return Response.json({ categories: [...categories.values()] });
});