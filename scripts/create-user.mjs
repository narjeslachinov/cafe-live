import pg from "pg";
import { parseArgs } from "node:util";
import { hashPassword } from "../src/server/password.mjs";

const { values: a } = parseArgs({
  options: {
    slug: { type: "string" },
    restaurant: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    role: { type: "string" },
    name: { type: "string" },
  },
});

for (const k of ["slug", "restaurant", "email", "password", "role", "name"]) {
  if (!a[k]) {
    console.error(`missing --${k}`);
    process.exit(1);
  }
}
if (!["waiter", "kitchen", "manager"].includes(a.role)) {
  console.error("role must be waiter, kitchen or manager");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await client.connect();
try {
  await client.query("BEGIN");
  const r = await client.query(
    `INSERT INTO restaurants (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
    [a.restaurant, a.slug],
  );
  const hash = await hashPassword(a.password);
  const u = await client.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
    [a.email, hash],
  );
  await client.query(
    `INSERT INTO memberships (user_id, restaurant_id, role, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, restaurant_id)
       DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name, is_active = true`,
    [u.rows[0].id, r.rows[0].id, a.role, a.name],
  );
  await client.query("COMMIT");
  console.log(`ok: ${a.email} -> ${a.slug} (${a.role})`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}