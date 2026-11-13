-- Up Migration

DELETE FROM access.role_permissions
WHERE permission_code IN ('executor.manage', 'executor.link');
DELETE FROM access.permissions
WHERE code IN ('executor.manage', 'executor.link');

DROP TABLE IF EXISTS access.executor_projects;
DROP TABLE IF EXISTS access.executors;

-- Down Migration
-- Catalog records have been removed and cannot be reconstructed.
DO $$ BEGIN RAISE EXCEPTION '0005_remove_executor_catalog is forward-only'; END $$;
