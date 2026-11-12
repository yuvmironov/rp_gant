import { writeFile } from 'node:fs/promises';
import { createPool } from '../apps/project-service/src/db.js';
import { call, createUserClient } from '../apps/project-service/src/user-client.js';

const BATCH_SIZE = 200;
const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply && dryRun) throw new Error('choose_either_apply_or_dry_run');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : '';
const supportedArgs = new Set(['--apply', '--dry-run', '--report']);
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!supportedArgs.has(argument)) throw new Error(`unknown_argument:${argument}`);
  if (argument === '--report') {
    if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error('--report requires a file path');
    }
    index += 1;
  }
}

async function collectBatches(items, callback) {
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    await callback(items.slice(index, index + BATCH_SIZE));
  }
}

const db = createPool(process.env);
const userClient = createUserClient({
  address: process.env.USER_SERVICE_GRPC ?? 'localhost:50051',
});

try {
  const result = await db.query(
    `SELECT a.id, a.assignee_id, a.assignee_type, a.role, a.entity_type, a.entity_id,
            d.project_id
     FROM plan.assignments a
     LEFT JOIN plan.tasks t ON a.entity_type = 'task' AND t.id = a.entity_id
     LEFT JOIN plan.directions direction ON a.entity_type = 'direction' AND direction.id = a.entity_id
     JOIN project.diagrams d ON d.id = COALESCE(t.diagram_id, direction.diagram_id)
     WHERE (a.entity_type = 'task' AND a.role IN ('responsible', 'executor', 'co_executor'))
        OR (a.entity_type = 'direction' AND a.role = 'responsible')
     ORDER BY d.project_id, a.entity_type, a.entity_id, a.role, a.id`,
  );
  const rows = result.rows;
  const executorIds = [
    ...new Set(
      rows.filter((item) => item.assignee_type === 'executor').map((item) => item.assignee_id),
    ),
  ];
  const linkedUsers = new Map();
  await collectBatches(executorIds, async (ids) => {
    const response = await call(userClient, 'GetExecutorsByIds', { executor_ids: ids });
    for (const executor of response.items ?? []) {
      if (executor.linked_user_id) linkedUsers.set(executor.id, executor.linked_user_id);
    }
  });

  const candidatesByProject = new Map();
  for (const item of rows) {
    const userId =
      item.assignee_type === 'user' ? item.assignee_id : linkedUsers.get(item.assignee_id);
    if (!userId || (item.entity_type === 'task' && item.assignee_type === 'executor')) continue;
    const candidates = candidatesByProject.get(item.project_id) ?? new Set();
    candidates.add(userId);
    candidatesByProject.set(item.project_id, candidates);
  }

  const activeMembersByProject = new Map();
  for (const [projectId, users] of candidatesByProject) {
    const activeIds = new Set();
    await collectBatches([...users], async (userIds) => {
      const response = await call(userClient, 'GetActiveProjectMemberIds', {
        project_id: projectId,
        user_ids: userIds,
      });
      for (const userId of response.user_ids ?? []) activeIds.add(userId);
    });
    activeMembersByProject.set(projectId, activeIds);
  }

  const currentExecutors = new Map();
  for (const item of rows) {
    if (item.entity_type === 'task' && item.role === 'executor') {
      currentExecutors.set(item.entity_id, item);
    }
  }
  const responsibleByDirection = new Map();
  for (const item of rows) {
    if (item.entity_type === 'direction' && item.role === 'responsible') {
      const list = responsibleByDirection.get(item.entity_id) ?? [];
      list.push(item);
      responsibleByDirection.set(item.entity_id, list);
    }
  }

  const changes = [];
  const activeMember = (projectId, userId) =>
    Boolean(userId && activeMembersByProject.get(projectId)?.has(userId));
  const record = (item, action, reason, next = {}) => {
    changes.push({
      assignmentId: item.id,
      entityType: item.entity_type,
      entityId: item.entity_id,
      role: item.role,
      assigneeType: item.assignee_type,
      assigneeId: item.assignee_id,
      action,
      reason,
      ...next,
    });
  };

  for (const item of rows) {
    if (
      item.entity_type === 'task' &&
      ['executor', 'co_executor'].includes(item.role) &&
      item.assignee_type === 'user' &&
      !activeMember(item.project_id, item.assignee_id)
    ) {
      record(item, 'delete', 'user_not_active_project_member');
      continue;
    }
    if (item.entity_type === 'task' && item.role === 'responsible') {
      if (item.assignee_type === 'user' && !activeMember(item.project_id, item.assignee_id)) {
        record(item, 'delete', 'user_not_active_project_member');
        continue;
      }
      const existingExecutor = currentExecutors.get(item.entity_id);
      if (
        existingExecutor &&
        (existingExecutor.assignee_type === 'executor' ||
          activeMember(existingExecutor.project_id, existingExecutor.assignee_id))
      ) {
        record(item, 'delete', 'executor_conflict_current_executor_preserved', {
          preservedAssignmentId: existingExecutor.id,
        });
        continue;
      }
      if (item.assignee_type === 'executor') {
        record(item, 'update', 'legacy_catalog_executor_preserved', {
          nextRole: 'executor',
          nextAssigneeType: 'executor',
          nextAssigneeId: item.assignee_id,
        });
        continue;
      }
      if (activeMember(item.project_id, item.assignee_id)) {
        record(item, 'update', 'active_user_responsible_moved_to_executor', {
          nextRole: 'executor',
          nextAssigneeType: 'user',
          nextAssigneeId: item.assignee_id,
        });
      } else {
        record(item, 'delete', 'user_not_active_project_member');
      }
    }
  }

  for (const [directionId, directionAssignments] of responsibleByDirection) {
    const projectId = directionAssignments[0].project_id;
    const activeUser = directionAssignments.find(
      (item) => item.assignee_type === 'user' && activeMember(projectId, item.assignee_id),
    );
    const convertibleCatalog = directionAssignments.find((item) => {
      if (item.assignee_type !== 'executor') return false;
      return activeMember(projectId, linkedUsers.get(item.assignee_id));
    });
    const preferred = activeUser ?? convertibleCatalog;

    for (const item of directionAssignments) {
      if (item === preferred) {
        if (item.assignee_type === 'user') {
          record(item, 'keep', 'active_direction_responsible_user');
        } else {
          record(item, 'update', 'catalog_linked_to_active_project_member', {
            nextRole: 'responsible',
            nextAssigneeType: 'user',
            nextAssigneeId: linkedUsers.get(item.assignee_id),
          });
        }
      } else if (item.assignee_type === 'user' && !activeMember(projectId, item.assignee_id)) {
        record(item, 'delete', 'user_not_active_project_member');
      } else if (preferred) {
        record(item, 'delete', 'direction_responsible_conflict_preferred_assignment_preserved', {
          preservedAssignmentId: preferred.id,
        });
      } else {
        record(
          item,
          'delete',
          item.assignee_type === 'user'
            ? 'user_not_active_project_member'
            : 'catalog_not_linked_to_active_project_member',
        );
      }
    }
    void directionId;
  }

  const deletes = changes.filter((item) => item.action === 'delete');
  const updates = changes.filter((item) => item.action === 'update');
  let updated = 0;
  let deleted = 0;
  if (apply && changes.some((item) => item.action === 'update' || item.action === 'delete')) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const item of deletes) {
        const result = await client.query(
          `DELETE FROM plan.assignments
           WHERE id = $1 AND entity_type = $2 AND entity_id = $3 AND role = $4
             AND assignee_type = $5 AND assignee_id = $6
           RETURNING id`,
          [
            item.assignmentId,
            item.entityType,
            item.entityId,
            item.role,
            item.assigneeType,
            item.assigneeId,
          ],
        );
        if (result.rowCount !== 1)
          throw new Error(`assignment_changed_during_backfill:${item.assignmentId}`);
        deleted += 1;
      }
      for (const item of updates) {
        const result = await client.query(
          `UPDATE plan.assignments
           SET role = $7, assignee_type = $8, assignee_id = $9
           WHERE id = $1 AND entity_type = $2 AND entity_id = $3 AND role = $4
             AND assignee_type = $5 AND assignee_id = $6
           RETURNING id`,
          [
            item.assignmentId,
            item.entityType,
            item.entityId,
            item.role,
            item.assigneeType,
            item.assigneeId,
            item.nextRole,
            item.nextAssigneeType,
            item.nextAssigneeId,
          ],
        );
        if (result.rowCount !== 1)
          throw new Error(`assignment_changed_during_backfill:${item.assignmentId}`);
        updated += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const count = (predicate) => changes.filter(predicate).length;
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    scannedAssignments: rows.length,
    taskResponsible: {
      movedActiveUsersToExecutor: count(
        (item) => item.reason === 'active_user_responsible_moved_to_executor',
      ),
      retainedLegacyCatalogExecutors: count(
        (item) => item.reason === 'legacy_catalog_executor_preserved',
      ),
      removedInvalidUsers: count(
        (item) => item.reason === 'user_not_active_project_member' && item.entityType === 'task',
      ),
      removedConflicts: count(
        (item) => item.reason === 'executor_conflict_current_executor_preserved',
      ),
    },
    directionResponsible: {
      alreadyValidUsers: count((item) => item.reason === 'active_direction_responsible_user'),
      convertedCatalogAssignments: count(
        (item) => item.reason === 'catalog_linked_to_active_project_member',
      ),
      removedConflicts: count(
        (item) => item.reason === 'direction_responsible_conflict_preferred_assignment_preserved',
      ),
      removedUnresolved: count((item) =>
        ['user_not_active_project_member', 'catalog_not_linked_to_active_project_member'].includes(
          item.reason,
        ),
      ),
    },
    updated,
    deleted,
    unresolved: changes.filter((item) => item.action === 'delete'),
    changes,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);
  if (reportPath) await writeFile(reportPath, json, { encoding: 'utf8', flag: 'w' });
} finally {
  userClient.close();
  await db.end();
}
