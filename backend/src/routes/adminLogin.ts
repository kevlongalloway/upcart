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
    // ── DB-based auth (legacy /setup flow) ────────────────────────────────
    // Kept for backwards-compat with tenants that were seeded via a /setup
    // wizard. New tenants skip /setup entirely and rely on the env-var
    // path below.
    const dbAdmin = await c.env.DB.prepare(
      "SELECT username, password_hash FROM admin_accounts WHERE username = ? LIMIT 1"
    ).first<{ username: string; password_hash: string }>(username);

    if (dbAdmin) {
      validUsername = timingSafeEqual(username, dbAdmin.username);
      validPassword = await verifyPassword(password, dbAdmin.password_hash);

      if (!jwtSecret) {
        const row = await c.env.DB.prepare(
          "SELECT value FROM store_settings WHERE key = 'db_jwt_secret'"
        ).first<{ value: string }>();
        if (row) jwtSecret = row.value;
      }
    } else {
      // ── Env-var auth (default for provisioned tenants) ────────────────────
      // Provisioning writes ADMIN_USERNAME + ADMIN_PASSWORD_HASH as
      // plain_text vars at deploy time, so this path is the primary one.
      // ADMIN_PASSWORD (plaintext) is still honored as a fallback for
      // manual deploys.
      if (!c.env.ADMIN_USERNAME || (!c.env.ADMIN_PASSWORD_HASH && !c.env.ADMIN_PASSWORD)) {
        return c.json(
          err("Store not yet configured. Complete setup at /onboarding.html"),
          503
        );
      }
      validUsername = timingSafeEqual(username, c.env.ADMIN_USERNAME);
      validPassword = c.env.ADMIN_PASSWORD_HASH
        ? await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH)
        : timingSafeEqual(password, c.env.ADMIN_PASSWORD);
    }
  } catch {
    // DB unavailable — fall back to env vars.
    if (!c.env.ADMIN_USERNAME || (!c.env.ADMIN_PASSWORD_HASH && !c.env.ADMIN_PASSWORD) || !c.env.JWT_SECRET) {
      return c.json(err("Server misconfiguration: admin credentials not set"), 500);
    }
    validUsername = timingSafeEqual(username, c.env.ADMIN_USERNAME);
    validPassword = c.env.ADMIN_PASSWORD_HASH
      ? await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH)
      : timingSafeEqual(password, c.env.ADMIN_PASSWORD);
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
