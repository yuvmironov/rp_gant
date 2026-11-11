-- Up Migration

CREATE SCHEMA IF NOT EXISTS events;

CREATE TABLE IF NOT EXISTS events.processed_events (
  consumer varchar(64) NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE INDEX IF NOT EXISTS ix_sync_processed_events_processed_at
  ON events.processed_events (processed_at);

-- Down Migration

DROP TABLE IF EXISTS events.processed_events;
