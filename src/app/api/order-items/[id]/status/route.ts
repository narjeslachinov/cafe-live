import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { assertSameOrigin, HttpError, idParam, route } from "@/server/http";
import { allowedRoles, changeItemStatus } from "@/server/kitchen";

type Ctx = { params: Promise<{ id: string }> };

const status = z.enum(["new", "preparing", "ready", "served"]);
const body = z.object({ from: status, to: status }).strict();

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const s = await requireSession(); // 401 before anything else is revealed
  const itemId = await idParam(ctx);
  const { from, to } = body.parse(await req.json().catch(() => null));

  const roles = allowedRoles(from, to);
  if (!roles) throw new HttpError(400, "Invalid status change", "invalid_transition");
  if (!roles.includes(s.role)) {
    logger.warn({ userId: s.userId, role: s.role, from, to }, "forbidden: status change");
    throw new HttpError(403, "Not allowed", "forbidden");
  }

  const r = await withTenant(s.restaurantId, (c) =>
    changeItemStatus(c, { itemId, from, to, userId: s.userId }),
  );
  logger.info(
    {
      event: "item_status",
      itemId,
      from,
      to,
      changed: r.changed,
      userId: s.userId,
      restaurantId: s.restaurantId,
    },
    "item status",
  );
  return Response.json({ item: r.item, changed: r.changed });
});