import type {
  CfApiResult,
  CfD1Database,
  CfR2Bucket,
  CfWorkerScript,
  CfWorkerRoute,
} from "./types.js";

// ─── Cloudflare API client ────────────────────────────────────────────────────
// Thin wrapper around the Cloudflare REST API.
// Auth: Bearer token with Workers:Edit, D1:Edit, R2:Edit, Zone:Edit scopes.

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareAPI {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType = "application/json"
  ): Promise<CfApiResult<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    };

    let bodyInit: BodyInit | undefined;

    if (body instanceof FormData) {
      // Let fetch set the Content-Type with boundary automatically
      bodyInit = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = contentType;
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
      throw new Error(`Cloudflare API error on ${method} ${path}: ${msg}`);
    }

    return json;
  }

  // ── D1 ───────────────────────────────────────────────────────────────────────

  /** Create a new D1 database. Returns the database record. */
  async createD1Database(name: string): Promise<CfD1Database> {
    const res = await this.request<CfD1Database>(
      "POST",
      `/accounts/${this.accountId}/d1/database`,
      { name, primary_location_hint: "WNAM" }
    );
    return res.result;
  }

  /**
   * Run SQL against a D1 database.
   * Used to apply migrations on a freshly created database.
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
   * Run multiple SQL statements against a D1 database (sequential).
   * Splits on statement boundaries so the API receives one statement per call.
   */
  async runD1Migrations(databaseId: string, sql: string): Promise<void> {
    // Split on semicolons that are not inside string literals (simple heuristic)
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
   * @param scriptName - Unique name for the Worker script
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
    form.append("metadata", JSON.stringify(metadata), {
      type: "application/json",
      filename: "metadata.json",
    } as unknown as string);
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
   * Call once per secret — Cloudflare has no bulk-secret endpoint.
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

  /**
   * Add a custom domain (hostname on your zone) to a Worker script.
   * This is the "Custom Domains" feature — no DNS record needed separately.
   *
   * @param hostname - e.g. "mystore.upcart.online"
   * @param zoneId   - Cloudflare zone ID for upcart.online
   */
  async addWorkerCustomDomain(
    scriptName: string,
    hostname: string,
    zoneId: string
  ): Promise<void> {
    await this.request(
      "PUT",
      `/accounts/${this.accountId}/workers/domains`,
      {
        hostname,
        zone_id: zoneId,
        service: scriptName,
        environment: "production",
      }
    );
  }

  /**
   * Add a workers route to a zone (pattern-based routing).
   * Alternative to Custom Domains — used when you need wildcard routing.
   *
   * @param zoneId  - Cloudflare zone ID
   * @param pattern - e.g. "mystore.upcart.online/*"
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
}
