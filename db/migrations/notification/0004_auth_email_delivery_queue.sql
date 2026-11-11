-- Up Migration

ALTER TABLE delivery.auth_email_deliveries
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS locale varchar(16) NOT NULL DEFAULT 'ru-RU',
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE delivery.auth_email_deliveries
  DROP CONSTRAINT IF EXISTS auth_email_deliveries_status_check;
ALTER TABLE delivery.auth_email_deliveries
  ADD CONSTRAINT auth_email_deliveries_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'retrying'));

CREATE INDEX IF NOT EXISTS ix_auth_email_deliveries_next
  ON delivery.auth_email_deliveries (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS delivery.auth_email_delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery.auth_email_deliveries(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('started', 'sent', 'failed')),
  provider_message_id varchar(200),
  error_code varchar(64),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (delivery_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS ix_auth_email_delivery_attempts_delivery
  ON delivery.auth_email_delivery_attempts (delivery_id);

-- Down Migration

DROP INDEX IF EXISTS ix_auth_email_delivery_attempts_delivery;
DROP TABLE IF EXISTS delivery.auth_email_delivery_attempts;
DROP INDEX IF EXISTS ix_auth_email_deliveries_next;
UPDATE delivery.auth_email_deliveries SET status = 'pending' WHERE status IN ('sending', 'retrying');
ALTER TABLE delivery.auth_email_deliveries
  DROP CONSTRAINT IF EXISTS auth_email_deliveries_status_check;
ALTER TABLE delivery.auth_email_deliveries
  ADD CONSTRAINT auth_email_deliveries_status_check
  CHECK (status IN ('pending', 'sent', 'failed'));
ALTER TABLE delivery.auth_email_deliveries
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS locale,
  DROP COLUMN IF EXISTS variables;
