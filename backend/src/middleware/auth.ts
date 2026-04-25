import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { Bindings } from "../types.js";

/**
 * Admin JWT authentication middleware.
 *
 * Expects: Authorization: Bearer <token>
 *
 * Token is obtained by calling POST /admin/login.
 *
 * JWT signing secret resolution order:
 *   1. JWT_SECRET env var (set via `wrangler secret put JWT_SECRET`)
 *   2. db_jwt_secret in store_settings table (set during onboarding wizard)
 *
 * This dual-source approach supports both wrangler-secrets-only deployments
 * and self-serve deployments where the secret was generated at setup time.
 */
export const adminAuthMiddleware = (): MiddlewareHandler<{
  Bindings: Bindings;
}> => {
  return async (c, next) => {
    // ── Resolve JWT secret ──────────────────────────────────────────────────
    let jwtSecret = c.env.JWT_SECRET;

    if (!jwtSecret) {
      try {
        const row = await c.env.DB.prepare(
          "SELECT value FROM store_settings WHERE key = 'db_jwt_secret'"
        ).first<{ value: string }>();
        if (row) jwtSecret = row.value;
      } catch {
        // DB unavailable — fall through to the missing-secret error below.
      }
    }

    if (!jwtSecret) {
      return c.json(
        { ok: false, error: "Server misconfiguration: JWT secret not configured" },
        500
      );
    }

    // ── Validate Bearer token ───────────────────────────────────────────────
    const authHeader       = c.req.header("Authorization") ?? "";
    const [scheme, token]  = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return c.json(
        { ok: false, error: "Unauthorized: missing or malformed Authorization header" },
        401
      );
    }

    try {
      await verify(token.trim(), jwtSecret, "HS256");
    } catch {
      return c.json({ ok: false, error: "Unauthorized: invalid or expired token" }, 401);
    }

    await next();
  };
};
