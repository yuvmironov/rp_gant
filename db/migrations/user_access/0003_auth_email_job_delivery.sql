-- Up Migration

ALTER TABLE jobs.auth_email_jobs
  ADD COLUMN IF NOT EXISTS locale varchar(16) NOT NULL DEFAULT 'ru-RU',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE jobs.auth_email_jobs
SET expires_at = created_at + interval '7 days'
WHERE expires_at IS NULL;

ALTER TABLE jobs.auth_email_jobs
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_auth_email_jobs_expiry
  ON jobs.auth_email_jobs (expires_at)
  WHERE status IN ('pending', 'sending');

-- Down Migration

DROP INDEX IF EXISTS ix_auth_email_jobs_expiry;
ALTER TABLE jobs.auth_email_jobs
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS locale;
