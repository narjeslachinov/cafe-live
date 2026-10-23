import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, route } from "@/server/http";
import { openOrder } from "@/server/orders";

const body = z.object({ tableId: z.string().uuid() }).strict();

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(["waiter", "manager"]);
  const { tableId } = body.parse(await req.json().catch(() => null));

  const r = await withTenant(s.restaurantId, (c) => openOrder(c, { tableId, userId: s.userId }));
  if (r.created) {
    logger.info(
      { event: "order_opened", orderId: r.order.id, userId: s.userId, restaurantId: s.restaurantId },
      "order opened",
    );
  }
  return Response.json({ order: r.order }, { status: r.created ? 201 : 200 });
});