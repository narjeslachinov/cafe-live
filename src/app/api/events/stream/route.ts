import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { currentCursor, pollEvents } from "@/server/events";
import { HttpError, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const MAX_LIFETIME_MS = 10 * 60 * 1000; // browser reconnects with Last-Event-ID
const BATCH = 200;

let activeStreams = 0;

export const GET = route(async (req) => {
  const s = await requireSession();

  const url = new URL(req.url);
  const raw = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  let cursor: number;
  if (raw === null || raw === "") {
    cursor = await currentCursor(s.restaurantId); // new subscriber: only what happens from now
  } else {
    if (!/^\d{1,15}$/.test(raw)) throw new HttpError(400, "Invalid cursor", "invalid_cursor");
    cursor = Number(raw);
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    activeStreams--;
    try {
      controllerRef?.close();
    } catch {}
    logger.info(
      { event: "stream_closed", reason, userId: s.userId, restaurantId: s.restaurantId, activeStreams },
      "stream closed",
    );
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      activeStreams++;
      logger.info(
        { event: "stream_opened", userId: s.userId, restaurantId: s.restaurantId, cursor, activeStreams },
        "stream opened",
      );

      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close("write_failed");
        }
      };
      req.signal.addEventListener("abort", () => close("client_gone"));
      send("retry: 3000\n\n");

      let lastSent = Date.now();
      const tick = async () => {
        if (closed) return;
        let delay = POLL_MS;
        try {
          if (Date.now() - startedAt > MAX_LIFETIME_MS) return close("max_lifetime");
          const rows = await pollEvents({
            restaurantId: s.restaurantId,
            userId: s.userId,
            after: cursor,
            limit: BATCH,
          });
          if (closed) return;
          if (rows === null) return close("membership_revoked");

          for (const e of rows) {
            send(
              `id: ${e.id}\nevent: change\ndata: ${JSON.stringify({
                type: e.type,
                orderId: e.order_id,
                itemId: e.order_item_id,
              })}\n\n`,
            );
            cursor = Number(e.id);
          }
          if (rows.length > 0) lastSent = Date.now();
          if (rows.length === BATCH) delay = 0; // more waiting, keep going
          if (rows.length === 0 && Date.now() - lastSent > HEARTBEAT_MS) {
            send(": ping\n\n"); // keeps proxies from closing an idle connection
            lastSent = Date.now();
          }
        } catch (err) {
          logger.error({ err, userId: s.userId, restaurantId: s.restaurantId }, "stream poll failed");
          return close("poll_error"); // the browser reconnects and resumes from its last id
        }
        if (!closed) timer = setTimeout(tick, delay);
      };
      void tick();
    },
    cancel() {
      close("cancelled");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});