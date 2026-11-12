-- Up Migration

CREATE TABLE IF NOT EXISTS access.executor_projects (
  executor_id uuid NOT NULL REFERENCES access.executors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (executor_id, project_id)
);

CREATE INDEX IF NOT EXISTS ix_executor_projects_project
  ON access.executor_projects (project_id, executor_id);

-- project_id belongs to the separate project database, so the association is
-- cleaned up by the project lifecycle rather than by a cross-database FK.

-- Down Migration

DROP TABLE IF EXISTS access.executor_projects;
