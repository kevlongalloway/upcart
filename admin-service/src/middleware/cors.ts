// CORS middleware. Origins are configured via the CORS_ORIGINS var (comma-
// separated) in wrangler.toml. Same shape as provisioning-service so the
// portal frontend can switch services with a single allowlist change.

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";

export const corsMiddleware = (): MiddlewareHandler<{ Bindings: Bindings }> => {
  return async (c, next) => {
    const origins = (c.env.CORS_ORIGINS ?? "*")
      .split(",")
      .map(o => o.trim())
      .filter(Boolean);

    return cors({
      origin: origins.includes("*") ? "*" : origins,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
      credentials: false,
    })(c, next);
  };
};
