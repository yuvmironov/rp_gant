import { fileURLToPath } from 'node:url';
import { createGrpcClient } from '@rp-gant/service-kit';

const protoRoot = fileURLToPath(new URL('../../../proto', import.meta.url));

export function createNotificationClient({
  address = process.env.NOTIFICATION_SERVICE_GRPC ?? 'localhost:50052',
} = {}) {
  return createGrpcClient({
    protoPath: `${protoRoot}/rpgant/notification/v1/notification_service.proto`,
    includeDirs: [protoRoot],
    packageName: 'rpgant.notification.v1',
    serviceName: 'NotificationService',
    address,
    json: true,
  });
}

export function toNotificationStruct(value = {}) {
  return {
    fields: Object.fromEntries(
      Object.entries(value).map(([key, fieldValue]) => [
        key,
        { kind: 'stringValue', stringValue: String(fieldValue) },
      ]),
    ),
  };
}

export function callNotification(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (error, response) => (error ? reject(error) : resolve(response)));
  });
}
