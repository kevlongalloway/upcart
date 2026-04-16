/**
 * Helpers for managing the merchant balance ledger.
 *
 * These are used by the webhook handler (on payment) and the admin order
 * update route (on delivery confirmation) to keep the merchant_balances
 * and balance_transactions tables in sync.
 */

// ─── creditPendingBalance ───────────────────────────────────────────────────
/**
 * Called when a payment succeeds. Adds the order amount to the merchant's
 * pending_balance (funds held until delivery is confirmed).
 */
export async function creditPendingBalance(
  db: D1Database,
  tenantId: string,
  orderId: string,
  amount: number,
  currency: string
): Promise<void> {
  const now = new Date().toISOString();
  const txnId = crypto.randomUUID();

  // Ensure a merchant_balances row exists for this tenant.
  await db
    .prepare(
      `INSERT INTO merchant_balances (id, tenant_id, available_balance, pending_balance, currency, updated_at)
       VALUES (?1, ?2, 0, 0, ?3, ?4)
       ON CONFLICT(tenant_id) DO NOTHING`
    )
    .bind(crypto.randomUUID(), tenantId, currency, now)
    .run();

  // Read current available balance for the ledger entry.
  const bal = await db
    .prepare("SELECT available_balance FROM merchant_balances WHERE tenant_id = ?1")
    .bind(tenantId)
    .first<{ available_balance: number }>();

  await db.batch([
    // Increase pending balance.
    db
      .prepare(
        "UPDATE merchant_balances SET pending_balance = pending_balance + ?1, updated_at = ?2 WHERE tenant_id = ?3"
      )
      .bind(amount, now, tenantId),
    // Record the sale in the ledger (balance_after reflects available, not pending).
    db
      .prepare(
        `INSERT INTO balance_transactions (id, tenant_id, type, amount, balance_after, order_id, description, created_at)
         VALUES (?1, ?2, 'sale', ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        txnId,
        tenantId,
        amount,
        bal?.available_balance ?? 0,
        orderId,
        `Sale — order ${orderId}`,
        now
      ),
  ]);
}

// ─── releasePendingToAvailable ──────────────────────────────────────────────
/**
 * Called when an order is marked as delivered. Moves the order amount from
 * pending_balance to available_balance so the merchant can withdraw it.
 */
export async function releasePendingToAvailable(
  db: D1Database,
  tenantId: string,
  orderId: string,
  amount: number
): Promise<void> {
  const now = new Date().toISOString();
  const txnId = crypto.randomUUID();

  // Read current available balance to compute balance_after.
  const bal = await db
    .prepare("SELECT available_balance FROM merchant_balances WHERE tenant_id = ?1")
    .bind(tenantId)
    .first<{ available_balance: number }>();

  const newAvailable = (bal?.available_balance ?? 0) + amount;

  await db.batch([
    // Move from pending to available.
    db
      .prepare(
        `UPDATE merchant_balances
         SET pending_balance = MAX(0, pending_balance - ?1),
             available_balance = available_balance + ?1,
             updated_at = ?2
         WHERE tenant_id = ?3`
      )
      .bind(amount, now, tenantId),
    // Record the release in the ledger.
    db
      .prepare(
        `INSERT INTO balance_transactions (id, tenant_id, type, amount, balance_after, order_id, description, created_at)
         VALUES (?1, ?2, 'release', ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        txnId,
        tenantId,
        amount,
        newAvailable,
        orderId,
        `Funds released — order ${orderId} delivered`,
        now
      ),
  ]);
}
