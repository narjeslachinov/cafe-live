import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, route } from "@/server/http";
import { commitItems } from "@/server/menu";

// This is validated from scratch: the draft is only a suggestion, never trusted.
const body = z
  .object({
    items: z
      .array(
        z
          .object({
            category: z.string().trim().min(1).max(60),
            name: z.string().trim().min(1).max(100),
            description: z.string().trim().max(300).nullable().optional(),
            price_toman: z.number().int().min(1000).max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(["manager"]);
  const { items } = body.parse(await req.json().catch(() => null));

  const r = await withTenant(s.restaurantId, (c) => commitItems(c, items, s.userId));  logger.info(
    { event: "menu_import_commit", created: r.created, skipped: r.skipped.length, userId: s.userId, restaurantId: s.restaurantId },
    "menu import committed",
  );
  return Response.json(r);
});