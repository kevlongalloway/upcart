-- verification_tokens: stores short-lived OTPs for pre-provisioning identity
-- verification (email and SMS). Tokens are keyed by identifier (email/phone)
-- and expire after 10 minutes. Rate limiting is enforced at the API layer by
-- counting rows created within the last 10-minute window.
CREATE TABLE IF NOT EXISTS verification_tokens (
  id            TEXT    PRIMARY KEY,
  identifier    TEXT    NOT NULL,                          -- email or E.164 phone
  channel       TEXT    NOT NULL CHECK (channel IN ('email', 'sms')),
  code          TEXT    NOT NULL,                          -- 6-digit OTP
  expires_at    TEXT    NOT NULL,                          -- ISO 8601
  verified_at   TEXT,                                      -- NULL until verified
  attempt_count INTEGER NOT NULL DEFAULT 0,                -- wrong-code attempts
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vt_identifier_channel
  ON verification_tokens (identifier, channel, created_at);

-- Track which identity channel(s) were verified before provisioning
ALTER TABLE tenants ADD COLUMN email_verified_at TEXT;
ALTER TABLE tenants ADD COLUMN phone_number      TEXT;
ALTER TABLE tenants ADD COLUMN phone_verified_at TEXT;
