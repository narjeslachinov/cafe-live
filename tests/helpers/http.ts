/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";
import { PASSWORD } from "./db";
import { BASE } from "./env";

export type Res = { status: number; json: any; headers: Headers };
export type Api = {
  email: string;
  cookie: string;
  call: (method: "GET" | "POST", path: string, body?: unknown) => Promise<Res>;
};

export async function request(
  cookie: string | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

export async function login(email: string, password = PASSWORD): Promise<Api> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  return { email, cookie, call: (method, path, body) => request(cookie, method, path, body) };
}

export type SseEvent = {
  id: string | null;
  event: string;
  data: { type: string; orderId: string | null; itemId: string | null };
};

export async function openStream(cookie: string, after?: number | string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const url = `${BASE}/api/events/stream${after === undefined ? "" : `?after=${after}`}`;
  const res = await fetch(url, { headers: { cookie, ...headers }, signal: ctrl.signal });
  const events: SseEvent[] = [];
  let ended = false;

  void (async () => {
    if (res.status !== 200 || !res.body) {
      void res.body?.cancel();
      ended = true;
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev: { id: string | null; event: string; data: SseEvent["data"] | null } = {
            id: null, event: "message", data: null,
          };
          for (const line of block.split("\n")) {
            if (line.startsWith("id:")) ev.id = line.slice(3).trim();
            else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
            else if (line.startsWith("data:")) {
              try {
                ev.data = JSON.parse(line.slice(5).trim());
              } catch {}
            }
          }
          if (ev.data) events.push(ev as SseEvent);
        }
      }
    } catch {}
    ended = true;
  })();

  return { status: res.status, events, isEnded: () => ended, close: () => ctrl.abort() };
}

export const waitUntil = (cond: () => boolean, timeout = 6000) =>
  vi.waitFor(
    () => {
      if (!cond()) throw new Error("condition not met yet");
    },
    { timeout, interval: 100 },
  );

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));