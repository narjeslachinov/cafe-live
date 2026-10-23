import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import pg from "pg";
import {
  BASE,
  TEST_DB,
  TEST_PORT,
  TEST_SESSION_SECRET,
  adminUrl,
  appUrl,
  maintenanceUrl,
  requireEnv,
} from "./helpers/env";

let server: ChildProcess | undefined;
let output = "";

const ZERO = "00000000-0000-4000-8000-000000000000";

async function warmUp() {
  // Dev mode compiles each route on first use. Do it once, up front, in parallel.
  const targets: [string, string][] = [
    ["GET", "/api/auth/me"], ["POST", "/api/auth/login"], ["POST", "/api/auth/logout"],
    ["GET", "/api/tables"], ["GET", "/api/menu"], ["POST", "/api/orders"],
    ["GET", `/api/orders/${ZERO}`], ["POST", `/api/orders/${ZERO}/items`],
    ["POST", `/api/orders/${ZERO}/close`], ["POST", `/api/order-items/${ZERO}/cancel`],
    ["POST", `/api/order-items/${ZERO}/status`], ["GET", "/api/kitchen/queue"],
    ["GET", "/api/events/stream"],
  ];
  await Promise.all(
    targets.map(([method, p]) =>
      fetch(BASE + p, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      }).catch(() => {}),
    ),
  );
}

export async function setup() {
  requireEnv("DATABASE_URL_ADMIN");
  requireEnv("DATABASE_URL");
  requireEnv("APP_DB_PASSWORD");

  // 1. A brand-new database, so no run can depend on the previous one.
  const m = new pg.Client({ connectionString: maintenanceUrl() });
  await m.connect();
  await m.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await m.query(`CREATE DATABASE ${TEST_DB}`);
  await m.end();

  // 2. The real migration script, so migrations are tested too.
  const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL_ADMIN: adminUrl() },
    encoding: "utf8",
  });
  if (mig.status !== 0) throw new Error(`migration failed:\n${mig.stdout}\n${mig.stderr}`);

  // 3. The real application, pointed at the test database.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: appUrl(),
    SESSION_SECRET: TEST_SESSION_SECRET,
    LOG_LEVEL: "warn",
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];

  const nextBin = path.resolve("node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(TEST_PORT)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => (output += d));
  server.stderr?.on("data", (d) => (output += d));
  let exited = false;
  server.on("exit", () => (exited = true));

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited) {
      throw new Error(
        `The test server exited early. Is \`npm run dev\` still running? Stop it and try again.\n${output.slice(-1500)}`,
      );
    }
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`The test server did not start in 90s.\n${output.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await warmUp();
}

export async function teardown() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]); // also kills Next's workers
  } else {
    server.kill("SIGTERM");
  }
}