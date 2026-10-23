import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    "SELECT id, slug FROM restaurants WHERE slug IN ('cafe-a', 'cafe-b')",
  );
  if (rows.length === 0) throw new Error("create the cafe-a / cafe-b users first");

  for (const r of rows) {
    for (const label of ["1", "2", "3"]) {
      await client.query(
        `INSERT INTO dining_tables (restaurant_id, label) VALUES ($1, $2)
         ON CONFLICT (restaurant_id, label) DO NOTHING`,
        [r.id, label],
      );
    }
    await client.query(
      `INSERT INTO menu_categories (restaurant_id, name)
       SELECT $1::uuid, 'نوشیدنی'
        WHERE NOT EXISTS (SELECT 1 FROM menu_categories
                           WHERE restaurant_id = $1::uuid AND name = 'نوشیدنی')`,
      [r.id],
    );
    await client.query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price_toman)
       SELECT $1::uuid, c.id, v.name, v.price
         FROM menu_categories c,
              (VALUES ('لاته', 185000), ('چای ماسالا', 120000)) AS v(name, price)
        WHERE c.restaurant_id = $1::uuid AND c.name = 'نوشیدنی'
          AND NOT EXISTS (SELECT 1 FROM menu_items m
                           WHERE m.restaurant_id = $1::uuid AND m.name = v.name)`,
      [r.id],
    );
    console.log("seeded", r.slug);
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}