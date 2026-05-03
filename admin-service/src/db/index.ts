// Composition root for the admin-service DB layer. Each route handler grabs
// a fresh AdminDB off the request context — D1 statements are stateless so
// the cost of constructing one per request is just allocating a few class
// instances.

import type { Bindings } from "../types.js";
import { UsersDB } from "./users.js";
import { RolesDB } from "./roles.js";
import { PermissionsDB } from "./permissions.js";
import { AuditDB } from "./audit.js";
import { ProvisionsDB } from "./provisions.js";
import { PlansDB } from "./plans.js";
import { SubscriptionsDB } from "./subscriptions.js";

export class AdminDB {
  readonly users: UsersDB;
  readonly roles: RolesDB;
  readonly permissions: PermissionsDB;
  readonly audit: AuditDB;
  readonly provisions: ProvisionsDB;
  readonly plans: PlansDB;
  readonly subscriptions: SubscriptionsDB;

  constructor(env: Pick<Bindings, "DB" | "PROVISIONING_DB">) {
    this.users         = new UsersDB(env.DB);
    this.roles         = new RolesDB(env.DB);
    this.permissions   = new PermissionsDB(env.DB);
    this.audit         = new AuditDB(env.DB);
    this.provisions    = new ProvisionsDB(env.PROVISIONING_DB);
    this.plans         = new PlansDB(env.PROVISIONING_DB);
    this.subscriptions = new SubscriptionsDB(env.PROVISIONING_DB);
  }
}

export {
  UsersDB, RolesDB, PermissionsDB, AuditDB, ProvisionsDB,
  PlansDB, SubscriptionsDB,
};
