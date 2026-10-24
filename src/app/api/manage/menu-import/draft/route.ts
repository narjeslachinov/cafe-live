import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireSession } from "@/server/auth";
import { assertSameOrigin, route } from "@/server/http";
import { buildDraft } from "@/server/menu-import/draft";
import { MAX_TEXT } from "@/server/menu-import/text";

const body = z
  .object({
    text: z.string().min(3).max(MAX_TEXT),
    mode: z.enum(["auto", "ai"]).default("auto"),
  })
  .strict();

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(["manager"]);
  const { text, mode } = body.parse(await req.json().catch(() => null));

  const draft = await buildDraft({ restaurantId: s.restaurantId, userId: s.userId, text, mode });
  logger.info(
    {
      event: "menu_import_draft", mode, source: draft.source, notice: draft.notice,
      items: draft.items.length, inputChars: text.length, userId: s.userId, restaurantId: s.restaurantId,
    },
    "menu import draft",
  );
  return Response.json(draft); // nothing is saved here
});