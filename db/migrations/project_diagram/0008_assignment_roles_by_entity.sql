-- Up Migration

ALTER TABLE plan.assignments
  DROP CONSTRAINT IF EXISTS assignments_check,
  DROP CONSTRAINT IF EXISTS assignments_entity_role_assignee_check;

ALTER TABLE plan.assignments
  ADD CONSTRAINT assignments_entity_role_assignee_check
  CHECK (
    (entity_type = 'direction' AND role = 'responsible' AND assignee_type = 'user')
    OR
    (entity_type = 'task' AND role IN ('executor', 'co_executor') AND assignee_type IN ('user', 'executor'))
  );

-- Down Migration

ALTER TABLE plan.assignments
  DROP CONSTRAINT IF EXISTS assignments_entity_role_assignee_check;

ALTER TABLE plan.assignments
  ADD CONSTRAINT assignments_check
  CHECK (entity_type = 'task' OR role = 'responsible');
