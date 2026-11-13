import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function countFiles(directory, extension) {
  return readdirSync(join(root, directory), { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(extension),
  ).length;
}

const openapi = readJson('openapi/openapi.json');
const paths = Object.keys(openapi.paths ?? {});
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const operations = paths.reduce(
  (total, path) =>
    total + Object.keys(openapi.paths[path]).filter((key) => methods.has(key)).length,
  0,
);
const operationIds = paths.flatMap((path) =>
  Object.entries(openapi.paths[path])
    .filter(([method]) => methods.has(method))
    .map(([, operation]) => operation.operationId)
    .filter(Boolean),
);
const operationIdSet = new Set(operationIds);
const mappingPath = join(root, 'contracts/rest-grpc-map.yaml');
const hasMapping = existsSync(mappingPath);
check(hasMapping, 'REST/gRPC mapping is missing');
const mappingSource = hasMapping ? readFileSync(mappingPath, 'utf8') : '';
const mappedOperationIds = [...mappingSource.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):\s*\{/gm)].map(
  ([, operationId]) => operationId,
);
const mappedOperationIdSet = new Set(mappedOperationIds);
const mappingExceptions = new Map([
  ['getSyncToken', 'The API Gateway signs a token after validating the user session.'],
  ['health', 'The health endpoint is owned by the API Gateway.'],
]);
const mappingExceptionIds = new Set(mappingExceptions.keys());
const missingMapping = operationIds.filter(
  (operationId) => !mappedOperationIdSet.has(operationId) && !mappingExceptionIds.has(operationId),
);
const staleMapping = mappedOperationIds.filter((operationId) => !operationIdSet.has(operationId));

check(paths.length === 76, `OpenAPI paths: expected 76, got ${paths.length}`);
check(operations === 98, `OpenAPI operations: expected 98, got ${operations}`);
check(operationIds.length === operations, 'Every OpenAPI operation must have an operationId');
check(
  operationIdSet.size === operationIds.length,
  'OpenAPI operationIds must be unique for REST/gRPC mapping',
);
check(
  mappedOperationIdSet.size === mappedOperationIds.length,
  'REST/gRPC mapping contains duplicate operationIds',
);
check(
  mappingExceptionIds.size === 2 &&
    [...mappingExceptionIds].every((operationId) => operationIdSet.has(operationId)),
  'REST/gRPC mapping exceptions must list existing gateway-managed operations',
);
check(
  [...mappingExceptionIds].every((operationId) => !mappedOperationIdSet.has(operationId)),
  'Gateway-managed REST/gRPC mapping exceptions must not be mapped',
);
check(
  missingMapping.length === 0,
  `REST/gRPC mapping misses operations: ${missingMapping.join(', ')}`,
);
check(
  staleMapping.length === 0,
  `REST/gRPC mapping has unknown operations: ${staleMapping.join(', ')}`,
);
check(Object.keys(openapi.components?.schemas ?? {}).length === 76, 'OpenAPI schemas: expected 76');
const taskAssignmentInput =
  openapi.paths?.['/tasks/{taskId}/assignments']?.put?.requestBody?.content?.['application/json']
    ?.schema?.properties?.assignments;
check(taskAssignmentInput?.maxItems === 3, 'Task assignments must allow at most three entries');
check(
  taskAssignmentInput?.items?.$ref === '#/components/schemas/TaskAssignmentInput',
  'Task assignments must use their task-specific input schema',
);
check(
  openapi.components?.schemas?.TaskAssignmentInput?.properties?.role?.enum?.join(',') ===
    'executor,co_executor' &&
    openapi.components?.schemas?.TaskAssignmentInput?.properties?.assigneeType?.enum?.join(',') ===
      'user',
  'Task assignments must only support executor/co_executor roles assigned to users',
);
check(
  openapi.paths?.['/directions/{directionId}/responsible']?.put?.requestBody?.content?.[
    'application/json'
  ]?.schema?.properties?.assignment?.$ref === '#/components/schemas/DirectionResponsibleInput' &&
    openapi.components?.schemas?.DirectionResponsibleInput?.properties?.assigneeType?.enum?.join(
      ',',
    ) === 'user',
  'Direction responsible input must only support user assignees',
);
check(
  openapi.components?.schemas?.Direction?.properties?.assignments?.maxItems === 1 &&
    openapi.components?.schemas?.Direction?.properties?.assignments?.items?.$ref ===
      '#/components/schemas/Assignment' &&
    openapi.components?.schemas?.Assignment?.properties?.role?.enum?.join(',') === 'responsible',
  'Direction responses must only contain responsible assignments',
);
check(
  openapi.components?.schemas?.Task?.properties?.assignments?.maxItems === 3 &&
    openapi.components?.schemas?.Task?.properties?.assignments?.items?.$ref ===
      '#/components/schemas/TaskAssignment' &&
    openapi.components?.schemas?.TaskAssignment?.properties?.role?.enum?.join(',') ===
      'executor,co_executor',
  'Task responses must only contain executor/co_executor assignments',
);
const importExportSchema = readJson('contracts/import-export/project-export.v2.schema.json');
check(
  importExportSchema.$defs?.direction?.properties?.assignments?.items?.$ref ===
    '#/$defs/directionAssignment' &&
    importExportSchema.$defs?.directionAssignment?.properties?.role?.const === 'responsible' &&
    importExportSchema.$defs?.directionAssignment?.properties?.assigneeType?.const === 'user',
  'Export directions must only contain responsible user assignments',
);
check(
  importExportSchema.$defs?.task?.properties?.assignments?.items?.$ref ===
    '#/$defs/taskAssignment' &&
    importExportSchema.$defs?.taskAssignment?.properties?.role?.enum?.join(',') ===
      'executor,co_executor',
  'Export tasks must only contain executor/co_executor assignments',
);

const eventTypes = readJson('events/event-types.json');
check(eventTypes.events?.length === 68, 'Event types: expected 68');
check(
  eventTypes.events?.every((event) => ['implemented', 'planned'].includes(event.status)),
  'Every event must have implemented/planned status',
);

const payloads = readJson('events/schemas/payloads.schema.json');
check(Object.keys(payloads.$defs ?? {}).length === 79, 'Event payload definitions: expected 79');

const protoFiles = readdirSync(join(root, 'proto'), { recursive: true }).filter((file) =>
  String(file).endsWith('.proto'),
);
check(protoFiles.length === 6, 'Proto files: expected 6');

check(
  countFiles('notifications/templates', '.html') === 17,
  'HTML notification templates: expected 17',
);
check(
  countFiles('notifications/templates', '.txt') === 17,
  'Text notification templates: expected 17',
);
const dbInit = readFileSync(join(root, 'infrastructure/local/db-init.sh'), 'utf8');
check(
  dbInit.includes('0008_assignment_roles_by_entity.sql'),
  'The project assignment constraint migration must be applied during DB bootstrap',
);

check(existsSync(join(root, 'openapi/openapi.yaml')), 'openapi.yaml is missing');
check(
  existsSync(join(root, 'notifications/templates/manifest.json')),
  'Template manifest is missing',
);

for (const migration of [
  'db/migrations/user_access',
  'db/migrations/project_diagram',
  'db/migrations/notification',
  'db/migrations/audit',
]) {
  check(existsSync(join(root, migration)), `Migration directory is missing: ${migration}`);
}

if (failures.length > 0) {
  console.error('Contract checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Contract checks passed: ${paths.length} paths, ${operations} operations, ` +
      `${mappedOperationIds.length} REST/gRPC mappings, ${mappingExceptionIds.size} explicit exclusions, ` +
      `${eventTypes.events.length} events, ${protoFiles.length} protos.`,
  );
}
