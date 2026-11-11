import { fileURLToPath } from 'node:url';
import {
  credentials,
  loadPackageDefinition,
  Metadata,
  Server,
  ServerCredentials,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';

const healthProtoPath = fileURLToPath(
  new URL('../proto/grpc/health/v1/health.proto', import.meta.url),
);

function getNested(root, path) {
  return path.split('.').reduce((value, key) => value?.[key], root);
}

export function loadGrpcService({
  protoPath,
  includeDirs = [],
  packageName,
  serviceName,
  json = false,
}) {
  const definition = loadSync(protoPath, {
    includeDirs,
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
    json,
  });
  const packageDefinition = loadPackageDefinition(definition);
  const service = getNested(packageDefinition, packageName)?.[serviceName];

  if (!service?.service) {
    throw new Error(`grpc_service_not_found:${packageName}.${serviceName}`);
  }

  return service;
}

export function createMetadata(values = {}) {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) metadata.set(key, String(value));
  }
  return metadata;
}

export function createGrpcClient({
  protoPath,
  includeDirs = [],
  packageName,
  serviceName,
  address,
  json = false,
}) {
  const service = loadGrpcService({
    protoPath,
    includeDirs,
    packageName,
    serviceName,
    json,
  });

  return new service(address, credentials.createInsecure());
}

export function createUnimplementedImplementation(service) {
  return Object.fromEntries(
    Object.keys(service).map((method) => [
      method,
      (_call, callback) => {
        callback({
          code: status.UNIMPLEMENTED,
          message: `${method} is not implemented`,
        });
      },
    ]),
  );
}

export async function startGrpcServer({
  protoPath,
  includeDirs = [],
  packageName,
  serviceName,
  implementation,
  host = '0.0.0.0',
  port = 50051,
  json = false,
}) {
  const service = loadGrpcService({
    protoPath,
    includeDirs,
    packageName,
    serviceName,
    json,
  });
  const healthService = loadGrpcService({
    protoPath: healthProtoPath,
    packageName: 'grpc.health.v1',
    serviceName: 'Health',
  });
  const server = new Server();

  server.addService(healthService.service, {
    Check: (_call, callback) => callback(null, { status: 'SERVING' }),
  });

  server.addService(
    service.service,
    implementation ?? createUnimplementedImplementation(service.service),
  );

  const boundPort = await new Promise((resolve, reject) => {
    server.bindAsync(
      `${host}:${port}`,
      ServerCredentials.createInsecure(),
      (error, assignedPort) => {
        if (error) reject(error);
        else resolve(assignedPort);
      },
    );
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) => {
      server.tryShutdown((error) => (error ? reject(error) : resolve()));
    });
  };

  return { server, service, healthService, port: boundPort, close };
}
