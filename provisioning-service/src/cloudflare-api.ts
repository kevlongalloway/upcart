import type {
  CfApiResult,
  CfD1Database,
  CfR2Bucket,
  CfWorkerScript,
  CfWorkerRoute,
  CfDnsRecord,
  CfCustomDomain,
} from "./types.js";

// ─── Cloudflare API client ────────────────────────────────────────────────────
// Thin wrapper around the Cloudflare REST API.
// Required API token scopes:
//   Workers Scripts:Edit, D1:Edit, R2:Edit, Zone DNS:Edit, Workers Routes:Edit

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareAPI {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<CfApiResult<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    };

    let bodyInit: BodyInit | undefined;

    if (body instanceof FormData) {
      // Let fetch set the multipart Content-Type + boundary automatically.
      bodyInit = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(body);
    }

    const res = await fetch(`${CF_BASE}${path}`, {
      method,
      headers,
      body: bodyInit,
    });

    const json = (await res.json()) as CfApiResult<T>;

    if (!res.ok || !json.success) {
      const msg = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
      throw new Error(`Cloudflare API error [${method} ${path}]: ${msg}`);
    }

    return json;
  }

  // ── DNS ───────────────────────────────────────────────────────────────────────

  /**
   * Create a proxied DNS record for a subdomain.
   *
   * For Worker-backed subdomains the canonical approach is a proxied AAAA
   * record pointing to the unroutable address `100::`.  Cloudflare intercepts
   * all traffic at the proxy edge before it ever reaches that address, so it
   * acts purely as a "this hostname is on Cloudflare" marker.
   *
   * @param zoneId   - Cloudflare zone ID (e.g. for upcart.online)
   * @param name     - Full hostname, e.g. "mystore.upcart.online"
   * @param type     - DNS record type; "AAAA" (default) for Worker subdomains
   * @param content  - Record value; "100::" is the standard placeholder for proxied Workers
   */
  async createDnsRecord(
    zoneId: string,
    name: string,
    type: "A" | "AAAA" | "CNAME" = "AAAA",
    content = "100::"
  ): Promise<CfDnsRecord> {
    const res = await this.request<CfDnsRecord>(
      "POST",
      `/zones/${zoneId}/dns_records`,
      {
        type,
        name,
        content,
        proxied: true,
        ttl: 1, // 1 = automatic TTL when proxied
        comment: "Auto-created by Upcart provisioning",
      }
    );
    return res.result;
  }

  /**
   * Look up existing DNS records for a hostname.
   * Used before creating a record to avoid duplicate conflicts.
   */
  async listDnsRecords(zoneId: string, name: string): Promise<CfDnsRecord[]> {
    const encoded = encodeURIComponent(name);
    const res = await this.request<CfDnsRecord[]>(
      "GET",
      `/zones/${zoneId}/dns_records?name=${encoded}&per_page=10`
    );
    return res.result ?? [];
  }

  /**
   * Delete a DNS record by ID.
   * Called during deprovisioning or when rolling back a failed sign-up.
   */
  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/zones/${zoneId}/dns_records/${recordId}`
    );
  }

  // ── D1 ───────────────────────────────────────────────────────────────────────

  /** Create a new D1 database. */
  async createD1Database(name: string): Promise<CfD1Database> {
    const res = await this.request<CfD1Database>(
      "POST",
      `/accounts/${this.accountId}/d1/database`,
      { name, primary_location_hint: "WNAM" }
    );
    return res.result;
  }

  /**
   * Run a single SQL statement against a D1 database via the REST API.
   * Used to apply migrations to a freshly created database.
   */
  async runD1Query(
    databaseId: string,
    sql: string,
    params: unknown[] = []
  ): Promise<void> {
    await this.request(
      "POST",
      `/accounts/${this.accountId}/d1/database/${databaseId}/query`,
      { sql, params }
    );
  }

  /**
   * Apply a block of SQL migration statements to a D1 database.
   * Splits on double-newline-separated semicolons and skips comment-only lines.
   */
  async runD1Migrations(databaseId: string, sql: string): Promise<void> {
    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      await this.runD1Query(databaseId, stmt + ";");
    }
  }

  // ── R2 ───────────────────────────────────────────────────────────────────────

  /** Create a new R2 bucket. */
  async createR2Bucket(name: string): Promise<CfR2Bucket> {
    const res = await this.request<CfR2Bucket>(
      "POST",
      `/accounts/${this.accountId}/r2/buckets`,
      { name }
    );
    return res.result;
  }

  // ── Workers ──────────────────────────────────────────────────────────────────

  /**
   * Deploy a Worker script with D1 and R2 bindings and plain-text env vars.
   *
   * @param scriptName - Unique name for the Worker (e.g. "upcart-store-<tenantId>")
   * @param bundle     - Compiled ES module bundle (ArrayBuffer)
   * @param d1Id       - D1 database UUID to bind as "DB"
   * @param r2Bucket   - R2 bucket name to bind as "IMAGES"
   * @param vars       - Additional plain-text environment variables
   */
  async deployWorker(
    scriptName: string,
    bundle: ArrayBuffer,
    d1Id: string,
    r2Bucket: string,
    vars: Record<string, string>
  ): Promise<CfWorkerScript> {
    const metadata = {
      main_module: "worker.js",
      compatibility_date: "2025-01-01",
      compatibility_flags: ["nodejs_compat_v2"],
      bindings: [
        { type: "d1", name: "DB", id: d1Id },
        { type: "r2_bucket", name: "IMAGES", bucket_name: r2Bucket },
        ...Object.entries(vars).map(([name, text]) => ({
          type: "plain_text",
          name,
          text,
        })),
      ],
    };

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json"
    );
    form.append(
      "worker.js",
      new Blob([bundle], { type: "application/javascript+module" }),
      "worker.js"
    );

    const res = await this.request<CfWorkerScript>(
      "PUT",
      `/accounts/${this.accountId}/workers/scripts/${scriptName}`,
      form
    );
    return res.result;
  }

  /**
   * Set a single secret on a Worker script.
   * The Cloudflare API has no bulk endpoint; call once per secret.
   */
  async setWorkerSecret(
    scriptName: string,
    name: string,
    value: string
  ): Promise<void> {
    await this.request(
      "PUT",
      `/accounts/${this.accountId}/workers/scripts/${scriptName}/secrets`,
      { name, text: value, type: "secret_text" }
    );
  }

  // ── Worker Custom Domains ─────────────────────────────────────────────────────
  //
  // Custom Domains is the recommended approach for binding a Worker to a
  // subdomain.  A single PUT call handles both the DNS record creation AND
  // the SSL certificate — no separate DNS step needed.
  //
  // The DNS record + Worker Route approach (below) is kept as a fallback for
  // accounts where the Custom Domains API is unavailable or returns an error.

  /**
   * Bind a Worker script to a custom hostname via the Custom Domains API.
   *
   * Cloudflare automatically:
   *   1. Creates a proxied DNS record for the hostname in the zone.
   *   2. Provisions an SSL certificate for the hostname.
   *   3. Routes all traffic for `hostname` through the Worker.
   *
   * @param scriptName - Worker script name
   * @param hostname   - e.g. "mystore.upcart.online"
   * @param zoneId     - Cloudflare zone ID for the domain
   * @returns          The custom domain record, including its `id`
   */
  async addWorkerCustomDomain(
    scriptName: string,
    hostname: string,
    zoneId: string
  ): Promise<CfCustomDomain> {
    const res = await this.request<CfCustomDomain>(
      "PUT",
      `/accounts/${this.accountId}/workers/domains`,
      {
        hostname,
        zone_id: zoneId,
        service: scriptName,
        environment: "production",
      }
    );
    return res.result;
  }

  /**
   * Remove a Custom Domain binding from a Worker.
   * Does NOT delete the underlying DNS record — call deleteDnsRecord separately.
   */
  async removeWorkerCustomDomain(domainId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/accounts/${this.accountId}/workers/domains/${domainId}`
    );
  }

  // ── Worker Routes (fallback) ──────────────────────────────────────────────────
  //
  // Pattern-based routing requires:
  //   1. A proxied DNS record for the hostname (created via createDnsRecord).
  //   2. A route entry associating the pattern with the Worker script.
  //
  // Use this only if Custom Domains is unavailable.

  /**
   * Add a Worker route to a zone.
   *
   * @param zoneId     - Cloudflare zone ID
   * @param pattern    - e.g. "mystore.upcart.online/*"
   * @param scriptName - Worker script to handle matching requests
   */
  async addWorkerRoute(
    zoneId: string,
    pattern: string,
    scriptName: string
  ): Promise<CfWorkerRoute> {
    const res = await this.request<CfWorkerRoute>(
      "POST",
      `/zones/${zoneId}/workers/routes`,
      { pattern, script: scriptName }
    );
    return res.result;
  }

  /** Delete a Worker route by ID. */
  async deleteWorkerRoute(zoneId: string, routeId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/zones/${zoneId}/workers/routes/${routeId}`
    );
  }
}
