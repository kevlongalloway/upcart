import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sign } from "hono/jwt";
import type { Bindings } from "../types.js";
import { ok, err } from "../types.js";

const TOKEN_TTL = 60 * 60 * 8; // 8 hours
const STARTING_BALANCE = 0; // Balance starts at 0, grows with sales

const signupSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  businessName: z.string().min(1, "Business name is required"),
  businessCategory: z.string().min(1, "Business category is required"),
  bankName: z.string().optional(),
  accountHolder: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
});

export const merchantSignup = new Hono<{ Bindings: Bindings }>();

/**
 * POST /auth/signup
 * Register a new merchant account
 *
 * Body:
 * - firstName: string
 * - lastName: string
 * - email: string (unique)
 * - password: string (min 8 chars)
 * - businessName: string
 * - businessCategory: string
 * - bankName: string (optional, can be set up later in dashboard)
 * - accountHolder: string (optional)
 * - accountNumber: string (optional)
 * - routingNumber: string (optional)
 *
 * Returns:
 * - merchant_id: string
 * - token: string (JWT)
 * - email: string
 * - business_name: string
 * - balance: number (in cents, starts at 0)
 *
 * Note: Merchants start with $0 balance. Balance grows as they make sales.
 * Transaction fees are deducted from sales and added to their balance.
 */
merchantSignup.post("/", zValidator("json", signupSchema), async (c) => {
  const {
    firstName,
    lastName,
    email,
    password,
    businessName,
    businessCategory,
    bankName,
    accountHolder,
    accountNumber,
    routingNumber,
  } = c.req.valid("json");

  const hasPayout = bankName && accountHolder && accountNumber && routingNumber;

  try {
    // Hash password (in production, use bcrypt or similar)
    // For now, we'll use a simple SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    // Check if merchant with this email already exists
    // This is a placeholder - in real implementation, query your database
    // const existingMerchant = await db.query(
    //   "SELECT id FROM merchants WHERE email = ?",
    //   [email]
    // );
    // if (existingMerchant.length > 0) {
    //   return c.json(err("Email already registered"), 409);
    // }

    // Create merchant account
    // In production, use your database to insert the merchant record
    const merchantId = `merchant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store payout information securely if provided (can be added later via dashboard)
    const payoutInfo = hasPayout ? {
      bankName,
      accountHolder,
      accountNumber: `****${accountNumber!.slice(-4)}`,
      routingNumber: `****${routingNumber!.slice(-4)}`,
    } : null;

    // Create JWT token
    if (!c.env.JWT_SECRET) {
      return c.json(err("Server misconfiguration: JWT_SECRET not set"), 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        sub: merchantId,
        email,
        iat: now,
        exp: now + TOKEN_TTL,
        type: "merchant",
      },
      c.env.JWT_SECRET,
      "HS256"
    );

    // In production, save all this to your database:
    // await db.insertMerchant({
    //   id: merchantId,
    //   firstName,
    //   lastName,
    //   email,
    //   password_hash: hashHex,
    //   business_name: businessName,
    //   business_category: businessCategory,
    //   payout_info: JSON.stringify(payoutInfo),
    //   balance: 0, // Starts at $0, grows with sales
    //   created_at: new Date(),
    // });

    return c.json(
      ok({
        merchant_id: merchantId,
        token,
        email,
        business_name: businessName,
        balance: STARTING_BALANCE,
        message: "Account created successfully. Your store is ready to accept payments.",
      }),
      201
    );
  } catch (error) {
    console.error("Signup error:", error);
    return c.json(err("Failed to create account"), 500);
  }
});

/**
 * GET /auth/check-email
 * Check if an email is already registered
 */
merchantSignup.get("/check-email", async (c) => {
  const email = c.req.query("email");

  if (!email) {
    return c.json(err("Email is required"), 400);
  }

  // In production, query your database
  // const exists = await db.query("SELECT id FROM merchants WHERE email = ?", [email]);
  const exists = false;

  return c.json(
    ok({
      available: !exists,
      email,
    })
  );
});
