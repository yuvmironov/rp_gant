import { fileURLToPath } from 'node:url';
import {
  createUnimplementedImplementation,
  loadGrpcService,
  startGrpcServer,
} from '@rp-gant/service-kit';

const protoRoot = fileURLToPath(new URL('../../../proto', import.meta.url));

export function loadNotificationService() {
  return loadGrpcService({
    protoPath: `${protoRoot}/rpgant/notification/v1/notification_service.proto`,
    includeDirs: [protoRoot],
    packageName: 'rpgant.notification.v1',
    serviceName: 'NotificationService',
    json: true,
  });
}

export function createNotificationImplementation(authEmailImplementation = {}) {
  const service = loadNotificationService();
  return {
    ...createUnimplementedImplementation(service.service),
    ...authEmailImplementation,
  };
}

export function startNotificationGrpcServer({
  port = 50052,
  host = '0.0.0.0',
  implementation,
} = {}) {
  return startGrpcServer({
    protoPath: `${protoRoot}/rpgant/notification/v1/notification_service.proto`,
    includeDirs: [protoRoot],
    packageName: 'rpgant.notification.v1',
    serviceName: 'NotificationService',
    implementation,
    port,
    host,
    json: true,
  });
}
