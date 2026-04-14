import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

const TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const merchantLogin = new Hono<{ Bindings: Bindings }>();

/**
 * POST /auth/login
 * Authenticate a merchant with email + password. Returns JWT token.
 */
merchantLogin.post("/", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  if (!c.env.JWT_SECRET) {
    return c.json(err("Server misconfiguration: JWT_SECRET not set"), 500);
  }

  try {
    // Look up merchant by email
    const merchant = await c.env.DB.prepare(
      "SELECT id, email, password_hash, first_name, last_name, business_name, store_slug, balance, active FROM merchants WHERE email = ?"
    ).bind(email.toLowerCase()).first<{
      id: string;
      email: string;
      password_hash: string;
      first_name: string;
      last_name: string;
      business_name: string;
      store_slug: string;
      balance: number;
      active: number;
    }>();

    if (!merchant) {
      return c.json(err("Invalid email or password"), 401);
    }

    if (!merchant.active) {
      return c.json(err("Account is suspended. Contact support."), 403);
    }

    // Hash the provided password and compare
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (!timingSafeEqual(hashHex, merchant.password_hash)) {
      return c.json(err("Invalid email or password"), 401);
    }

    // Issue JWT
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      { sub: merchant.id, email: merchant.email, iat: now, exp: now + TOKEN_TTL, type: "merchant" },
      c.env.JWT_SECRET,
      "HS256"
    );

    return c.json(
      ok({
        token,
        merchant: {
          id: merchant.id,
          email: merchant.email,
          first_name: merchant.first_name,
          last_name: merchant.last_name,
          business_name: merchant.business_name,
          store_slug: merchant.store_slug,
          balance: merchant.balance,
        },
      })
    );
  } catch (error) {
    console.error("Login error:", error);
    return c.json(err("Login failed"), 500);
  }
});

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0 && aBytes.length === bBytes.length;
}
