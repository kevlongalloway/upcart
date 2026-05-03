import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Bindings, AuthedVariables } from "./types.js";
import { ok } from "./types.js";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { rolesRouter } from "./routes/roles.js";
import { permissionsRouter } from "./routes/permissions.js";
import { provisionsRouter } from "./routes/provisions.js";
import { auditRouter } from "./routes/audit.js";
import { debugRouter } from "./routes/debug.js";
import { seedSystemRolesAndPermissions } from "./seed.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

const app = new Hono<Env>();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", corsMiddleware());

// One-shot seed bootstrap. The seeder is idempotent and only writes "INSERT
// OR IGNORE", so the cost on warm starts is ~one query per system row. We
// guard with a module-level flag so warm isolates don't repeat the work.
let seeded = false;
app.use("*", async (c, next) => {
  if (!seeded) {
    try {
      await seedSystemRolesAndPermissions(c.env.DB);
      seeded = true;
    } catch (e) {
      console.error("seed: failed on first request:", (e as Error).message);
    }
  }
  return next();
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json(ok({ service: "upcart-admin", version: "1.0.0" })),
);

app.get("/health", (c) => c.json(ok({ status: "healthy" })));

// ─── Public auth routes ──────────────────────────────────────────────────────
//
// authRouter mounts:
//   POST /auth/login   — public
//   POST /auth/logout  — auth-required (auth middleware applied inside)
//   GET  /auth/me      — auth-required

app.route("/auth", authRouter);

// ─── Authenticated routes ─────────────────────────────────────────────────────
//
// Everything below requires a valid JWT. Permission gating happens per-route
// inside the sub-routers via requirePermissions(...).

app.use("/users/*",       authMiddleware());
app.use("/roles/*",       authMiddleware());
app.use("/permissions/*", authMiddleware());
app.use("/provisions/*",  authMiddleware());
app.use("/audit/*",       authMiddleware());
app.use("/debug/*",       authMiddleware());

app.route("/users",       usersRouter);
app.route("/roles",       rolesRouter);
app.route("/permissions", permissionsRouter);
app.route("/provisions",  provisionsRouter);
app.route("/audit",       auditRouter);
app.route("/debug",       debugRouter);

// ─── 404 / error handlers ─────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }, 404),
);

app.onError((e, c) => {
  console.error("Unhandled error:", e);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
