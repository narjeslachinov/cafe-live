import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const { DATABASE_URL_ADMIN, APP_DB_PASSWORD } = process.env;
if (!DATABASE_URL_ADMIN || !APP_DB_PASSWORD) {
  console.error("DATABASE_URL_ADMIN and APP_DB_PASSWORD are required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL_ADMIN });
await client.connect();

try {
  // App role is created before migrations so the GRANTs in them succeed.
  const pw = client.escapeLiteral(APP_DB_PASSWORD);
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'sarfaresh_app'");
  if (role.rowCount === 0) {
    await client.query(`CREATE ROLE sarfaresh_app LOGIN PASSWORD ${pw} NOSUPERUSER NOBYPASSRLS`);
  } else {
    await client.query(`ALTER ROLE sarfaresh_app LOGIN PASSWORD ${pw}`);
  }

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  const dir = path.resolve("db/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (done.rowCount) continue;

    await client.query("BEGIN");
    try {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("applied", file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}