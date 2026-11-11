export async function getActorRoles(db, actorUserId, projectId = '') {
  const userId = String(actorUserId ?? '');
  if (!userId) return [];

  const result = await db.query(
    `SELECT role_code
     FROM access.user_roles
     WHERE user_id = $1
     UNION
     SELECT role_code
     FROM access.project_memberships
     WHERE user_id = $1 AND project_id = NULLIF($2, '')::uuid AND status = 'active'
     ORDER BY role_code`,
    [userId, String(projectId ?? '')],
  );
  return result.rows.map((row) => row.role_code);
}

function projectIdForEvent(event) {
  return String(event.projectId ?? (event.aggregateType === 'project' ? event.aggregateId : ''));
}

async function actorRolesForEvent(db, event) {
  if (Array.isArray(event.actorRoles)) return event.actorRoles;
  return getActorRoles(db, event.actorUserId, projectIdForEvent(event));
}

export async function queueUserEvent(db, event) {
  const actorRoles = await actorRolesForEvent(db, event);
  await db.query(
    `INSERT INTO events.outbox_events
       (aggregate_type, aggregate_id, event_type, payload, headers)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload ?? {}),
      JSON.stringify({
        actor_user_id: event.actorUserId ?? '',
        actor_roles: actorRoles,
        project_id: projectIdForEvent(event),
        diagram_id: event.diagramId ?? '',
        entity_type: event.entityType ?? '',
        entity_id: event.entityId ?? '',
      }),
    ],
  );
}
