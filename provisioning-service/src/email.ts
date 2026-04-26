// Transactional email helpers — all sent via the Resend API.
// Uses the same RESEND_API_KEY as the OTP module.

async function send(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Upcart <noreply@upcart.online>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`);
  }
}

// ─── Trial expiry notices ─────────────────────────────────────────────────────

export async function sendTrialEndingEmail(
  apiKey: string,
  toEmail: string,
  storeName: string,
  daysLeft: number,
  dashboardUrl: string
): Promise<void> {
  const urgency = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
  await send(
    apiKey,
    toEmail,
    `Your Upcart free trial ends ${urgency}`,
    `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#C9A227;margin-top:0">Your free trial is ending ${urgency}</h2>
      <p>Hi there,</p>
      <p>Your Upcart free trial for <strong>${storeName}</strong> ends ${urgency}.</p>
      <p>After your trial expires, your store will remain active and you'll be charged
         based on your plan. No action needed if you'd like to continue — your saved
         payment method will be charged automatically.</p>
      <p>To update your billing details or cancel before the trial ends, visit your dashboard:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${dashboardUrl}" style="background:#C9A227;color:#000;padding:12px 28px;
           border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
          Go to Dashboard
        </a>
      </p>
      <p style="color:#888;font-size:0.8rem">
        You're receiving this because you signed up for an Upcart store.
      </p>
    </div>
    `
  );
}

export async function sendTrialExpiredEmail(
  apiKey: string,
  toEmail: string,
  storeName: string,
  dashboardUrl: string
): Promise<void> {
  await send(
    apiKey,
    toEmail,
    `Your Upcart free trial has ended`,
    `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#C9A227;margin-top:0">Your free trial has ended</h2>
      <p>Hi there,</p>
      <p>Your 90-day free trial for <strong>${storeName}</strong> on Upcart has ended.</p>
      <p>Your store is still live! To keep it running, make sure your payment method is up
         to date. Your subscription will renew automatically.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${dashboardUrl}" style="background:#C9A227;color:#000;padding:12px 28px;
           border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
          Manage Billing
        </a>
      </p>
      <p style="color:#888;font-size:0.8rem">
        You're receiving this because you signed up for an Upcart store.
      </p>
    </div>
    `
  );
}

// ─── Payment failure / suspension ────────────────────────────────────────────

export async function sendPaymentFailedEmail(
  apiKey: string,
  toEmail: string,
  storeName: string,
  dashboardUrl: string
): Promise<void> {
  await send(
    apiKey,
    toEmail,
    `Action required: payment failed for ${storeName}`,
    `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#c53030;margin-top:0">Payment failed</h2>
      <p>Hi there,</p>
      <p>We were unable to process your payment for <strong>${storeName}</strong>.</p>
      <p>We'll retry automatically. If the payment continues to fail, your store may be
         suspended. Please update your payment method to avoid any interruption.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${dashboardUrl}" style="background:#C9A227;color:#000;padding:12px 28px;
           border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
          Update Payment Method
        </a>
      </p>
      <p style="color:#888;font-size:0.8rem">
        You're receiving this because you have an active Upcart subscription.
      </p>
    </div>
    `
  );
}

export async function sendStoreSuspendedEmail(
  apiKey: string,
  toEmail: string,
  storeName: string,
  dashboardUrl: string
): Promise<void> {
  await send(
    apiKey,
    toEmail,
    `Your store has been suspended`,
    `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#c53030;margin-top:0">Store suspended</h2>
      <p>Hi there,</p>
      <p>Your Upcart store <strong>${storeName}</strong> has been suspended due to
         repeated payment failures.</p>
      <p>Your store is currently showing a "Store Suspended" page to visitors.
         Update your payment method to restore it immediately.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${dashboardUrl}" style="background:#C9A227;color:#000;padding:12px 28px;
           border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
          Restore My Store
        </a>
      </p>
      <p style="color:#888;font-size:0.8rem">
        If payment is not resolved within 30 days, your store and its data will be
        permanently deleted.
      </p>
    </div>
    `
  );
}

export async function sendPaymentRecoveredEmail(
  apiKey: string,
  toEmail: string,
  storeName: string,
  storeUrl: string
): Promise<void> {
  await send(
    apiKey,
    toEmail,
    `Your store is back online`,
    `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#2f855a;margin-top:0">Store restored</h2>
      <p>Hi there,</p>
      <p>Great news! Your payment has been processed successfully and
         <strong>${storeName}</strong> is back online.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${storeUrl}" style="background:#C9A227;color:#000;padding:12px 28px;
           border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
          Visit Your Store
        </a>
      </p>
      <p style="color:#888;font-size:0.8rem">
        You're receiving this because you have an active Upcart subscription.
      </p>
    </div>
    `
  );
}
