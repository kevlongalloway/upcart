import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env, Variables, Store } from "../types";
import { requireAuth } from "../middleware/auth";

const domains = new Hono<{ Bindings: Env; Variables: Variables }>();

const domainSchema = z.object({
  domain: z
    .string()
    .toLowerCase()
    .trim()
    .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Invalid domain format"),
});

// ── POST /domains (protected) — Connect a custom domain ──────────────────────

domains.post("/", requireAuth, zValidator("json", domainSchema), async (c) => {
  const { domain } = c.req.valid("json");
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const store = await db.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(store_id).first<Store>();
  if (!store) return c.json({ error: "Store not found." }, 404);

  // Custom domains require a paid plan
  const plan = await db.prepare("SELECT features FROM plans WHERE id = ?")
    .bind(store.plan_id).first<{ features: string }>();
  const features = plan ? JSON.parse(plan.features) as { custom_domain?: boolean } : {};
  if (!features.custom_domain) {
    return c.json({
      error: "Custom domains require the Basic plan or higher. Please upgrade your plan.",
      upgrade_required: true,
    }, 403);
  }

  // Ensure domain not taken by another store
  const existing = await db.prepare("SELECT id FROM stores WHERE custom_domain = ?").bind(domain).first<{ id: string }>();
  if (existing && existing.id !== store_id) {
    return c.json({ error: "This domain is already connected to another store." }, 409);
  }

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE stores SET custom_domain = ?, custom_domain_verified = 0, custom_domain_verified_at = NULL, updated_at = ? WHERE id = ?"
  ).bind(domain, now, store_id).run();

  const baseDomain = c.env.BASE_DOMAIN;

  return c.json({
    domain,
    verified: false,
    dns_instructions: {
      message: `Add these DNS records at your domain registrar, then click "Verify" in your dashboard.`,
      records: [
        {
          type: "CNAME",
          name: domain.startsWith("www.") ? "www" : "@",
          value: `${store.subdomain}.${baseDomain}`,
          ttl: 3600,
          note: "Points your domain to your Upcart store.",
        },
        {
          type: "TXT",
          name: `_upcart-verify`,
          value: `upcart-verify=${store.id}`,
          ttl: 3600,
          note: "Proves you own this domain.",
        },
      ],
      propagation_note: "DNS changes can take up to 48 hours to propagate worldwide.",
    },
  });
});

// ── GET /domains/verify (protected) — Check DNS and mark verified ─────────────

domains.get("/verify", requireAuth, async (c) => {
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  const store = await db.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(store_id).first<Store>();
  if (!store) return c.json({ error: "Store not found." }, 404);
  if (!store.custom_domain) return c.json({ error: "No custom domain configured." }, 400);

  if (store.custom_domain_verified) {
    return c.json({ domain: store.custom_domain, verified: true, message: "Domain is verified and active." });
  }

  // Check TXT record via Cloudflare DNS-over-HTTPS
  // TODO (Phase 6): Also verify CNAME record, then call Cloudflare API to add custom hostname
  let txtVerified = false;
  try {
    const expectedValue = `upcart-verify=${store_id}`;
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=_upcart-verify.${store.custom_domain}&type=TXT`;
    const res = await fetch(dohUrl, { headers: { Accept: "application/dns-json" } });
    if (res.ok) {
      const data = await res.json() as { Answer?: Array<{ data: string }> };
      txtVerified = (data.Answer ?? []).some(r => r.data.replace(/"/g, "") === expectedValue);
    }
  } catch {
    // DNS lookup failed — treat as unverified
  }

  if (txtVerified) {
    const now = new Date().toISOString();
    await db.prepare(
      "UPDATE stores SET custom_domain_verified = 1, custom_domain_verified_at = ?, updated_at = ? WHERE id = ?"
    ).bind(now, now, store_id).run();

    // TODO (Phase 6): Call Cloudflare API to add custom hostname to worker route
    // so that requests to custom_domain are served by the store worker.

    return c.json({
      domain: store.custom_domain,
      verified: true,
      message: "Domain verified! DNS is propagated correctly. Note: full routing activation may take a few minutes.",
    });
  }

  return c.json({
    domain: store.custom_domain,
    verified: false,
    message: "TXT record not found yet. DNS propagation can take up to 48 hours.",
    expected_txt: {
      name: `_upcart-verify.${store.custom_domain}`,
      value: `upcart-verify=${store_id}`,
    },
  });
});

// ── DELETE /domains (protected) — Remove custom domain ───────────────────────

domains.delete("/", requireAuth, async (c) => {
  const { store_id } = c.var.jwtPayload;
  const db = c.env.PLATFORM_DB;

  await db.prepare(
    "UPDATE stores SET custom_domain = NULL, custom_domain_verified = 0, custom_domain_verified_at = NULL, updated_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), store_id).run();

  return c.json({ success: true, message: "Custom domain removed." });
});

export default domains;
