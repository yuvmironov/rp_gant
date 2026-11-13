import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGrpcService } from '../src/grpc.js';
import { fromProtoStruct, toProtoStruct } from '../src/proto-struct.js';

const protoRoot = fileURLToPath(new URL('../../../proto', import.meta.url));
const userService = loadGrpcService({
  protoPath: `${protoRoot}/rpgant/user/v1/user_service.proto`,
  includeDirs: [protoRoot],
  packageName: 'rpgant.user.v1',
  serviceName: 'UserService',
});

const values = {
  value: 8,
  enabled: false,
  description: 'policy',
  nested: { limit: 3 },
  list: [1, 'two', true],
  nullable: null,
};

describe('google.protobuf.Struct adapter', () => {
  it('preserves scalar and nested JSON values through the real gRPC wire format', () => {
    const method = userService.service.UpdateSystemSettings;
    const bytes = method.requestSerialize({
      items: [{ key: 'test', value: toProtoStruct(values) }],
    });
    const decoded = method.requestDeserialize(bytes).items[0].value;

    expect(fromProtoStruct(decoded)).toEqual(values);
  });

  it('accepts plain JSON objects as well as decoded protobuf Struct values', () => {
    expect(fromProtoStruct({ value: 8 })).toEqual({ value: 8 });
    expect(fromProtoStruct(toProtoStruct({ value: 8 }))).toEqual({ value: 8 });
  });
});
