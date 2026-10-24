import { requireSession } from "@/server/auth";
import { withTenant } from "@/server/db";
import { route } from "@/server/http";
import { listMenuForManager } from "@/server/menu";

export const GET = route(async () => {
  const s = await requireSession(["manager"]);
  return Response.json(await withTenant(s.restaurantId, (c) => listMenuForManager(c)));
});