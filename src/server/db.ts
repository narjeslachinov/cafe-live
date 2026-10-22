import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { env } from "@/lib/env";

const g = globalThis as unknown as { __pool?: Pool };

export const pool =
  g.__pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    statement_timeout: 5000,
  });

if (process.env.NODE_ENV !== "production") g.__pool = pool;

const uuidSchema = z.string().uuid();

/**
 * Every tenant-scoped query MUST go through this.
 * set_config(..., true) is transaction-local, so the tenant can never
 * leak to the next request that reuses this pooled connection.
 */
export async function withTenant<T>(
  restaurantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const rid = uuidSchema.parse(restaurantId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.restaurant_id', $1, true)", [rid]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}