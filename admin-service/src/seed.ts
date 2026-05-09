// Seed the system role + permission catalogue.
//
// Idempotent — every row is INSERT OR IGNORE on its `key`. Safe to run on
// every cold start (and deliberately invoked by index.ts on first request and
// by POST /debug/seed at any time). New management modules added in the
// future should append their permission keys to SYSTEM_PERMISSIONS below;
// the seeder will pick them up on the next deploy without manual SQL.

import { randomUUID } from "crypto";

// ─── Permission catalogue ─────────────────────────────────────────────────────
//
// Conventions:
//   • Keys follow "<resource>.<action>".
//   • "*" is the wildcard; superadmin holds it and bypasses all checks.
//   • `category` groups permissions in the UI.
//
// To add a new management module (e.g. content moderation), append rows here
// then re-deploy. Existing roles keep their grants; new roles can opt into
// the new keys via the standard /roles endpoints.

export const SYSTEM_PERMISSIONS = [
  // ── Wildcard ─────────────────────────────────────────────────────────────
  { key: "*", display_name: "Superadmin (all permissions)", category: "system",
    description: "Bypasses every permission check, including future ones." },

  // ── Users (admin staff) ──────────────────────────────────────────────────
  { key: "users.read",              display_name: "View admin users",            category: "users" },
  { key: "users.create",            display_name: "Create admin users",          category: "users" },
  { key: "users.update",            display_name: "Update admin users",          category: "users" },
  { key: "users.delete",            display_name: "Delete admin users",          category: "users" },
  { key: "users.assign_role",       display_name: "Assign roles to users",       category: "users" },
  { key: "users.assign_permission", display_name: "Grant permissions directly to users", category: "users" },

  // ── Roles ────────────────────────────────────────────────────────────────
  { key: "roles.read",              display_name: "View roles",                 category: "roles" },
  { key: "roles.create",            display_name: "Create roles",               category: "roles" },
  { key: "roles.update",            display_name: "Update roles",               category: "roles" },
  { key: "roles.delete",            display_name: "Delete roles",               category: "roles" },
  { key: "roles.assign_permission", display_name: "Attach permissions to roles", category: "roles" },

  // ── Permissions catalogue ────────────────────────────────────────────────
  { key: "permissions.read",   display_name: "View permission catalogue",   category: "permissions" },
  { key: "permissions.create", display_name: "Create custom permissions",   category: "permissions" },
  { key: "permissions.update", display_name: "Update custom permissions",   category: "permissions" },
  { key: "permissions.delete", display_name: "Delete custom permissions",   category: "permissions" },

  // ── Provisions (full CF stack: D1 + R2 + Worker) ────────────────────────
  { key: "provisions.read",   display_name: "View tenant provisions",   category: "provisions" },
  { key: "provisions.create", display_name: "Create tenant provisions", category: "provisions" },
  { key: "provisions.update", display_name: "Update tenant provisions", category: "provisions" },
  { key: "provisions.delete", display_name: "Delete tenant provisions", category: "provisions" },

  // ── Subscription plans (Stripe-backed catalogue) ────────────────────────
  { key: "plans.read",   display_name: "View subscription plans",   category: "plans" },
  { key: "plans.create", display_name: "Create subscription plans", category: "plans" },
  { key: "plans.update", display_name: "Update subscription plans", category: "plans" },
  { key: "plans.delete", display_name: "Delete subscription plans", category: "plans" },

  // ── Subscriptions (per-tenant Stripe subscription state) ────────────────
  { key: "subscriptions.read",   display_name: "View tenant subscriptions",            category: "subscriptions" },
  { key: "subscriptions.update", display_name: "Change a tenant's subscription plan",  category: "subscriptions" },
  { key: "subscriptions.cancel", display_name: "Cancel/reactivate tenant subscriptions", category: "subscriptions" },

  // ── Audit log ────────────────────────────────────────────────────────────
  { key: "audit.read", display_name: "View audit log", category: "audit" },
] as const;

// ─── System roles ─────────────────────────────────────────────────────────────
//
// `superadmin`     — owns "*", cannot be deleted/edited.
// `employee`       — sensible default for non-privileged staff: read-only
//                    over everything except provisions.delete and the RBAC
//                    catalogue. Operators are expected to clone + tweak.

const SYSTEM_ROLES: Array<{
  key: string;
  display_name: string;
  description: string;
  permission_keys: string[];   // "*" or an explicit list
}> = [
  {
    key: "superadmin",
    display_name: "Superadmin",
    description: "Full, unrestricted access to every endpoint.",
    permission_keys: ["*"],
  },
  {
    key: "employee",
    display_name: "Employee",
    description: "Read-only baseline for new hires. Customise via /roles.",
    permission_keys: [
      "users.read",
      "roles.read",
      "permissions.read",
      "provisions.read",
      "plans.read",
      "subscriptions.read",
      "audit.read",
    ],
  },
];

// ─── Seeder ───────────────────────────────────────────────────────────────────

export async function seedSystemRolesAndPermissions(db: D1Database): Promise<void> {
  const now = new Date().toISOString();

  // Permissions — INSERT OR IGNORE so re-runs are no-ops.
  for (const perm of SYSTEM_PERMISSIONS) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO permissions (id, key, display_name, description, category, is_system, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`
      )
      .bind(
        randomUUID(),
        perm.key,
        perm.display_name,
        ("description" in perm ? perm.description : null) ?? null,
        perm.category,
        now,
      )
      .run();
  }

  // Roles + their default permission grants.
  for (const role of SYSTEM_ROLES) {
    const roleId = randomUUID();
    await db
      .prepare(
        `INSERT OR IGNORE INTO roles (id, key, display_name, description, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`
      )
      .bind(roleId, role.key, role.display_name, role.description, now)
      .run();

    // Re-resolve the role id — INSERT OR IGNORE won't overwrite an existing row
    // but we still need its id for the join inserts below.
    const row = await db
      .prepare("SELECT id FROM roles WHERE key = ?1")
      .bind(role.key)
      .first<{ id: string }>();
    if (!row) continue;

    for (const permKey of role.permission_keys) {
      const perm = await db
        .prepare("SELECT id FROM permissions WHERE key = ?1")
        .bind(permKey)
        .first<{ id: string }>();
      if (!perm) continue;
      await db
        .prepare(
          `INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?1, ?2)`
        )
        .bind(row.id, perm.id)
        .run();
    }
  }
}
