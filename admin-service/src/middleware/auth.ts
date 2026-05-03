// JWT authentication middleware for the admin-service.
//
// Expects:    Authorization: Bearer <token>
// Sets:       c.var.user — fully hydrated AdminUserWithAccess
//             c.var.jwt  — { sub, iat, exp }
//
// JWT shape (HS256): { sub: <admin_user_id>, iat, exp }.
// JWT_SECRET is required — the service refuses to boot without it.

import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { Bindings, AuthedVariables } from "../types.js";
import { err } from "../types.js";
import { AdminDB } from "../db/index.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const authMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    if (!c.env.JWT_SECRET) {
      return c.json(err("Server misconfiguration: JWT_SECRET not set"), 500);
    }

    const authHeader      = c.req.header("Authorization") ?? "";
    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      return c.json(err("Unauthorized: missing or malformed Authorization header"), 401);
    }

    let payload: unknown;
    try {
      payload = await verify(token.trim(), c.env.JWT_SECRET, "HS256");
    } catch {
      return c.json(err("Unauthorized: invalid or expired token"), 401);
    }

    const claims = payload as { sub?: unknown; iat?: unknown; exp?: unknown };
    if (typeof claims.sub !== "string" || typeof claims.iat !== "number" || typeof claims.exp !== "number") {
      return c.json(err("Unauthorized: malformed JWT claims"), 401);
    }

    const db   = new AdminDB(c.env);
    const user = await db.users.getWithAccess(claims.sub);
    if (!user) {
      return c.json(err("Unauthorized: account not found"), 401);
    }
    if (user.status !== "active") {
      return c.json(err(`Account is ${user.status}.`), 403);
    }

    c.set("user", user);
    c.set("jwt",  { sub: claims.sub, iat: claims.iat, exp: claims.exp });

    await next();
  };
};
