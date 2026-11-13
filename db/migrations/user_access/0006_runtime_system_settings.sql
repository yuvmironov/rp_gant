-- db-init executes migration files directly with psql -f, so this forward migration has no down block.
CREATE OR REPLACE FUNCTION access.enforce_max_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  max_allowed integer;
  active_count integer;
BEGIN
  SELECT CASE
           WHEN jsonb_typeof(value) = 'number' THEN
             CASE
               WHEN (value #>> '{}')::numeric BETWEEN 1 AND 20
                 AND (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)
               THEN (value #>> '{}')::integer
               ELSE 2
             END
           ELSE 2
         END
  INTO max_allowed
  FROM settings.system_settings
  WHERE key = 'max_sessions';

  max_allowed := COALESCE(max_allowed, 2);
  IF max_allowed < 1 OR max_allowed > 20 THEN
    max_allowed := 2;
  END IF;

  SELECT count(*)
  INTO active_count
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
    );

  IF active_count >= max_allowed THEN
    RAISE EXCEPTION 'session_limit_reached'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
