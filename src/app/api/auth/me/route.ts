import { route } from "@/server/http";
import { requireSession } from "@/server/auth";

export const GET = route(async () => {
  const s = await requireSession();
  return Response.json({
    user: { displayName: s.displayName, role: s.role, restaurantId: s.restaurantId },
  });
});