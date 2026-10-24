import { z } from "zod";

const blank = (v: unknown) => (v === "" ? undefined : v);

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // AI is optional: with no provider the menu import still works, with plain rules.
    AI_PROVIDER: z.preprocess(blank, z.enum(["anthropic", "openai", "mock"]).optional()),
    AI_API_KEY: z.preprocess(blank, z.string().min(10).optional()),
    AI_MODEL: z.preprocess(blank, z.string().min(1).optional()),
    AI_BASE_URL: z.preprocess(blank, z.string().url().optional()),
    AI_TIMEOUT_MS: z.preprocess(blank, z.coerce.number().int().min(500).max(60000).default(20000)),
  })
  .superRefine((v, ctx) => {
    if (v.AI_PROVIDER === "mock" && process.env.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["AI_PROVIDER"], message: "mock is not allowed in production" });
    }
    if ((v.AI_PROVIDER === "anthropic" || v.AI_PROVIDER === "openai") && (!v.AI_API_KEY || !v.AI_MODEL)) {
      ctx.addIssue({ code: "custom", path: ["AI_API_KEY"], message: "AI_API_KEY and AI_MODEL are required" });
    }
  });

export const env = schema.parse(process.env);