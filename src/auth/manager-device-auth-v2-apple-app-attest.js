import crypto from "node:crypto";

export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export const APPLE_APP_ATTEST_ROOT_DER_SHA256 = "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932";

const APP_ATTEST_NONCE_OID_DER = Buffer.from("06092a864886f763640802", "hex");
const KEY_USAGE_OID_DER = Buffer.from("0603551d0f", "hex");
const EXTENDED_KEY_USAGE_OID_DER = Buffer.from("0603551d25", "hex");
const APP_ATTEST_EXTENDED_KEY_USAGE_DER = Buffer.from("06092a864886f763640418", "hex");
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop", "ascii");
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest", "ascii"), Buffer.alloc(7)]);
const EXT_VALIDATION_CATEGORY = "apple_validation_category_01";
const EXT_BUNDLE_VERSION = "apple_bundle_version_01";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function failure(code, status = 401) {
  return Object.assign(new Error(code), { code, status });
}

function decodeCanonicalBase64(value, field, maximum = 65_536) {
  const raw = String(value || "");
  if (!raw || raw.length > maximum) throw failure(`manager_v2_invalid_${field}`);
  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.length && bytes.toString("base64url") === raw) return { bytes, encoded: raw };
  }
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length && bytes.toString("base64") === raw) return { bytes, encoded: bytes.toString("base64url") };
  }
  throw failure(`manager_v2_invalid_${field}`);
}

function integerLength(buffer, offset, additional) {
  if (additional < 24) return { value: additional, offset };
  const byteLength = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;
  if (!byteLength || offset + byteLength > buffer.length) throw failure("manager_v2_attestation_invalid");
  let value = 0n;
  for (let index = 0; index < byteLength; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw failure("manager_v2_attestation_invalid");
  const numeric = Number(value);
  if ((additional === 24 && numeric < 24) || (additional === 25 && numeric <= 0xff)
      || (additional === 26 && numeric <= 0xffff) || (additional === 27 && numeric <= 0xffffffff)) {
    throw failure("manager_v2_attestation_invalid");
  }
  return { value: numeric, offset: offset + byteLength };
}

function decodeCborItem(buffer, start = 0, depth = 0) {
  if (!Buffer.isBuffer(buffer) || start >= buffer.length || depth > 12) throw failure("manager_v2_attestation_invalid");
  const initial = buffer[start];
  const major = initial >> 5;
  const additional = initial & 31;
  if (additional === 31) throw failure("manager_v2_attestation_invalid");
  const length = integerLength(buffer, start + 1, additional);
  let offset = length.offset;
  if (major === 0) return { value: length.value, offset };
  if (major === 1) return { value: -1 - length.value, offset };
  if (major === 2 || major === 3) {
    if (offset + length.value > buffer.length) throw failure("manager_v2_attestation_invalid");
    const bytes = buffer.subarray(offset, offset + length.value);
    let value;
    try {
      value = major === 2 ? Buffer.from(bytes) : UTF8_DECODER.decode(bytes);
    } catch {
      throw failure("manager_v2_attestation_invalid");
    }
    return { value, offset: offset + length.value };
  }
  if (major === 4) {
    const result = [];
    for (let index = 0; index < length.value; index += 1) {
      const decoded = decodeCborItem(buffer, offset, depth + 1);
      result.push(decoded.value);
      offset = decoded.offset;
    }
    return { value: result, offset };
  }
  if (major === 5) {
    const result = new Map();
    for (let index = 0; index < length.value; index += 1) {
      const key = decodeCborItem(buffer, offset, depth + 1);
      const value = decodeCborItem(buffer, key.offset, depth + 1);
      if (result.has(key.value)) throw failure("manager_v2_attestation_invalid");
      result.set(key.value, value.value);
      offset = value.offset;
    }
    return { value: result, offset };
  }
  if (major === 6) throw failure("manager_v2_attestation_invalid");
  if (major === 7 && additional === 20) return { value: false, offset };
  if (major === 7 && additional === 21) return { value: true, offset };
  if (major === 7 && (additional === 22 || additional === 23)) return { value: null, offset };
  throw failure("manager_v2_attestation_invalid");
}

function decodeCompleteCbor(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > 65_536) throw failure("manager_v2_attestation_invalid");
  const decoded = decodeCborItem(buffer);
  if (decoded.offset !== buffer.length) throw failure("manager_v2_attestation_invalid");
  return decoded.value;
}

function parseAuthenticatorData(buffer, { attestation }) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 37) throw failure("manager_v2_attestation_invalid");
  const rpIdHash = Buffer.from(buffer.subarray(0, 32));
  const flags = buffer[32];
  const counter = buffer.readUInt32BE(33);
  let offset = 37;
  let aaguid = null;
  let credentialId = null;
  let credentialPublicKey = null;
  if (attestation) {
    if (offset + 18 > buffer.length) throw failure("manager_v2_attestation_invalid");
    aaguid = Buffer.from(buffer.subarray(offset, offset + 16));
    offset += 16;
    const credentialLength = buffer.readUInt16BE(offset);
    offset += 2;
    if (credentialLength !== 32 || offset + credentialLength > buffer.length) throw failure("manager_v2_attestation_invalid");
    credentialId = Buffer.from(buffer.subarray(offset, offset + credentialLength));
    offset += credentialLength;
    const cose = decodeCborItem(buffer, offset);
    if (!(cose.value instanceof Map)) throw failure("manager_v2_attestation_invalid");
    credentialPublicKey = cose.value;
    offset = cose.offset;
  }
  // App Attest uses its provider-specific layout rather than WebAuthn's ED
  // flag. Apple's current official fixture has flags 0x40 for attestation and
  // still appends a mandatory extensions map. Assertions are the simplified
  // layout with flags 0x00 and the same mandatory trailing map.
  const decoded = decodeCborItem(buffer, offset);
  if (!(decoded.value instanceof Map)) throw failure("manager_v2_attestation_invalid");
  const extensions = decoded.value;
  offset = decoded.offset;
  const expectedFlags = attestation ? 0x40 : 0x00;
  if (offset !== buffer.length || flags !== expectedFlags) {
    throw failure("manager_v2_attestation_invalid");
  }
  return { rpIdHash, flags, counter, aaguid, credentialId, credentialPublicKey, extensions };
}

function readDerLength(buffer, offset) {
  if (offset >= buffer.length) throw failure("manager_v2_attestation_invalid");
  const first = buffer[offset];
  if (first < 0x80) return { length: first, offset: offset + 1 };
  const count = first & 0x7f;
  if (count < 1 || count > 4 || offset + 1 + count > buffer.length) throw failure("manager_v2_attestation_invalid");
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | buffer[offset + 1 + index];
  if (length < 0x80) throw failure("manager_v2_attestation_invalid");
  return { length, offset: offset + 1 + count };
}

function readDerElement(buffer, offset) {
  if (offset >= buffer.length) throw failure("manager_v2_attestation_invalid");
  const tag = buffer[offset];
  const decodedLength = readDerLength(buffer, offset + 1);
  const end = decodedLength.offset + decodedLength.length;
  if (end > buffer.length) throw failure("manager_v2_attestation_invalid");
  return { tag, start: offset, contentStart: decodedLength.offset, end, content: buffer.subarray(decodedLength.offset, end) };
}

function extractCertificateExtension(certificateDer, oidDer) {
  const oidOffset = certificateDer.indexOf(oidDer);
  if (oidOffset < 0 || certificateDer.indexOf(oidDer, oidOffset + 1) >= 0) {
    throw failure("manager_v2_attestation_invalid");
  }
  let offset = oidOffset + oidDer.length;
  let next = readDerElement(certificateDer, offset);
  if (next.tag === 0x01) {
    offset = next.end;
    next = readDerElement(certificateDer, offset);
  }
  if (next.tag !== 0x04) throw failure("manager_v2_attestation_invalid");
  return Buffer.from(next.content);
}

function extractNonceExtension(certificateDer) {
  const extension = extractCertificateExtension(certificateDer, APP_ATTEST_NONCE_OID_DER);
  const values = [];
  function collect(buffer, depth = 0) {
    if (depth > 8) throw failure("manager_v2_attestation_invalid");
    let cursor = 0;
    while (cursor < buffer.length) {
      const element = readDerElement(buffer, cursor);
      if (element.tag === 0x04 && element.content.length === 32) values.push(Buffer.from(element.content));
      if ((element.tag & 0x20) !== 0 || (element.tag & 0xc0) === 0x80) collect(element.content, depth + 1);
      cursor = element.end;
    }
  }
  collect(extension);
  if (values.length !== 1) throw failure("manager_v2_attestation_invalid");
  return values[0];
}

function verifyCertificateKeyUsage(leaf, intermediate) {
  const leafUsage = extractCertificateExtension(leaf.raw, KEY_USAGE_OID_DER);
  const leafBits = readDerElement(leafUsage, 0);
  if (leafBits.tag !== 0x03 || leafBits.end !== leafUsage.length || leafBits.content.length < 2
      || (leafBits.content[1] & 0x80) === 0 || (leafBits.content[1] & 0x04) !== 0) {
    throw failure("manager_v2_attestation_invalid");
  }
  const intermediateUsage = extractCertificateExtension(intermediate.raw, KEY_USAGE_OID_DER);
  const intermediateBits = readDerElement(intermediateUsage, 0);
  if (intermediateBits.tag !== 0x03 || intermediateBits.end !== intermediateUsage.length || intermediateBits.content.length < 2
      || (intermediateBits.content[1] & 0x04) === 0) {
    throw failure("manager_v2_attestation_invalid");
  }
  const extendedUsage = extractCertificateExtension(leaf.raw, EXTENDED_KEY_USAGE_OID_DER);
  if (extendedUsage.indexOf(APP_ATTEST_EXTENDED_KEY_USAGE_DER) < 0) throw failure("manager_v2_attestation_invalid");
}

function constantEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function extensionValues(parsed, policy) {
  const categoryValue = parsed.extensions.get(EXT_VALIDATION_CATEGORY);
  const bundleVersion = parsed.extensions.get(EXT_BUNDLE_VERSION);
  const category = Buffer.isBuffer(categoryValue) && categoryValue.length === 4
    ? categoryValue.readUInt32LE(0)
    : (Number.isSafeInteger(categoryValue) ? categoryValue : -1);
  if (!policy.validationCategories.includes(category) || typeof bundleVersion !== "string" || !policy.bundleVersions.includes(bundleVersion)) {
    throw failure("manager_v2_attestation_policy_denied", 403);
  }
  return { category, bundleVersion };
}

function validateCertificateTime(certificate, now) {
  const value = Number(now);
  const from = Date.parse(certificate.validFrom);
  const to = Date.parse(certificate.validTo);
  if (!Number.isFinite(value) || value < from || value > to) throw failure("manager_v2_attestation_invalid");
}

export function createAppleAppAttestVerifier({
  now = () => Date.now(),
  rootPem = APPLE_APP_ATTEST_ROOT_PEM,
  env = process.env,
  testOnlyAttestationClientDataHash = null,
} = {}) {
  if (testOnlyAttestationClientDataHash !== null
      && (env.NODE_ENV !== "test" || typeof testOnlyAttestationClientDataHash !== "function")) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  const root = new crypto.X509Certificate(rootPem);
  if (crypto.createHash("sha256").update(root.raw).digest("hex") !== APPLE_APP_ATTEST_ROOT_DER_SHA256) {
    throw failure("manager_v2_attestation_unavailable", 503);
  }

  function verifyAttestation({ evidence, challenge, policy }) {
    const objectBytes = decodeCanonicalBase64(evidence?.attestation_object, "attestation_object").bytes;
    const object = decodeCompleteCbor(objectBytes);
    if (!(object instanceof Map) || object.size !== 3 || object.get("fmt") !== "apple-appattest") throw failure("manager_v2_attestation_invalid");
    const statement = object.get("attStmt");
    const authData = object.get("authData");
    if (!(statement instanceof Map) || !Buffer.isBuffer(authData)) throw failure("manager_v2_attestation_invalid");
    const x5c = statement.get("x5c");
    const receipt = statement.get("receipt");
    if (!Array.isArray(x5c) || x5c.length !== 2 || x5c.some((value) => !Buffer.isBuffer(value)) || !Buffer.isBuffer(receipt)) {
      throw failure("manager_v2_attestation_invalid");
    }
    const leaf = new crypto.X509Certificate(x5c[0]);
    const intermediate = new crypto.X509Certificate(x5c[1]);
    validateCertificateTime(leaf, now());
    validateCertificateTime(intermediate, now());
    validateCertificateTime(root, now());
    if (leaf.ca !== false || intermediate.ca !== true
        || !leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)
        || !intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
      throw failure("manager_v2_attestation_invalid");
    }
    verifyCertificateKeyUsage(leaf, intermediate);
    const clientDataHash = testOnlyAttestationClientDataHash === null
      ? crypto.createHash("sha256").update(challenge, "utf8").digest()
      : Buffer.from(testOnlyAttestationClientDataHash(challenge));
    if (clientDataHash.length < 1 || clientDataHash.length > 64) throw failure("manager_v2_attestation_invalid");
    const nonce = crypto.createHash("sha256").update(Buffer.concat([authData, clientDataHash])).digest();
    if (!constantEqual(extractNonceExtension(leaf.raw), nonce)) throw failure("manager_v2_attestation_invalid");
    const jwk = leaf.publicKey.export({ format: "jwk" });
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw failure("manager_v2_attestation_invalid");
    const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
    const keyIdentifierValue = decodeCanonicalBase64(evidence?.key_id, "app_attest_key_id", 64);
    const keyIdentifier = keyIdentifierValue.bytes;
    if (keyIdentifier.length !== 32) throw failure("manager_v2_invalid_app_attest_key_id");
    if (!constantEqual(crypto.createHash("sha256").update(point).digest(), keyIdentifier)) throw failure("manager_v2_attestation_invalid");
    const parsed = parseAuthenticatorData(authData, { attestation: true });
    if (!constantEqual(parsed.rpIdHash, crypto.createHash("sha256").update(policy.appId, "utf8").digest())
        || parsed.counter !== 0 || !constantEqual(parsed.credentialId, keyIdentifier)) {
      throw failure("manager_v2_attestation_invalid");
    }
    const expectedAaguid = policy.environment === "development" ? AAGUID_DEVELOPMENT : AAGUID_PRODUCTION;
    if (!constantEqual(parsed.aaguid, expectedAaguid)) throw failure("manager_v2_attestation_policy_denied", 403);
    const cose = parsed.credentialPublicKey;
    if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1
        || !constantEqual(cose.get(-2), Buffer.from(jwk.x, "base64url"))
        || !constantEqual(cose.get(-3), Buffer.from(jwk.y, "base64url"))) {
      throw failure("manager_v2_attestation_invalid");
    }
    const extensions = extensionValues(parsed, policy);
    return {
      verified: true,
      appId: policy.appId,
      environment: policy.environment,
      evidenceDigest: crypto.createHash("sha256").update(objectBytes).digest("hex"),
      keyId: keyIdentifierValue.encoded,
      publicKeySpki: leaf.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      receipt: receipt.toString("base64url"),
      assertionCounter: 0,
      validationCategory: extensions.category,
      bundleVersion: extensions.bundleVersion,
    };
  }

  function verifyAssertion({ evidence, challenge, policy, storedAttestation }) {
    const keyIdentifierValue = decodeCanonicalBase64(evidence?.key_id, "app_attest_key_id", 64);
    if (keyIdentifierValue.bytes.length !== 32 || !storedAttestation
        || storedAttestation.keyId !== keyIdentifierValue.encoded || !storedAttestation.publicKeySpki) {
      throw failure("manager_v2_attestation_invalid");
    }
    const assertionBytes = decodeCanonicalBase64(evidence?.assertion, "app_attest_assertion").bytes;
    const assertion = decodeCompleteCbor(assertionBytes);
    if (!(assertion instanceof Map) || assertion.size !== 2) throw failure("manager_v2_attestation_invalid");
    const signature = assertion.get("signature");
    const authData = assertion.get("authenticatorData");
    if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authData)) throw failure("manager_v2_attestation_invalid");
    const clientDataHash = crypto.createHash("sha256").update(challenge, "utf8").digest();
    if (!constantEqual(clientDataHash, decodeCanonicalBase64(evidence.client_data_hash, "client_data_hash", 64).bytes)) {
      throw failure("manager_v2_attestation_invalid");
    }
    const publicKey = crypto.createPublicKey({ key: Buffer.from(storedAttestation.publicKeySpki, "base64url"), format: "der", type: "spki" });
    if (!crypto.verify("sha256", Buffer.concat([authData, clientDataHash]), publicKey, signature)) {
      throw failure("manager_v2_attestation_invalid");
    }
    const parsed = parseAuthenticatorData(authData, { attestation: false });
    const previousCounter = Number(storedAttestation.assertionCounter);
    if (!constantEqual(parsed.rpIdHash, crypto.createHash("sha256").update(policy.appId, "utf8").digest())
        || !Number.isSafeInteger(previousCounter) || parsed.counter <= previousCounter) {
      throw failure("manager_v2_attestation_invalid");
    }
    const extensions = extensionValues(parsed, policy);
    return {
      verified: true,
      appId: policy.appId,
      environment: policy.environment,
      evidenceDigest: crypto.createHash("sha256").update(assertionBytes).digest("hex"),
      keyId: keyIdentifierValue.encoded,
      publicKeySpki: storedAttestation.publicKeySpki,
      receipt: storedAttestation.receipt || null,
      assertionCounter: parsed.counter,
      previousAssertionCounter: previousCounter,
      validationCategory: extensions.category,
      bundleVersion: extensions.bundleVersion,
    };
  }

  return Object.freeze({
    verify({ evidence, challenge, purpose, storedAttestation, policy }) {
      return purpose === "enroll"
        ? verifyAttestation({ evidence, challenge, policy })
        : verifyAssertion({ evidence, challenge, policy, storedAttestation });
    },
  });
}

export const appleAppAttestInternals = Object.freeze({ decodeCanonicalBase64, decodeCompleteCbor, parseAuthenticatorData, extractNonceExtension });
