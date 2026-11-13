import { credentials } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';
import { loadUserService, startUserGrpcServer } from '../src/grpc.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('user-service gRPC contract', () => {
  it('loads all UserService methods from proto', () => {
    const service = loadUserService();
    expect(Object.keys(service.service)).toHaveLength(55);
    expect(service.service).toHaveProperty('LinkExecutorUser');
    expect(service.service).toHaveProperty('UnlinkExecutorUser');
  });

  it('starts a gRPC server and returns UNIMPLEMENTED for stubs', async () => {
    const server = await startUserGrpcServer({ host: '127.0.0.1', port: 0 });
    servers.push(server);

    const client = new server.service(`127.0.0.1:${server.port}`, credentials.createInsecure());

    const error = await new Promise((resolve) => {
      client.GetRoles({}, (grpcError) => resolve(grpcError));
    });

    expect(error.code).toBe(12);

    const legacyError = await new Promise((resolve) => {
      client.LinkExecutorUser({}, (grpcError) => resolve(grpcError));
    });
    expect(legacyError.code).toBe(12);
    client.close();
  });

  it('serves the standard gRPC health check', async () => {
    const server = await startUserGrpcServer({ host: '127.0.0.1', port: 0 });
    servers.push(server);

    const client = new server.healthService(
      `127.0.0.1:${server.port}`,
      credentials.createInsecure(),
    );
    const response = await new Promise((resolve, reject) => {
      client.Check({ service: '' }, (error, health) => {
        if (error) reject(error);
        else resolve(health);
      });
    });

    expect(response.status).toBe('SERVING');
    client.close();
  });
});
