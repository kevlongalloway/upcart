import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

const TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days

function toSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

const signupSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  businessName: z.string().min(1, "Business name is required"),
  businessCategory: z.string().min(1, "Business category is required"),
});

export const merchantSignup = new Hono<{ Bindings: Bindings }>();

/**
 * POST /auth/signup
 * Register a new merchant account. Writes to D1 merchants table.
 */
merchantSignup.post("/", zValidator("json", signupSchema), async (c) => {
  const { firstName, lastName, email, password, businessName, businessCategory } =
    c.req.valid("json");

  if (!c.env.JWT_SECRET) {
    return c.json(err("Server misconfiguration: JWT_SECRET not set"), 500);
  }

  try {
    // Check if email is already taken
    const existing = await c.env.DB.prepare(
      "SELECT id FROM merchants WHERE email = ?"
    ).bind(email.toLowerCase()).first();

    if (existing) {
      return c.json(err("An account with this email already exists"), 409);
    }

    // Hash password with SHA-256 (use bcrypt/argon2 in production)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const merchantId = `merchant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const storeSlug = toSlug(businessName);

    // Insert merchant into D1
    await c.env.DB.prepare(
      `INSERT INTO merchants (id, first_name, last_name, email, password_hash, business_name, business_category, store_slug, balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(merchantId, firstName, lastName, email.toLowerCase(), hashHex, businessName, businessCategory, storeSlug)
      .run();

    // Issue JWT
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      { sub: merchantId, email: email.toLowerCase(), iat: now, exp: now + TOKEN_TTL, type: "merchant" },
      c.env.JWT_SECRET,
      "HS256"
    );

    return c.json(
      ok({
        merchant_id: merchantId,
        token,
        email: email.toLowerCase(),
        business_name: businessName,
        store_slug: storeSlug,
        balance: 0,
        message: "Account created successfully. Your store is ready.",
      }),
      201
    );
  } catch (error: any) {
    console.error("Signup error:", error);
    // Handle unique constraint violations
    if (error?.message?.includes("UNIQUE constraint")) {
      return c.json(err("An account with this email already exists"), 409);
    }
    return c.json(err("Failed to create account"), 500);
  }
});

/**
 * GET /auth/check-email
 * Check if an email is available for registration.
 */
merchantSignup.get("/check-email", async (c) => {
  const email = c.req.query("email");

  if (!email) {
    return c.json(err("Email is required"), 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id FROM merchants WHERE email = ?"
  ).bind(email.toLowerCase()).first();

  return c.json(ok({ available: !existing, email }));
});
