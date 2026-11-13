-- User & Access DB seed: roles, permissions, role permissions

INSERT INTO access.roles (code, scope, name, description) VALUES
  ('app_admin', 'app', 'Администратор приложения', 'Управление пользователями и настройками приложения'),
  ('project_owner', 'project', 'Владелец проекта', 'Создание, архивирование, восстановление, удаление проекта'),
  ('project_manager', 'project', 'Руководитель проекта', 'Полное редактирование плана, задач и зависимостей'),
  ('project_editor', 'project', 'Редактор', 'Редактирование задач, сроков, статусов и комментариев'),
  ('project_participant', 'project', 'Участник', 'Обновление назначенных задач и комментариев'),
  ('project_viewer', 'project', 'Наблюдатель', 'Просмотр плана и отчетов')
ON CONFLICT (code) DO UPDATE SET
  scope = EXCLUDED.scope,
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO access.permissions (code, scope, description) VALUES
  ('project.create', 'project', 'Создание проекта'),
  ('project.view', 'project', 'Просмотр проекта'),
  ('project.update', 'project', 'Изменение проекта'),
  ('project.settings.manage', 'project', 'Управление настройками проекта'),
  ('project.members.manage', 'project', 'Управление участниками проекта'),
  ('project.archive', 'project', 'Архивирование проекта'),
  ('project.restore', 'project', 'Восстановление проекта'),
  ('project.delete', 'project', 'Удаление проекта'),
  ('project.owner.transfer', 'project', 'Передача владения проектом'),
  ('project.audit.view', 'project', 'Просмотр аудита проекта'),
  ('project.task.create', 'project', 'Создание задач'),
  ('project.task.edit', 'project', 'Редактирование задач'),
  ('project.task.edit.assigned', 'project', 'Редактирование назначенных задач'),
  ('project.task.delete', 'project', 'Удаление задач'),
  ('diagram.create', 'project', 'Создание диаграммы'),
  ('diagram.update', 'project', 'Изменение диаграммы'),
  ('diagram.delete', 'project', 'Удаление диаграммы'),
  ('project.dependency.manage', 'project', 'Управление зависимостями'),
  ('project.comment.create', 'project', 'Создание комментариев'),
  ('project.comment.moderate', 'project', 'Модерация комментариев'),
  ('project.import', 'project', 'Импорт плана'),
  ('project.export', 'project', 'Экспорт плана'),
  ('app.users.manage', 'app', 'Управление пользователями'),
  ('app.settings.manage', 'app', 'Управление системными настройками')
ON CONFLICT (code) DO UPDATE SET
  scope = EXCLUDED.scope,
  description = EXCLUDED.description;

INSERT INTO access.role_permissions (role_code, permission_code)
SELECT 'app_admin', code FROM access.permissions
ON CONFLICT DO NOTHING;

INSERT INTO access.role_permissions (role_code, permission_code) VALUES
  ('project_owner', 'project.view'),
  ('project_owner', 'project.update'),
  ('project_owner', 'project.settings.manage'),
  ('project_owner', 'project.members.manage'),
  ('project_owner', 'project.archive'),
  ('project_owner', 'project.restore'),
  ('project_owner', 'project.delete'),
  ('project_owner', 'project.owner.transfer'),
  ('project_owner', 'project.audit.view'),
  ('project_owner', 'diagram.create'),
  ('project_owner', 'diagram.update'),
  ('project_owner', 'diagram.delete'),
  ('project_owner', 'project.task.create'),
  ('project_owner', 'project.task.edit'),
  ('project_owner', 'project.task.delete'),
  ('project_owner', 'project.dependency.manage'),
  ('project_owner', 'project.comment.create'),
  ('project_owner', 'project.comment.moderate'),
  ('project_owner', 'project.import'),
  ('project_owner', 'project.export'),
  ('project_manager', 'project.view'),
  ('project_manager', 'diagram.create'),
  ('project_manager', 'diagram.update'),
  ('project_manager', 'diagram.delete'),
  ('project_manager', 'project.task.create'),
  ('project_manager', 'project.task.edit'),
  ('project_manager', 'project.task.delete'),
  ('project_manager', 'project.dependency.manage'),
  ('project_manager', 'project.comment.create'),
  ('project_manager', 'project.comment.moderate'),
  ('project_manager', 'project.import'),
  ('project_manager', 'project.export'),
  ('project_editor', 'project.view'),
  ('project_editor', 'diagram.create'),
  ('project_editor', 'diagram.update'),
  ('project_editor', 'project.task.create'),
  ('project_editor', 'project.task.edit'),
  ('project_editor', 'project.dependency.manage'),
  ('project_editor', 'project.comment.create'),
  ('project_editor', 'project.export'),
  ('project_participant', 'project.view'),
  ('project_participant', 'project.task.edit.assigned'),
  ('project_participant', 'project.comment.create'),
  ('project_viewer', 'project.view'),
  ('project_viewer', 'project.export')
ON CONFLICT DO NOTHING;

