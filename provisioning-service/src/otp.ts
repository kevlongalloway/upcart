// OTP generation and delivery via Resend (email) and Twilio (SMS).
// All functions use raw fetch — no Node.js SDK needed in CF Workers.

export function generateOtpCode(): string {
  // 3 random bytes → values 0–16777215 → mod 1 000 000 → 6-digit string
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const n = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export async function sendEmailOtp(
  resendApiKey: string,
  toEmail: string,
  code: string
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Upcart <noreply@upcart.online>",
      to: [toEmail],
      subject: `${code} is your Upcart verification code`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#C9A227;margin-top:0">Verify your email</h2>
          <p style="color:#333">Use the code below to verify your email address and continue setting up your Upcart store.</p>
          <div style="font-size:2.25rem;font-weight:700;letter-spacing:0.35em;background:#f4f4f4;padding:20px;text-align:center;border-radius:8px;margin:24px 0">${code}</div>
          <p style="color:#666;font-size:0.875rem">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`);
  }
}

export async function sendSmsOtp(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toNumber: string,
  code: string
): Promise<void> {
  const credentials = btoa(`${accountSid}:${authToken}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      Body: `Your Upcart verification code is ${code}. It expires in 10 minutes.`,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Twilio ${res.status}: ${JSON.stringify(body)}`);
  }
}
