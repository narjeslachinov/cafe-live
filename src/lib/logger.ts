import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.cookie", "password", "*.password", "*.token"],
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty" },
  }),
});