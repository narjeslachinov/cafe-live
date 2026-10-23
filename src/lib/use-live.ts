"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";

const SAFETY_POLL_MS = 30_000;
const RECONNECT_MS = 5_000;

/**
 * Loads `path` and keeps it fresh. Events carry no data: any event (or a
 * reconnect, a wake-up, or 30 s of silence) just triggers a re-read, so the
 * screen can never be assembled from half a message.
 */
export function useLive<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [connected, setConnected] = useState(false);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    const schedule = (delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), delay);
    };

    void load();

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events/stream");
      es.onopen = () => {
        setConnected(true);
        schedule(0); // anything missed while disconnected is picked up here
      };
      es.addEventListener("change", () => schedule(150));
      es.onerror = () => {
        setConnected(false);
        if (es?.readyState === EventSource.CLOSED) {
          // The server refused (e.g. session expired). Check, then try again later.
          es.close();
          void load();
          retry = setTimeout(connect, RECONNECT_MS);
        }
        // Otherwise the browser is already reconnecting by itself.
      };
    };
    connect();

    const poll = setInterval(() => void load(), SAFETY_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return { data, error, connected, reload: load };
}