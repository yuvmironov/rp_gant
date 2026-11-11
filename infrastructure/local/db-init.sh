#!/bin/sh
set -eu

USER_DB="${USER_DB:-rp_gant_user}"
PROJECT_DB="${PROJECT_DB:-rp_gant_project}"
NOTIFICATION_DB="${NOTIFICATION_DB:-rp_gant_notification}"
AUDIT_DB="${AUDIT_DB:-rp_gant_audit}"
DB_ROOT="${DB_ROOT:-/db}"
PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-rp_gant}"
export PGPASSWORD="${PGPASSWORD:-rp_gant_dev}"

apply_migration() {
  database="$1"
  file="$2"
  echo "Applying $file to $database"
  sed '/-- Down Migration/,$d' "$file" | psql -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$PGUSER" -d "$database"
}

apply_seed() {
  database="$1"
  file="$2"
  echo "Seeding $file into $database"
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$PGUSER" -d "$database" -f "$file"
}

apply_migration "$USER_DB" "$DB_ROOT/migrations/user_access/0001_user_access.sql"
apply_migration "$USER_DB" "$DB_ROOT/migrations/user_access/0002_session_idle_expiration.sql"
apply_migration "$USER_DB" "$DB_ROOT/migrations/user_access/0003_auth_email_job_delivery.sql"
apply_seed "$USER_DB" "$DB_ROOT/seeds/user_access/001_roles_permissions.sql"
apply_seed "$USER_DB" "$DB_ROOT/seeds/user_access/002_system_settings.sql"

apply_migration "$PROJECT_DB" "$DB_ROOT/migrations/project_diagram/0002_project_diagram.sql"
apply_migration "$PROJECT_DB" "$DB_ROOT/migrations/project_diagram/0005_task_status_postponed.sql"
apply_migration "$PROJECT_DB" "$DB_ROOT/migrations/project_diagram/0006_direction_to_task_dependency_forbidden.sql"
apply_migration "$PROJECT_DB" "$DB_ROOT/migrations/project_diagram/0007_task_estimated_hours.sql"
apply_migration "$NOTIFICATION_DB" "$DB_ROOT/migrations/notification/0003_notification.sql"
apply_migration "$NOTIFICATION_DB" "$DB_ROOT/migrations/notification/0004_auth_email_delivery_queue.sql"
apply_migration "$AUDIT_DB" "$DB_ROOT/migrations/audit/0004_audit.sql"
apply_seed "$AUDIT_DB" "$DB_ROOT/seeds/audit/003_audit_actions.sql"
