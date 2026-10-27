const CURRENT_QUERY_SCHEMA = 'custodial.original-private-custody-current-query.v1';
const ORIGINAL_QUERY_SCHEMA = 'custodial.original-native-private-custody-query.v1';
const MAX_REQUEST_BYTES = 526336;
const MAX_ORIGINAL_QUERY_BYTES = 393216;
const CURRENT_QUERY_FIELDS = [
  'schema',
  'original_query_body_base64',
  'original_query_timestamp',
  'original_query_http_attestation',
  'original_query_unknown_record_sha256',
];
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CANONICAL_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'buffer').get;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'byteLength').get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'byteOffset').get;
const ARRAY_BUFFER_BYTE_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const TYPED_ARRAY_SET = TYPED_ARRAY_PROTOTYPE.set;

export const currentOriginalPrivateQueryReadWire = Object.freeze({
  schema: CURRENT_QUERY_SCHEMA,
  maxRequestBytes: MAX_REQUEST_BYTES,
  maxOriginalQueryBytes: MAX_ORIGINAL_QUERY_BYTES,
});

function invalid() {
  throw Object.assign(new TypeError('current original private query read wire invalid'), {
    code: 'native_private_custody_current_query_wire_invalid',
  });
}

function parseJsonWithoutDuplicateKeys(text) {
  let index = 0;
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index++;
  };
  const string = () => {
    if (text[index] !== '"') invalid();
    const start = index++;
    while (index < text.length) {
      const code = text.charCodeAt(index++);
      if (code === 0x22) {
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          invalid();
        }
      }
      if (code < 0x20) invalid();
      if (code === 0x5c) {
        if (index >= text.length) invalid();
        const escape = text[index++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index, index + 4))) invalid();
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escape)) invalid();
      }
    }
    invalid();
  };
  const value = (depth = 0) => {
    if (depth > 64) invalid();
    whitespace();
    const token = text[index];
    if (token === '"') return string();
    if (token === '{') {
      index++;
      whitespace();
      const object = Object.create(null);
      const keys = new Set();
      if (text[index] === '}') {
        index++;
        return object;
      }
      while (index < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) invalid();
        keys.add(key);
        whitespace();
        if (text[index++] !== ':') invalid();
        object[key] = value(depth + 1);
        whitespace();
        const separator = text[index++];
        if (separator === '}') return object;
        if (separator !== ',') invalid();
      }
      invalid();
    }
    if (token === '[') {
      index++;
      whitespace();
      const array = [];
      if (text[index] === ']') {
        index++;
        return array;
      }
      while (index < text.length) {
        array.push(value(depth + 1));
        whitespace();
        const separator = text[index++];
        if (separator === ']') return array;
        if (separator !== ',') invalid();
      }
      invalid();
    }
    const literal = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!literal) invalid();
    index += literal.length;
    return literal === 'true' ? true : literal === 'false' ? false : literal === 'null' ? null : Number(literal);
  };

  whitespace();
  const parsed = value();
  whitespace();
  if (index !== text.length) invalid();
  return parsed;
}

function decodeUtf8(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    invalid();
  }
  if (text.startsWith('\uFEFF')) invalid();
  return text;
}

function requireCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !CANONICAL_UTC_MILLISECONDS.test(value)) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
}

function ownRequestBytes(rawBuffer) {
  if (!Buffer.isBuffer(rawBuffer) || Object.getPrototypeOf(rawBuffer) !== Buffer.prototype) invalid();
  let backingStore, byteLength, byteOffset, backingLength;
  try {
    backingStore = Reflect.apply(TYPED_ARRAY_BUFFER, rawBuffer, []);
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, rawBuffer, []);
    byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET, rawBuffer, []);
    // This intrinsic rejects SharedArrayBuffer, including another realm's
    // backing store, without reading any shadowable caller properties.
    backingLength = Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH, backingStore, []);
  } catch {
    invalid();
  }
  if (!Number.isSafeInteger(byteLength) || byteLength === 0 || byteLength > MAX_REQUEST_BYTES
    || !Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset + byteLength > backingLength) invalid();
  const owned = Buffer.allocUnsafe(byteLength);
  try {
    Reflect.apply(TYPED_ARRAY_SET, owned, [new Uint8Array(backingStore, byteOffset, byteLength)]);
  } catch {
    owned.fill(0);
    invalid();
  }
  return owned;
}

export function decodeCurrentOriginalPrivateQueryRead(rawBuffer) {
  const requestBytes = ownRequestBytes(rawBuffer);
  let envelope;
  try {
    envelope = parseJsonWithoutDuplicateKeys(decodeUtf8(requestBytes));
  } finally {
    requestBytes.fill(0);
  }
  if (!envelope || Object.getPrototypeOf(envelope) !== null
    || Object.keys(envelope).length !== CURRENT_QUERY_FIELDS.length
    || CURRENT_QUERY_FIELDS.some((field) => !Object.hasOwn(envelope, field))) invalid();
  if (CURRENT_QUERY_FIELDS.some((field) => typeof envelope[field] !== 'string')) invalid();
  if (envelope.schema !== CURRENT_QUERY_SCHEMA) invalid();
  if (!BASE64.test(envelope.original_query_body_base64)) invalid();

  const originalBytes = Buffer.from(envelope.original_query_body_base64, 'base64');
  try {
    if (!originalBytes.length || originalBytes.length > MAX_ORIGINAL_QUERY_BYTES
      || originalBytes.toString('base64') !== envelope.original_query_body_base64) invalid();
    const originalQuery = parseJsonWithoutDuplicateKeys(decodeUtf8(originalBytes));
    if (!originalQuery || Object.getPrototypeOf(originalQuery) !== null
      || originalQuery.schema !== ORIGINAL_QUERY_SCHEMA) invalid();
  } finally {
    originalBytes.fill(0);
  }

  requireCanonicalTimestamp(envelope.original_query_timestamp);
  if (!SHA256.test(envelope.original_query_http_attestation)
    || !SHA256.test(envelope.original_query_unknown_record_sha256)) invalid();

  return Object.freeze({
    schema: envelope.schema,
    original_query_body_base64: envelope.original_query_body_base64,
    original_query_timestamp: envelope.original_query_timestamp,
    original_query_http_attestation: envelope.original_query_http_attestation,
    original_query_unknown_record_sha256: envelope.original_query_unknown_record_sha256,
  });
}
