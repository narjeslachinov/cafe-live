export type DraftItem = {
  category: string;
  name: string;
  description: string | null;
  price_toman: number | null;
  flags: string[];
};

export const MAX_TEXT = 6000;
export const DEFAULT_CATEGORY = "سایر";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

/**
 * Makes pasted text predictable: ASCII digits, Persian ye/kaf, no invisible direction
 * characters (but the half-space U+200C is kept: Persian words need it).
 */
export function normalizeText(raw: string): string {
  return (
    raw
      .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " - ")
      .replace(/\s*[.…·_]{2,}\s*/g, " - ") // dotted leaders: "name ........ price"
      .replace(/\s+[–—]\s+/g, " - ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function priceFlags(price: number | null): string[] {
  if (price === null) return ["price_missing"];
  if (price < 10_000) return ["price_low"]; // probably written in thousands
  if (price > 5_000_000) return ["price_high"]; // probably rial, not toman
  return [];
}

function parsePrice(raw: string, unit?: string): { value: number | null; flags: string[] } {
  let s = raw.replace(/[٬،,]/g, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 185.000
  if (!/^\d+$/.test(s)) return { value: null, flags: ["price_unparsed"] };
  let v = Number(s);
  const flags: string[] = [];
  if (unit && /هزار/.test(unit)) v *= 1000;
  else if (!unit && v < 1000) {
    v *= 1000; // "185" on an Iranian menu almost always means 185,000 toman
    flags.push("price_unit_guessed");
  }
  if (!Number.isSafeInteger(v) || v > 1_000_000_000) return { value: null, flags: ["price_unparsed"] };
  return { value: v, flags };
}

// name, a separator (dash, colon, bar or just a space) and a price at the end of the line
const ITEM =
  /^(?<name>.+?)(?:\s*[-:|]\s*|\s+)(?<price>\d[\d,٬،.]*)\s*(?<unit>هزار\s*تومان|هزار|تومان|تومن|ت)?\s*$/u;

function toItem(g: Record<string, string | undefined>, category: string): DraftItem | null {
  let name = (g.name ?? "")
    .replace(/^[•*·▪●○◦\-–—\s]+/, "")
    .replace(/^\d{1,2}[.)]\s+/, "")
    .trim();
  let description: string | null = null;
  const d = /^(.*?)\s*[(（](.+)[)）]$/.exec(name);
  if (d) {
    name = d[1].trim();
    description = d[2].trim().slice(0, 300) || null;
  }
  if (!name || name.length > 100) return null;
  const p = parsePrice(g.price ?? "", g.unit);
  const flags = [...p.flags];
  if (name.length > 60) flags.push("name_long"); // probably several items glued into one line
  return { category, name, description, price_toman: p.value, flags };
}

export function parseRules(text: string): { items: DraftItem[]; ignored: string[] } {
  const items: DraftItem[] = [];
  const ignored: string[] = [];
  let category = DEFAULT_CATEGORY;
  let prevWasItem = false;
  let blankBefore = true;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^[\p{P}\p{S}\s]+$/u.test(line)) {
      blankBefore = true; // empty lines and dividers
      continue;
    }

    const m = ITEM.exec(line);
    if (m?.groups) {
      const item = toItem(m.groups, category);
      if (item) items.push(item);
      else ignored.push(line);
      prevWasItem = Boolean(item);
      blankBefore = false;
      continue;
    }

    const clean = line.replace(/^[=*#\-–—•\s]+|[=*#:\-–—\s]+$/g, "").trim();
    const decorated = clean !== line;
    const words = clean.split(/\s+/).length;

    // A longer line right under an item, with no gap, is that item's description.
    if (prevWasItem && !blankBefore && !decorated && (words >= 4 || clean.length > 30)) {
      const last = items[items.length - 1];
      if (last.description === null) {
        last.description = clean.slice(0, 300);
        prevWasItem = false;
        continue;
      }
    }

    // A short line without digits is a category heading.
    if (clean && clean.length <= 40 && !/\d/.test(clean)) {
      category = clean;
    } else {
      ignored.push(line);
    }
    prevWasItem = false;
    blankBefore = false;
  }
  return { items, ignored };
}

/** The rules are not enough: too few items, too many lines they could not read, or glued lines. */
export function needsAi(r: { items: DraftItem[]; ignored: string[] }): boolean {
  const total = r.items.length + r.ignored.length;
  return (
    r.items.length < 3 ||
    r.ignored.length / total > 0.2 ||
    r.items.some((i) => i.flags.includes("name_long"))
  );
}