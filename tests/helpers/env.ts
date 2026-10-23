export const TEST_DB = "sarfaresh_test";
export const TEST_PORT = 3100;
export const BASE = `http://localhost:${TEST_PORT}`;
export const TEST_SESSION_SECRET = "test-only-secret-test-only-secret-0123456789";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run the tests with \`npm test\` so .env.local is loaded.`);
  return v;
}

function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

// Every connection string used by tests is forced to the test database by construction.
export const adminUrl = () => withDb(requireEnv("DATABASE_URL_ADMIN"), TEST_DB);
export const appUrl = () => withDb(requireEnv("DATABASE_URL"), TEST_DB);
export const maintenanceUrl = () => withDb(requireEnv("DATABASE_URL_ADMIN"), "postgres");