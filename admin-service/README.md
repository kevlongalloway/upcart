# Upcart Admin Service

Backend API powering the **superadmin / employee portal**. Owns the platform's
RBAC database (admin users, roles, permissions, audit log) and exposes full
CRUD over the tenant provisions created by the
[`provisioning-service`](../provisioning-service/README.md).

Built as a Cloudflare Worker using the same stack and conventions as the rest
of the Upcart monorepo: **Hono + D1 + R2 + Zod + JWT (HS256) + PBKDF2-SHA256
password hashing**.

---

## Folder layout

```
admin-service/
├── migrations/              SQL migrations for upcart-admin-db
├── src/
│   ├── index.ts             App entry — Hono app, route mounting, seeding
│   ├── types.ts             Bindings + domain types + ok/err helpers
│   ├── password.ts          PBKDF2 hash/verify
│   ├── cloudflare-api.ts    CF REST client (vendored from provisioning-service)
│   ├── seed.ts              System role/permission catalogue (idempotent)
│   ├── db/                  Class-per-table accessors + AdminDB facade
│   ├── middleware/          auth, permission gating, audit, CORS
│   └── routes/              auth, users, roles, permissions, provisions, audit, debug
├── package.json
├── tsconfig.json
└── wrangler.toml
```

---

## Authorization model

- **Permissions** are strings keyed `<resource>.<action>` (e.g.
  `provisions.delete`).
- **Roles** group permissions and can be created/edited at runtime from the
  portal.
- **Users** can hold multiple roles; the effective permission set is
  `union(role_permissions, user_permissions)` — i.e. roles **plus** any
  permissions granted directly to the user via `POST /users/:id/permissions`.
- The wildcard permission `*` short-circuits every check. Only the seeded
  `superadmin` role holds it; deletion of `*` from `superadmin` is refused
  by the API.

System rows (`is_system = 1`) cannot be deleted; system roles cannot be
renamed.

### Adding a new management module later

1. Append rows to `SYSTEM_PERMISSIONS` in `src/seed.ts` with the new keys
   (e.g. `moderation.flag_content`).
2. `wrangler deploy` — the seeder runs on the next request and inserts the
   new rows (`INSERT OR IGNORE`, idempotent).
3. Existing roles keep their grants; new roles can opt in via
   `POST /roles/:id/permissions` from the portal UI.

No schema migration is required.

---

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET    | `/health`                          | — |
| POST   | `/auth/login`                      | — |
| POST   | `/auth/logout`                     | (auth) |
| GET    | `/auth/me`                         | (auth) |
| GET    | `/users`                           | `users.read` |
| GET    | `/users/:id`                       | `users.read` |
| POST   | `/users`                           | `users.create` |
| PATCH  | `/users/:id`                       | `users.update` |
| DELETE | `/users/:id`                       | `users.delete` |
| POST   | `/users/:id/roles`                 | `users.assign_role` |
| DELETE | `/users/:id/roles/:role_id`        | `users.assign_role` |
| GET    | `/users/:id/permissions`           | `users.read` |
| POST   | `/users/:id/permissions`           | `users.assign_permission` |
| DELETE | `/users/:id/permissions/:perm_id`  | `users.assign_permission` |
| GET    | `/roles`                           | `roles.read` |
| GET    | `/roles/:id`                       | `roles.read` |
| POST   | `/roles`                           | `roles.create` |
| PATCH  | `/roles/:id`                       | `roles.update` |
| DELETE | `/roles/:id`                       | `roles.delete` |
| POST   | `/roles/:id/permissions`           | `roles.assign_permission` |
| DELETE | `/roles/:id/permissions/:perm_id`  | `roles.assign_permission` |
| GET    | `/permissions`                     | `permissions.read` |
| POST   | `/permissions`                     | `permissions.create` |
| PATCH  | `/permissions/:id`                 | `permissions.update` |
| DELETE | `/permissions/:id`                 | `permissions.delete` |
| GET    | `/provisions`                      | `provisions.read` |
| GET    | `/provisions/:tenant_id`           | `provisions.read` |
| POST   | `/provisions`                      | `provisions.create` |
| PATCH  | `/provisions/:tenant_id`           | `provisions.update` |
| DELETE | `/provisions/:tenant_id`           | `provisions.delete` |
| GET    | `/plans`                                | `plans.read` |
| GET    | `/plans/:id`                            | `plans.read` |
| POST   | `/plans`                                | `plans.create` |
| PATCH  | `/plans/:id`                            | `plans.update` |
| DELETE | `/plans/:id`                            | `plans.delete` |
| GET    | `/subscriptions`                        | `subscriptions.read` |
| GET    | `/subscriptions/:id`                    | `subscriptions.read` |
| GET    | `/subscriptions/by-tenant/:tenant_id`   | `subscriptions.read` |
| POST   | `/subscriptions/:id/change-plan`        | `subscriptions.update` |
| POST   | `/subscriptions/:id/cancel`             | `subscriptions.cancel` |
| POST   | `/subscriptions/:id/reactivate`         | `subscriptions.cancel` |
| GET    | `/audit`                           | `audit.read` |
| GET    | `/debug`                           | `*` (superadmin) |
| POST   | `/debug/seed`                      | `*` (superadmin) |

All responses follow the platform-wide envelope:

```jsonc
{ "ok": true,  "data": <T> }
{ "ok": false, "error": "<message>", "details": <any?> }
```

### Frontend permission gating

`GET /auth/me` returns the user's flat permission keys, including the
wildcard. The portal can mirror the backend check directly:

```ts
const allowed = perms.includes("*") || perms.includes("provisions.delete");
```

---

## Setup

```sh
cd admin-service
npm install

# 1. Create the admin DB and apply migrations.
npm run db:create
# Paste the returned database_id into wrangler.toml under [[d1_databases]] (DB).
npm run db:migrate

# 2. Set required secrets.
wrangler secret put JWT_SECRET           # openssl rand -hex 32
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
wrangler secret put CF_ZONE_ID

# 3. Seed your first superadmin (one-shot).
#    Hash a password (PBKDF2 "salt:hash"):
node --input-type=module -e \
  'import("./src/password.ts").then(m => m.hashPassword(process.argv[1]).then(console.log))' \
  'YourBootstrapPassword'
wrangler secret put BOOTSTRAP_EMAIL          # e.g. root@upcart.online
wrangler secret put BOOTSTRAP_PASSWORD_HASH  # paste hash from previous step

# 4. Deploy.
npm run deploy
```

On the first `POST /auth/login` whose email matches `BOOTSTRAP_EMAIL`, the
service creates the first superadmin row and grants the `superadmin` role.
Once a superadmin exists the bootstrap branch is unreachable — rotate or
remove `BOOTSTRAP_PASSWORD_HASH` afterwards.

---

## Subscription plans (Stripe-backed)

The platform's plan catalogue lives in `subscription_plans` inside
`upcart-provisioning-db` (migration
`provisioning-service/migrations/0010_create_subscription_plans.sql`). Each
row maps an internal plan key (matching `tenants.plan`) to a Stripe Price
ID, with denormalised amount/currency/interval for display.

Add a plan from the portal:

```http
POST /plans
{
  "key": "pro",
  "display_name": "Pro",
  "stripe_price_id": "price_1Abc..."
}
```

If `STRIPE_SECRET_KEY` is configured, amount/currency/interval are
auto-filled from Stripe. Changing the plan on a tenant's subscription
(`POST /subscriptions/:id/change-plan`) calls Stripe to swap the
subscription item to the new price and updates the local cache.

`provisioning-service` continues to use its `STRIPE_PRICE_ID` env var as
the default plan at signup; it can be migrated to look up plans from this
table whenever convenient — no breaking change is required today.

## Cross-service integration

- **Same D1 as provisioning-service**: bound here as `PROVISIONING_DB` (read
  + write). Cloudflare D1 supports the same database being attached to
  multiple Workers. The database_id in `wrangler.toml` must match the one
  in `provisioning-service/wrangler.toml`.
- **Same R2 bucket as provisioning-service**: bound here as `WORKER_BUNDLES`
  so `POST /provisions` can deploy the latest store-worker bundle.
- The `CloudflareAPI` client is vendored from `provisioning-service/src/`
  to keep deploys independent — there is no shared package today. Update
  both copies together when the upstream API changes.

---

## Modular extension

Future "management modules" (content flagging, support tools, review
workflows, …) follow this recipe:

1. Add a new migration `migrations/0NNN_<module>.sql` (only if you need a
   new table — most modules can reuse `audit_log` and add their own).
2. Append the module's permissions to `SYSTEM_PERMISSIONS` in
   `src/seed.ts`.
3. Drop a new file `src/db/<module>.ts` with the table accessors.
4. Drop a new file `src/routes/<module>.ts` with `requirePermissions(...)`
   on every handler and `audit(c, ...)` after every mutation.
5. Mount it from `src/index.ts`:
   ```ts
   app.use("/<module>/*", authMiddleware());
   app.route("/<module>",  moduleRouter);
   ```
6. Re-deploy. The seeder picks up the new permissions automatically.

No breaking change to existing roles, frontends, or data is required.
