import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";
import { verifyPassword } from "./setup.js";

const TOKEN_TTL = 60 * 60 * 8; // 8 hours

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const adminLogin = new Hono<{ Bindings: Bindings }>();

adminLogin.post("/", zValidator("json", loginSchema), async (c) => {
  const { username, password } = c.req.valid("json");

  let validUsername = false;
  let validPassword = false;
  let jwtSecret     = c.env.JWT_SECRET;

  try {
    // ── DB-based auth (setup wizard completed) ────────────────────────────
    // Look up the admin account by username in the admin_accounts table.
    const dbAdmin = await c.env.DB.prepare(
      "SELECT username, password_hash FROM admin_accounts WHERE username = ? LIMIT 1"
    ).first<{ username: string; password_hash: string }>(username);

    if (dbAdmin) {
      validUsername = timingSafeEqual(username, dbAdmin.username);
      validPassword = await verifyPassword(password, dbAdmin.password_hash);

      // Prefer env var JWT_SECRET; fall back to the one stored during setup.
      if (!jwtSecret) {
        const row = await c.env.DB.prepare(
          "SELECT value FROM store_settings WHERE key = 'db_jwt_secret'"
        ).first<{ value: string }>();
        if (row) jwtSecret = row.value;
      }
    } else {
      // ── Env var auth (pre-setup or wrangler-secrets-only deployment) ──────
      if (!c.env.ADMIN_USERNAME || !c.env.ADMIN_PASSWORD) {
        return c.json(
          err("Store not yet configured. Complete setup at /onboarding.html"),
          503
        );
      }
      validUsername = timingSafeEqual(username, c.env.ADMIN_USERNAME);
      validPassword = timingSafeEqual(password, c.env.ADMIN_PASSWORD);
    }
  } catch {
    // DB unavailable — fall back to env vars.
    if (!c.env.ADMIN_USERNAME || !c.env.ADMIN_PASSWORD || !c.env.JWT_SECRET) {
      return c.json(err("Server misconfiguration: admin credentials not set"), 500);
    }
    validUsername = timingSafeEqual(username, c.env.ADMIN_USERNAME);
    validPassword = timingSafeEqual(password, c.env.ADMIN_PASSWORD);
  }

  if (!validUsername || !validPassword) {
    return c.json(err("Invalid username or password"), 401);
  }

  if (!jwtSecret) {
    return c.json(err("Server misconfiguration: JWT secret not set"), 500);
  }

  const now   = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: "admin", iat: now, exp: now + TOKEN_TTL },
    jwtSecret,
    "HS256"
  );

  return c.json(ok({ token }));
});

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len    = Math.max(aBytes.length, bBytes.length);
  let diff     = 0;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0 && aBytes.length === bBytes.length;
}
