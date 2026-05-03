// Auth routes: login, logout, and the "me" endpoint that powers the
// dynamic-UI permission check on the frontend.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { sign } from "hono/jwt";
import type { Bindings, AuthedVariables } from "../types.js";
import { ok, err } from "../types.js";
import { AdminDB } from "../db/index.js";
import { verifyPassword } from "../password.js";
import { authMiddleware } from "../middleware/auth.js";
import { audit } from "../middleware/audit.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const authRouter = new Hono<Env>();

const loginSchema = z.object({
  email:    z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const DEFAULT_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function ttlSeconds(env: Bindings): number {
  const raw = env.JWT_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return n;
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
//
// Body:     { email, password }
// Returns:  { token, expires_at, user: AdminUserWithAccess }
//
// Bootstrap path: if `admin_users` is empty AND BOOTSTRAP_EMAIL +
// BOOTSTRAP_PASSWORD_HASH are configured AND they match the request, a
// superadmin row is created on the fly and the assigned role granted. After
// this row exists the bootstrap path can never run again.

authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  if (!c.env.JWT_SECRET) {
    return c.json(err("Server misconfiguration: JWT_SECRET not set"), 500);
  }

  const { email, password } = c.req.valid("json");
  const generic = () => c.json(err("Invalid email or password."), 401);

  const db = new AdminDB(c.env);

  // ── Bootstrap branch ────────────────────────────────────────────────────
  const userCount = await db.users.countActive();
  if (userCount === 0) {
    if (
      !c.env.BOOTSTRAP_EMAIL ||
      !c.env.BOOTSTRAP_PASSWORD_HASH ||
      c.env.BOOTSTRAP_EMAIL.toLowerCase().trim() !== email.toLowerCase().trim()
    ) {
      return c.json(
        err(
          "No admin users exist yet. Configure BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD_HASH " +
            "secrets, then log in with that email to create the first superadmin."
        ),
        403,
      );
    }

    const ok2 = await verifyPassword(password, c.env.BOOTSTRAP_PASSWORD_HASH);
    if (!ok2) return generic();

    // Seeder must have run before we can grant the superadmin role; index.ts
    // calls it on first request, but call again here defensively to avoid a
    // race where the first request lands on /auth/login.
    const { seedSystemRolesAndPermissions } = await import("../seed.js");
    await seedSystemRolesAndPermissions(c.env.DB);

    const created = await db.users.create({
      email,
      username: email.split("@")[0] ?? "superadmin",
      password_hash: c.env.BOOTSTRAP_PASSWORD_HASH,
      full_name: "Superadmin",
      status: "active",
      created_by: null,
    });

    const superadmin = await db.roles.getByKey("superadmin");
    if (superadmin) await db.roles.assignToUser(created.id, superadmin.id, null);

    await db.users.touchLastLogin(created.id);

    const access = (await db.users.getWithAccess(created.id))!;
    const issued = await issueToken(c.env, created.id);
    return c.json(ok({
      token: issued.value,
      expires_at: new Date((issued.iat + issued.ttl) * 1000).toISOString(),
      user: access,
    }));
  }

  // ── Standard branch ─────────────────────────────────────────────────────
  const user = await db.users.getByEmail(email);
  if (!user) return generic();
  if (user.status !== "active") {
    return c.json(err(`Account is ${user.status}.`), 403);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return generic();

  await db.users.touchLastLogin(user.id);
  const access = (await db.users.getWithAccess(user.id))!;
  const issued = await issueToken(c.env, user.id);

  return c.json(ok({
    token: issued.value,
    expires_at: new Date((issued.iat + issued.ttl) * 1000).toISOString(),
    user: access,
  }));
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────
//
// Stateless JWTs aren't revocable server-side without a deny-list. This
// endpoint exists so the frontend can record logouts in the audit trail and
// can be extended later (e.g. to write a token blacklist).

authRouter.post("/logout", authMiddleware(), async (c) => {
  await audit(c, {
    action: "auth.logout",
    resource_type: "user",
    resource_id: c.get("user").id,
    metadata: {},
  });
  return c.json(ok({ logged_out: true }));
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────
//
// The frontend calls this on app boot (or after login) to learn the caller's
// roles and flat permission keys; it then uses them to show/hide UI elements.
// Returning the wildcard "*" verbatim keeps the frontend logic identical to
// the backend — `permissions.includes("*") || permissions.includes(p)`.

authRouter.get("/me", authMiddleware(), (c) => {
  return c.json(ok(c.get("user")));
});

// ─── helpers ───────────────────────────────────────────────────────────────────

type IssuedToken = { value: string; iat: number; ttl: number };

async function issueToken(env: Bindings, userId: string): Promise<IssuedToken> {
  const ttl   = ttlSeconds(env);
  const iat   = Math.floor(Date.now() / 1000);
  const value = await sign({ sub: userId, iat, exp: iat + ttl }, env.JWT_SECRET, "HS256");
  return { value, iat, ttl };
}
