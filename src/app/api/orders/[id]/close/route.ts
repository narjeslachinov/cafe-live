import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, idParam, route } from "@/server/http";
import { closeOrder } from "@/server/orders";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(["waiter", "manager"]);
  const orderId = await idParam(ctx);

  const r = await withTenant(s.restaurantId, (c) => closeOrder(c, { orderId, userId: s.userId }));
  if (r.closed) {
    logger.info(
      { event: "order_closed", orderId, userId: s.userId, restaurantId: s.restaurantId },
      "order closed",
    );
  }
  return Response.json({ ok: true });
});