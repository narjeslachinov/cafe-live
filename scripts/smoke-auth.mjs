import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failed = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${cond ? "" : extra}`);
  if (!cond) failed++;
}

const post = (path, body, headers = {}) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const me = (cookie) => fetch(BASE + "/api/auth/me", { headers: cookie ? { cookie } : {} });

const good = { email: "waiter@a.test", password: "Test-12345" };

// 1-2: wrong password and unknown user look identical
const r1 = await post("/api/auth/login", { ...good, password: "wrong" });
const r2 = await post("/api/auth/login", { email: "nobody@a.test", password: "wrong" });
check("wrong password -> 401", r1.status === 401);
check("unknown user -> 401", r2.status === 401);
check("same error body for both", (await r1.text()) === (await r2.text()));

// 3: good login sets an HttpOnly cookie
const ok = await post("/api/auth/login", good);
const setCookie = ok.headers.getSetCookie()[0] ?? "";
const cookie = setCookie.split(";")[0];
check("login ok -> 200", ok.status === 200);
check("cookie is HttpOnly + SameSite=Lax", /httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie));

// 4-6: session checks
const m1 = await me(cookie);
check("me with cookie -> 200 waiter", m1.status === 200 && (await m1.json()).user.role === "waiter");
check("me without cookie -> 401", (await me(null)).status === 401);
check("tampered cookie -> 401", (await me(cookie.slice(0, -3) + "xxx")).status === 401);

// 7: cross-origin POST is blocked
const evil = await post("/api/auth/login", good, { Origin: "https://evil.example" });
check("cross-origin login -> 403", evil.status === 403);

// 8: deactivating a membership revokes access immediately
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
await admin.connect();
await admin.query(
  "UPDATE memberships SET is_active = false WHERE user_id = (SELECT id FROM users WHERE email = $1)",
  [good.email],
);
check("deactivated member -> 401 right away", (await me(cookie)).status === 401);
await admin.query(
  "UPDATE memberships SET is_active = true WHERE user_id = (SELECT id FROM users WHERE email = $1)",
  [good.email],
);
await admin.end();
check("reactivated member -> 200 again", (await me(cookie)).status === 200);

// 9: brute force gets rate limited (uses a throwaway email)
let last = 0;
for (let i = 0; i < 11; i++) {
  last = (await post("/api/auth/login", { email: "brute@a.test", password: "x" })).status;
}
check("11th failed attempt -> 429", last === 429, `got ${last}`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);