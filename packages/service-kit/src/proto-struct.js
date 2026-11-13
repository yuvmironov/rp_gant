const VALUE_KINDS = [
  'nullValue',
  'numberValue',
  'stringValue',
  'boolValue',
  'structValue',
  'listValue',
];

export function toProtoStruct(value) {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  return {
    fields: Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, toProtoValue(item)]),
    ),
  };
}

export function fromProtoStruct(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !value.fields ||
    typeof value.fields !== 'object'
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value.fields).map(([key, item]) => [key, fromProtoValue(item)]),
  );
}

function toProtoValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'number') return { numberValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(toProtoValue) } };
  if (typeof value === 'object') return { structValue: toProtoStruct(value) };
  return { nullValue: 'NULL_VALUE' };
}

function fromProtoValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const kind = value.kind ?? VALUE_KINDS.find((field) => Object.hasOwn(value, field));
  switch (kind) {
    case 'nullValue':
      return null;
    case 'numberValue':
      return value.numberValue;
    case 'stringValue':
      return value.stringValue;
    case 'boolValue':
      return value.boolValue;
    case 'structValue':
      return fromProtoStruct(value.structValue);
    case 'listValue':
      return (value.listValue?.values ?? []).map(fromProtoValue);
    default:
      return value;
  }
}
