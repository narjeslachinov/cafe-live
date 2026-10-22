import { logger } from "@/lib/logger";

export async function GET() {
  logger.info({ route: "health" }, "health check");
  return Response.json({ status: "ok" });
}