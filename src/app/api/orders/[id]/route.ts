import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { idParam, route } from "@/server/http";
import { getOrder } from "@/server/orders";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const s = await requireSession();
  const id = await idParam(ctx);
  const result = await withTenant(s.restaurantId, (c) => getOrder(c, id));
  return Response.json(result);
});