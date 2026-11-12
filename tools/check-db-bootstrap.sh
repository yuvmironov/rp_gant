#!/bin/sh
set -eu

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-rp_gant}"
PGPASSWORD="${PGPASSWORD:-rp_gant_dev}"
export PGHOST PGUSER PGPASSWORD

for database in rp_gant_project rp_gant_notification rp_gant_audit rp_gant_sync; do
  psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres -c "CREATE DATABASE $database" 2>/dev/null || true
done

DB_ROOT=db sh infrastructure/local/db-init.sh

assert_count() {
  database="$1"
  query="$2"
  expected="$3"
  actual="$(psql -tA -U "$PGUSER" -d "$database" -c "$query" | tr -d '[:space:]')"
  if [ "$actual" != "$expected" ]; then
    echo "Expected $expected from $database: $query, got $actual"
    exit 1
  fi
}

assert_count rp_gant_user "SELECT count(*) FROM access.roles" 6
assert_count rp_gant_user "SELECT count(*) FROM access.permissions" 26
assert_count rp_gant_user "SELECT count(*) FROM access.role_permissions" 72
assert_count rp_gant_user "SELECT count(*) FROM settings.system_settings" 16
assert_count rp_gant_audit "SELECT count(*) FROM audit.audit_actions" 64
assert_count rp_gant_sync "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'events' AND table_name = 'processed_events'" 1
assert_count rp_gant_project "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'project' AND table_name = 'projects'" 1
assert_count rp_gant_project "SELECT count(*) FROM pg_constraint WHERE conname = 'assignments_entity_role_assignee_check'" 1

psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d rp_gant_project <<'SQL'
BEGIN;
DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO plan.assignments
      (entity_type, entity_id, role, assignee_type, assignee_id, created_by_user_id)
    VALUES
      ('task', '11111111-1111-4111-8111-111111111111', 'responsible', 'user',
       '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'task responsible assignment was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO plan.assignments
      (entity_type, entity_id, role, assignee_type, assignee_id, created_by_user_id)
    VALUES
      ('direction', '44444444-4444-4444-8444-444444444444', 'responsible', 'executor',
       '55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'catalog direction responsible assignment was accepted';
  END IF;
END;
$$;
ROLLBACK;
SQL

psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d rp_gant_user <<'SQL'
BEGIN;
DO $$
DECLARE
  regular_user uuid;
  expired_remember_user uuid;
  active_remember_user uuid;
  limit_hit boolean;
BEGIN
  INSERT INTO access.users (email, password_hash, display_name)
  VALUES ('session-limit-' || gen_random_uuid() || '@example.test', 'test-hash', 'Session test')
  RETURNING id INTO regular_user;

  INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
  VALUES (
    regular_user,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
    now() + interval '50 minutes',
    now() - interval '1 minute'
  );

  INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
  VALUES
    (regular_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes'),
    (regular_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');

  limit_hit := false;
  BEGIN
    INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
    VALUES (regular_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'session_limit_reached' THEN
      limit_hit := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT limit_hit THEN
    RAISE EXCEPTION 'session limit was not enforced for two active sessions';
  END IF;

  INSERT INTO access.users (email, password_hash, display_name)
  VALUES ('session-remember-expired-' || gen_random_uuid() || '@example.test', 'test-hash', 'Expired remember test')
  RETURNING id INTO expired_remember_user;

  INSERT INTO access.user_sessions (
    user_id, session_token_hash, absolute_expires_at, idle_expires_at,
    remember_token_hash, remember_absolute_expires_at, remember_idle_expires_at
  ) VALUES (
    expired_remember_user,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
    now() + interval '50 minutes',
    now() - interval '1 minute',
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
    now() + interval '20 days',
    now() - interval '1 minute'
  );

  INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
  VALUES
    (expired_remember_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes'),
    (expired_remember_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');

  limit_hit := false;
  BEGIN
    INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
    VALUES (expired_remember_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'session_limit_reached' THEN
      limit_hit := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT limit_hit THEN
    RAISE EXCEPTION 'session limit was not enforced after expired remember token';
  END IF;

  INSERT INTO access.users (email, password_hash, display_name)
  VALUES ('session-remember-active-' || gen_random_uuid() || '@example.test', 'test-hash', 'Active remember test')
  RETURNING id INTO active_remember_user;

  INSERT INTO access.user_sessions (
    user_id, session_token_hash, absolute_expires_at, idle_expires_at,
    remember_token_hash, remember_absolute_expires_at, remember_idle_expires_at
  ) VALUES (
    active_remember_user,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
    now() - interval '1 minute',
    now() - interval '1 minute',
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
    now() + interval '20 days',
    now() + interval '6 days'
  );

  INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
  VALUES (active_remember_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');

  limit_hit := false;
  BEGIN
    INSERT INTO access.user_sessions (user_id, session_token_hash, absolute_expires_at, idle_expires_at)
    VALUES (active_remember_user, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), now() + interval '50 minutes', now() + interval '5 minutes');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'session_limit_reached' THEN
      limit_hit := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT limit_hit THEN
    RAISE EXCEPTION 'active remember token was not counted toward the session limit';
  END IF;
END;
$$;
PREPARE session_idle_update(timestamptz, timestamptz, uuid) AS
  UPDATE access.user_sessions
  SET idle_expires_at = $1,
      remember_idle_expires_at = $2::timestamptz,
      last_seen_at = now()
  WHERE id = $3;
EXECUTE session_idle_update(now(), NULL, gen_random_uuid());
DEALLOCATE session_idle_update;
ROLLBACK;
SQL

echo "Database bootstrap checks passed"
