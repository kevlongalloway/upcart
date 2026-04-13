import { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { Env, JwtPayload, Variables } from "../types";

/**
 * JWT auth middleware for protected routes.
 * Reads Bearer token from Authorization header, verifies it,
 * and stores the payload in c.var.jwtPayload.
 */
export async function requireAuth(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — missing Bearer token" }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    c.set("jwtPayload", payload as unknown as JwtPayload);
    return next();
  } catch {
    return c.json({ error: "Unauthorized — invalid or expired token" }, 401);
  }
}
