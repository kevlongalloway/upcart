// Cron job: runs daily, sends trial-expiry reminder emails and flags
// tenants that have been suspended for >30 days for deprovision.
//
// Triggered by the [triggers] crons schedule in wrangler.toml.

import type { Bindings } from "../types.js";
import { TenantDB } from "../db.js";
import {
  sendTrialEndingEmail,
  sendTrialExpiredEmail,
} from "../email.js";

export async function handleTrialExpiry(env: Bindings): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping trial-expiry email job.");
    return;
  }

  const db          = new TenantDB(env.DB);
  const dashboardUrl = `https://dashboard.${env.BASE_DOMAIN}`;
  const today        = Date.now();

  let subs: Awaited<ReturnType<typeof db.getSubscriptionsForTrialReminders>>;
  try {
    subs = await db.getSubscriptionsForTrialReminders();
  } catch (e) {
    console.error("trial-expiry: failed to query subscriptions:", e);
    return;
  }

  for (const sub of subs) {
    const trialMs  = new Date(sub.trial_ends_at).getTime();
    const daysLeft = Math.ceil((trialMs - today) / (1000 * 60 * 60 * 24));

    try {
      if (daysLeft <= 0 && !sub.expired_notice_sent) {
        await sendTrialExpiredEmail(env.RESEND_API_KEY, sub.email, sub.store_name, dashboardUrl);
        await db.markTrialReminderSent(sub.id, "expired");
        console.log(`trial-expiry: sent expired notice to ${sub.email} (sub ${sub.id})`);
      } else if (daysLeft <= 1 && !sub.reminder_1d_sent) {
        await sendTrialEndingEmail(env.RESEND_API_KEY, sub.email, sub.store_name, 1, dashboardUrl);
        await db.markTrialReminderSent(sub.id, "1d");
        console.log(`trial-expiry: sent 1d reminder to ${sub.email} (sub ${sub.id})`);
      } else if (daysLeft <= 7 && !sub.reminder_7d_sent) {
        await sendTrialEndingEmail(env.RESEND_API_KEY, sub.email, sub.store_name, daysLeft, dashboardUrl);
        await db.markTrialReminderSent(sub.id, "7d");
        console.log(`trial-expiry: sent 7d reminder to ${sub.email} (sub ${sub.id})`);
      } else if (daysLeft <= 30 && !sub.reminder_30d_sent) {
        await sendTrialEndingEmail(env.RESEND_API_KEY, sub.email, sub.store_name, daysLeft, dashboardUrl);
        await db.markTrialReminderSent(sub.id, "30d");
        console.log(`trial-expiry: sent 30d reminder to ${sub.email} (sub ${sub.id})`);
      }
    } catch (e) {
      console.error(`trial-expiry: failed for sub ${sub.id}:`, e);
    }
  }
}
