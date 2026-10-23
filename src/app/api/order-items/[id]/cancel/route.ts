import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, idParam, route } from "@/server/http";
import { cancelItem } from "@/server/orders";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(["waiter", "manager"]);
  const itemId = await idParam(ctx);

  const item = await withTenant(s.restaurantId, (c) => cancelItem(c, { itemId, userId: s.userId }));
  logger.info(
    { event: "item_cancel", itemId, status: item.status, userId: s.userId, restaurantId: s.restaurantId },
    "item cancel",
  );
  return Response.json({ item });
});