import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, idParam, route } from "@/server/http";
import { addItem } from "@/server/orders";

type Ctx = { params: Promise<{ id: string }> };

const body = z
  .object({
    requestId: z.string().uuid(),
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
    note: z.string().trim().max(200).optional(),
  })
  .strict(); // unknown fields (like a client-sent price) are rejected, not ignored

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(["waiter", "manager"]);
  const orderId = await idParam(ctx);
  const input = body.parse(await req.json().catch(() => null));

  const r = await withTenant(s.restaurantId, (c) =>
    addItem(c, { orderId, ...input, userId: s.userId }),
  );
  if (r.created) {
    logger.info(
      {
        event: "item_added",
        orderId,
        itemId: r.item.id,
        quantity: input.quantity,
        userId: s.userId,
        restaurantId: s.restaurantId,
      },
      "item added",
    );
  } else {
    logger.info({ event: "item_add_replayed", orderId, requestId: input.requestId }, "duplicate request");
  }
  return Response.json({ item: r.item }, { status: r.created ? 201 : 200 });
});