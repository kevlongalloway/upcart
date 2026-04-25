// PBKDF2-SHA256 password hashing. Must produce output in the same
// "salt_hex:hash_hex" shape that backend/src/routes/setup.ts and
// backend/src/routes/adminLogin.ts (via verifyPassword) consume —
// provisioning writes this as the ADMIN_PASSWORD_HASH env var on each
// tenant worker so the worker can validate logins without ever being
// called into by a /setup endpoint.

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const keyMat  = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMat, 256
  );
  const toHex = (buf: Uint8Array) =>
    Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}
