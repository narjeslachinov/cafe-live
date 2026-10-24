import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, idParam, route } from "@/server/http";
import { forceCloseOrder } from "@/server/orders";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(["manager"]);
  const orderId = await idParam(ctx);

  const r = await withTenant(s.restaurantId, (c) => forceCloseOrder(c, { orderId, userId: s.userId }));
  if (r.closed) {
    logger.warn(
      { event: "order_force_closed", orderId, served: r.served, cancelled: r.cancelled, userId: s.userId, restaurantId: s.restaurantId },
      "order force-closed by manager",
    );
  }
  return Response.json({ ok: true, served: r.served, cancelled: r.cancelled });
});