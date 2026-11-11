const PROJECT_ROLE_CODES = {
  PROJECT_ROLE_OWNER: 'project_owner',
  PROJECT_ROLE_MANAGER: 'project_manager',
  PROJECT_ROLE_EDITOR: 'project_editor',
  PROJECT_ROLE_PARTICIPANT: 'project_participant',
  PROJECT_ROLE_VIEWER: 'project_viewer',
  PROJECT_ROLE_UNSPECIFIED: 'app_admin',
};

export function actorRolesFromPermissionRole(role) {
  const roleCode = PROJECT_ROLE_CODES[role];
  return roleCode ? [roleCode] : [];
}

export async function queueEvent(db, event) {
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
        actor_roles: event.actorRoles ?? [],
        project_id: event.projectId ?? '',
        diagram_id: event.diagramId ?? '',
        entity_type: event.entityType ?? '',
        entity_id: event.entityId ?? '',
      }),
    ],
  );
}
