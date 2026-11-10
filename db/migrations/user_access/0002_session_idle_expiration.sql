-- Up Migration
-- Keep remembered-session idle expiry aligned with the latest authenticated activity.
UPDATE access.user_sessions
SET remember_idle_expires_at = LEAST(
  last_seen_at + interval '7 days',
  remember_absolute_expires_at
)
WHERE remember_token_hash IS NOT NULL
  AND remember_absolute_expires_at > now()
  AND last_seen_at > now() - interval '7 days';

-- Mark already-expired records as revoked so they are not presented as active sessions.
UPDATE access.user_sessions
SET revoked_at = now()
WHERE revoked_at IS NULL
  AND NOT (
    (absolute_expires_at > now() AND idle_expires_at > now())
    OR (
      remember_token_hash IS NOT NULL
      AND remember_absolute_expires_at > now()
      AND remember_idle_expires_at > now()
    )
  );

CREATE OR REPLACE FUNCTION access.enforce_max_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM access.user_sessions
    WHERE user_id = NEW.user_id
      AND revoked_at IS NULL
      AND (
        (absolute_expires_at > now() AND idle_expires_at > now())
        OR (
          remember_token_hash IS NOT NULL
          AND remember_absolute_expires_at > now()
          AND remember_idle_expires_at > now()
        )
      )
  ) >= 2 THEN
    RAISE EXCEPTION 'session_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration
-- Restore the previous trigger behavior (the expired-session cleanup above is intentionally irreversible).
CREATE OR REPLACE FUNCTION access.enforce_max_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM access.user_sessions
    WHERE user_id = NEW.user_id
      AND revoked_at IS NULL
      AND (absolute_expires_at > now() OR remember_absolute_expires_at > now())
  ) >= 2 THEN
    RAISE EXCEPTION 'session_limit_reached';
  END IF;
  RETURN NEW;
END;
$$;
