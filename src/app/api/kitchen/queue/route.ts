import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { route } from "@/server/http";
import { getQueue } from "@/server/kitchen";

export const GET = route(async () => {
  const s = await requireSession(); // every role may look; only some may change
  const result = await withTenant(s.restaurantId, (c) => getQueue(c));
  return Response.json(result);
});