import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, idParam, route } from "@/server/http";
import { updateMenuItem } from "@/server/menu";

type Ctx = { params: Promise<{ id: string }> };

const body = z
  .object({
    price_toman: z.number().int().min(1000).max(100_000_000).optional(),
    is_available: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.price_toman !== undefined || v.is_available !== undefined);

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(["manager"]);
  const id = await idParam(ctx);
  const input = body.parse(await req.json().catch(() => null));

  const row = await withTenant(s.restaurantId, (c) =>
    updateMenuItem(c, { id, price: input.price_toman, available: input.is_available }),
  );
  // Menu changes have no event table yet: this log line is the audit trail.
  logger.info(
    {
      event: "menu_item_updated", itemId: id, oldPrice: row.old_price, newPrice: row.price_toman,
      oldAvailable: row.old_available, newAvailable: row.is_available,
      userId: s.userId, restaurantId: s.restaurantId,
    },
    "menu item updated",
  );
  return Response.json({
    item: {
      id: row.id, name: row.name, description: row.description,
      price_toman: row.price_toman, is_available: row.is_available,
    },
  });
});