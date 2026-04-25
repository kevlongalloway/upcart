import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { Bindings } from "../types.js";

/**
 * Merchant JWT authentication middleware.
 *
 * Expects: Authorization: Bearer <token>
 * Token must have type: "merchant" in payload (issued by /auth/signup or /auth/login).
 *
 * On success, sets c.set("merchantId", <id>) for downstream handlers.
 */
export const merchantAuthMiddleware = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: { merchantId: string; merchantEmail: string };
}> => {
  return async (c, next) => {
    if (!c.env.JWT_SECRET) {
      return c.json(
        { ok: false, error: "Server misconfiguration: JWT_SECRET not set" },
        500
      );
    }

    const authHeader = c.req.header("Authorization") ?? "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return c.json(
        { ok: false, error: "Unauthorized: missing or malformed Authorization header" },
        401
      );
    }

    try {
      const payload = await verify(token.trim(), c.env.JWT_SECRET, "HS256") as {
        sub: string;
        email: string;
        type?: string;
      };

      if (payload.type !== "merchant") {
        return c.json({ ok: false, error: "Unauthorized: not a merchant token" }, 401);
      }

      c.set("merchantId", payload.sub);
      c.set("merchantEmail", payload.email);
    } catch {
      return c.json({ ok: false, error: "Unauthorized: invalid or expired token" }, 401);
    }

    await next();
  };
};
