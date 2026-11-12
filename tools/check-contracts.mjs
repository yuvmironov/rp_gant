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

check(paths.length === 75, `OpenAPI paths: expected 75, got ${paths.length}`);
check(operations === 97, `OpenAPI operations: expected 97, got ${operations}`);
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
check(Object.keys(openapi.components?.schemas ?? {}).length === 72, 'OpenAPI schemas: expected 72');

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
