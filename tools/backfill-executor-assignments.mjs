import { createPool } from '../apps/project-service/src/db.js';
import { call, createUserClient } from '../apps/project-service/src/user-client.js';

const BATCH_SIZE = 200;
const apply = process.argv.includes('--apply');

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
    `SELECT a.id, a.assignee_id AS executor_id, a.role, a.entity_type, a.entity_id,
            d.project_id
     FROM plan.assignments a
     LEFT JOIN plan.tasks t ON a.entity_type = 'task' AND t.id = a.entity_id
     LEFT JOIN plan.directions direction ON a.entity_type = 'direction' AND direction.id = a.entity_id
     JOIN project.diagrams d ON d.id = COALESCE(t.diagram_id, direction.diagram_id)
     WHERE a.assignee_type = 'executor'
     ORDER BY d.project_id, a.id`,
  );
  const assignments = result.rows;
  const executorIds = [...new Set(assignments.map((item) => item.executor_id))];
  const linkedUsers = new Map();
  await collectBatches(executorIds, async (ids) => {
    const response = await call(userClient, 'GetExecutorsByIds', { executor_ids: ids });
    for (const executor of response.items ?? []) {
      if (executor.linked_user_id) linkedUsers.set(executor.id, executor.linked_user_id);
    }
  });

  const candidatesByProject = new Map();
  for (const assignment of assignments) {
    const userId = linkedUsers.get(assignment.executor_id);
    if (!userId) continue;
    const candidates = candidatesByProject.get(assignment.project_id) ?? new Set();
    candidates.add(userId);
    candidatesByProject.set(assignment.project_id, candidates);
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

  const eligible = assignments.filter((item) => {
    const userId = linkedUsers.get(item.executor_id);
    return userId && activeMembersByProject.get(item.project_id)?.has(userId);
  });

  let updated = 0;
  let conflicts = 0;
  if (apply) {
    for (const item of eligible) {
      const userId = linkedUsers.get(item.executor_id);
      try {
        const update = await db.query(
          `UPDATE plan.assignments
           SET assignee_type = 'user', assignee_id = $2
           WHERE id = $1 AND assignee_type = 'executor'
           RETURNING id`,
          [item.id, userId],
        );
        updated += update.rowCount;
      } catch (error) {
        if (error.code !== '23505') throw error;
        conflicts += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        executorAssignments: assignments.length,
        convertibleAssignments: eligible.length,
        unresolvedLegacyAssignments: assignments.length - eligible.length,
        updated,
        conflicts,
      },
      null,
      2,
    ),
  );
} finally {
  userClient.close();
  await db.end();
}
