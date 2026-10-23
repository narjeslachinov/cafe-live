# Time log

| Start | End | Planned | Task | Notes |
|---|---|---|---|---|
| 09:30 | 09:45 | 20m | Phase 0: Scaffold project | Next.js (App Router, TS) in a single repo; Postgres 16 via Docker Compose; Zod env validation that fails at startup; Pino structured logging with secret redaction; RTL Persian layout (Vazirmatn); /api/health. No problems. |
| 23:10 | 23:45 | 35m | Phase 1: Schema + migrations + RLS | Plain SQL migrations (no ORM), composite FKs for tenant integrity, RLS with a non-superuser app role. |
| 14:50 | 15:20 | 30m | Phase 2: Auth and roles | Signed-cookie session (ids only, role re-read from DB each request); scrypt password hashing; Origin check + SameSite=Lax; in-memory login rate limit; auth smoke script. |
| 15:20 | 15:40 | 20m | Phase 3: Order core and concurrency | Order lifecycle (open, add, cancel, close); idempotency via unique request_id; atomic price snapshot; FOR SHARE vs FOR UPDATE between add and close; conditional UPDATE for cancel; order smoke test with parallel requests and cross-tenant attempts. |
| 15:40 | 16:20 | 40m | Phase 4: Kitchen status and live updates | SSE over a cursor on the order_events table; per-restaurant advisory lock so event ids become visible in order; compare-and-set status changes; kitchen queue; stream smoke test with reconnect replay, isolation and revocation. |