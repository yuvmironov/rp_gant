-- Up Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plan.assignments WHERE assignee_type = 'executor') THEN
    RAISE EXCEPTION 'executor assignments remain; migrate or remove them before dropping the executor catalog';
  END IF;
END $$;

ALTER TABLE plan.assignments
  DROP CONSTRAINT IF EXISTS assignments_entity_role_assignee_check;

ALTER TABLE plan.assignments
  ADD CONSTRAINT assignments_entity_role_assignee_check
  CHECK (
    (entity_type = 'direction' AND role = 'responsible' AND assignee_type = 'user')
    OR
    (entity_type = 'task' AND role IN ('executor', 'co_executor') AND assignee_type = 'user')
  );

-- Down Migration
-- This migration is intentionally forward-only: catalog assignments are not recoverable.
DO $$ BEGIN RAISE EXCEPTION '0009_user_only_task_assignments is forward-only'; END $$;
