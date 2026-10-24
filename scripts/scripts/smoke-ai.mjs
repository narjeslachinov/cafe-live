const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "manager@niloofar.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-1234!";

// Messy on purpose: prices in words, several items on one line, a sentence that is not a menu item.
const SAMPLE = `قهوه‌ها: اسپرسو دوبل صد و سی هزار تومان، لاته صد و هشتاد، موکا ۱۹۵ هزار
تیرامیسو خانگی با ماسکارپونه — دویست و چهل
سلام! ما مواد اولیه را هر روز تازه تهیه می‌کنیم.
چای ایرانی (قوری) هشتاد و پنج`;

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const started = Date.now();
const res = await fetch(`${BASE}/api/manage/menu-import/draft`, {
  method: "POST",
  headers: { cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ text: SAMPLE, mode: "ai" }),
});
const body = await res.json();
console.log(`HTTP ${res.status} in ${Date.now() - started} ms`);
if (!res.ok) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(`source: ${body.source}   notice: ${body.notice}`);
console.table(body.items.map((i) => ({ category: i.category, name: i.name, price: i.price_toman, flags: i.flags.join(",") })));