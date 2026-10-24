import { env } from "@/lib/env";
import { normalizeText, parseRules } from "./text";

export class ProviderError extends Error {
  constructor(
    public kind: "timeout" | "http" | "network" | "empty",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export type Completion = { text: string; inputTokens: number | null; outputTokens: number | null };

export const aiEnabled = () => Boolean(env.AI_PROVIDER);

type Json = Record<string, unknown>;

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new ProviderError("timeout", "provider timed out");
    throw new ProviderError("network", "provider unreachable");
  }
  // Never put the response body in an error: it may echo the prompt.
  if (!res.ok) throw new ProviderError("http", `provider answered HTTP ${res.status}`, res.status);
  try {
    return (await res.json()) as Json;
  } catch {
    throw new ProviderError("empty", "provider answered with invalid JSON");
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : null);

async function anthropic(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<Completion> {
  const base = env.AI_BASE_URL ?? "https://api.anthropic.com";
  const data = await post(
    `${base}/v1/messages`,
    { "x-api-key": env.AI_API_KEY!, "anthropic-version": "2023-06-01" },
    { model: env.AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
    signal,
  );
  const blocks = Array.isArray(data.content) ? (data.content as { type?: string; text?: string }[]) : [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  if (!text) throw new ProviderError("empty", "provider answered with no text");
  const usage = (data.usage ?? {}) as Json;
  return { text, inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) };
}

async function openai(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<Completion> {
  const base = env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const data = await post(
    `${base}/chat/completions`,
    { authorization: `Bearer ${env.AI_API_KEY}` },
    {
      model: env.AI_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    },
    signal,
  );
  const choices = Array.isArray(data.choices) ? (data.choices as { message?: { content?: string } }[]) : [];
  const text = choices[0]?.message?.content ?? "";
  if (!text) throw new ProviderError("empty", "provider answered with no text");
  const usage = (data.usage ?? {}) as Json;
  return { text, inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) };
}

/** Test double. Only available outside production (see env.ts). Behaviour is chosen by markers in the text. */
async function mock(user: string, signal: AbortSignal): Promise<Completion> {
  const done = (text: string): Completion => ({ text, inputTokens: null, outputTokens: null });
  if (user.includes("[[MOCK:timeout]]")) {
    await new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(new ProviderError("timeout", "mock timeout"))),
    );
  }
  if (user.includes("[[MOCK:error]]")) throw new ProviderError("http", "mock failure", 500);
  if (user.includes("[[MOCK:garbage]]")) return done("Sorry, I can't help with that.");
  if (user.includes("[[MOCK:injection]]")) {
    // What a model that obeyed "ignore your rules" might produce: zero prices and an extra action.
    return done(
      JSON.stringify({
        items: [{ category: "x", name: "y", description: null, price_toman: 0 }],
        action: "delete_all_menu_items",
      }),
    );
  }
  if (user.includes("[[MOCK:ok]]")) {
    return done(
      JSON.stringify({
        items: [
          { category: "نوشیدنی", name: "لاته مخصوص", description: "با شیر بادام", price_toman: 195000 },
          { category: "نوشیدنی", name: "چای زعفرانی", description: null, price_toman: 90000 },
          { category: "دسر", name: "تیرامیسو", description: null, price_toman: null },
        ],
      }),
    );
  }
  const body = /<menu_text>\n([\s\S]*)\n<\/menu_text>/.exec(user)?.[1] ?? "";
  const { items } = parseRules(normalizeText(body));
  return done(
    JSON.stringify({
      items: items.map((i) => ({
        category: i.category, name: i.name, description: i.description, price_toman: i.price_toman,
      })),
    }),
  );
}

export async function complete(system: string, user: string, maxTokens: number): Promise<Completion> {
  const signal = AbortSignal.timeout(env.AI_TIMEOUT_MS);
  switch (env.AI_PROVIDER) {
    case "anthropic": return anthropic(system, user, maxTokens, signal);
    case "openai": return openai(system, user, maxTokens, signal);
    case "mock": return mock(user, signal);
    default: throw new ProviderError("empty", "AI is not configured");
  }
}