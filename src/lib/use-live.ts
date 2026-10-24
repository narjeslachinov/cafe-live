"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";

const SAFETY_POLL_MS = 30_000;
const RECONNECT_MS = 5_000;

type Listener = {
  onEvent: (type: string) => void;
  onOpen: () => void;
  onLost: () => void;
  onState: (connected: boolean) => void;
};

// One EventSource per page, shared by every useLive on it.
const subscribers = new Set<Listener>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let isConnected = false;

function setConnected(v: boolean) {
  isConnected = v;
  subscribers.forEach((s) => s.onState(v));
}

function ensureSource() {
  if (source || subscribers.size === 0) return;
  const es = new EventSource("/api/events/stream");
  source = es;
  es.onopen = () => {
    setConnected(true);
    subscribers.forEach((s) => s.onOpen()); // anything missed while disconnected is picked up here
  };
  es.addEventListener("change", (ev) => {
    let type = "";
    try {
      type = JSON.parse((ev as MessageEvent).data).type ?? "";
    } catch {}
    subscribers.forEach((s) => s.onEvent(type));
  });
  es.onerror = () => {
    setConnected(false);
    if (es.readyState === EventSource.CLOSED) {
      // The server refused (e.g. session expired). Check, then try again later.
      es.close();
      source = null;
      subscribers.forEach((s) => s.onLost());
      clearTimeout(retryTimer);
      retryTimer = setTimeout(ensureSource, RECONNECT_MS);
    }
    // Otherwise the browser is already reconnecting by itself.
  };
}

function releaseSource() {
  if (subscribers.size > 0) return;
  clearTimeout(retryTimer);
  source?.close();
  source = null;
  isConnected = false;
}

/**
 * Loads `path` and keeps it fresh. Events carry no data: a matching event (or a
 * reconnect, a wake-up, or 30 s of silence) just triggers a re-read, so the
 * screen can never be assembled from half a message.
 * `events` limits which event types trigger a re-read (default: all of them).
 */
export function useLive<T>(path: string, opts?: { events?: string[] }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [connected, setConnected] = useState(isConnected);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const eventsKey = opts?.events?.join(",") ?? "";

  const load = useCallback(async () => {
    if (inFlight.current) {
      again.current = true; // a change arrived mid-read: read once more afterwards
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        try {
          setData(await api<T>("GET", path));
          setError(null);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            window.location.href = "/login";
            return;
          }
          setError(e instanceof ApiError ? e : new ApiError(0, "network", "network error"));
        }
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [path]);

  useEffect(() => {
    const filter = eventsKey ? eventsKey.split(",") : null;
    const schedule = (delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), delay);
    };

    void load();

    const listener: Listener = {
      onEvent: (type) => {
        if (!filter || filter.includes(type)) schedule(150);
      },
      onOpen: () => schedule(0),
      onLost: () => void load(),
      onState: setConnected,
    };
    subscribers.add(listener);
    setConnected(isConnected);
    ensureSource();

    const poll = setInterval(() => void load(), SAFETY_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      subscribers.delete(listener);
      releaseSource();
      clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, eventsKey]);

  return { data, error, connected, reload: load };
}