// Permission-gating middleware. Place AFTER authMiddleware in the route
// definition so c.var.user is populated.
//
// Usage:
//   router.get("/", requirePermissions("provisions.read"), handler)
//   router.post("/", requirePermissions("provisions.create"), handler)
//
// Holders of the "*" permission (superadmins) always pass. When multiple
// keys are passed, the caller must hold ALL of them — pass the most
// restrictive set the route needs. For OR-semantics, model that as a single
// permission key in the catalogue.

import type { MiddlewareHandler } from "hono";
import type { Bindings, AuthedVariables } from "../types.js";
import { err } from "../types.js";

type Env = { Bindings: Bindings; Variables: AuthedVariables };

export const requirePermissions = (
  ...required: string[]
): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      // Programmer error: requirePermissions used without authMiddleware.
      return c.json(err("Server misconfiguration: auth middleware not run"), 500);
    }

    const held = new Set(user.permissions);
    if (held.has("*")) return next();

    const missing = required.filter(p => !held.has(p));
    if (missing.length > 0) {
      return c.json(
        err("Forbidden: missing required permissions", { missing }),
        403,
      );
    }
    await next();
  };
};

/** True if the user holds the wildcard or every required key. */
export function hasPermissions(
  user: { permissions: string[] },
  ...required: string[]
): boolean {
  const held = new Set(user.permissions);
  if (held.has("*")) return true;
  return required.every(p => held.has(p));
}
