import { createWriteStream } from 'node:fs';
import { chmod, link, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const exactSize = value => {
  const parsed = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

function strongEtag(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim(), unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return unquoted && /^[!#-~]+$/.test(unquoted) && !unquoted.startsWith('W/') ? unquoted : null;
}

export function requireOriginalStorageSize(object) {
  const lengths = ['size', 'contentLength'].filter(key => Object.hasOwn(object.metadata || {}, key))
    .map(key => exactSize(object.metadata[key]));
  if (!lengths.length || lengths[0] === null || lengths.some(size => size !== lengths[0]))
    throw Error('Original Storage object byte length is unavailable or conflicting.');
  return lengths[0];
}

export function requireOriginalStorageResponse(object, response) {
  if (response.status !== 200 || !response.body) throw Error('Storage object download did not return a complete response.');
  const originalSize = requireOriginalStorageSize(object);
  const headerLength = response.headers.get('content-length');
  if (headerLength !== null && exactSize(headerLength) !== originalSize)
    throw Error('Provider response length differs from the original Storage object.');
  const tags = ['eTag', 'etag'].filter(key => Object.hasOwn(object.metadata || {}, key))
    .map(key => strongEtag(object.metadata[key]));
  if (tags.length && (!tags[0] || tags.some(tag => tag !== tags[0]) || strongEtag(response.headers.get('etag')) !== tags[0]))
    throw Error('Provider response ETag differs from the original Storage object.');
  return originalSize;
}

export async function captureBackupStorageObject({ projectRef, object, secret, outputPath,
    fetchImpl = fetch, signal = AbortSignal.timeout(60_000) }) {
  const segments = String(object.name).split('/');
  if (segments.some(part => part === '.' || part === '..')) {
    throw Error('Storage object path cannot be encoded unambiguously.');
  }
  const path = [object.bucket_id, ...segments].map(encodeURIComponent).join('/');
  const response = await fetchImpl(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${path}`, {
    redirect: 'error', signal, headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  let stagingDirectory;
  try {
    const expected = requireOriginalStorageResponse(object, response);
    stagingDirectory = await mkdtemp(join(dirname(outputPath), '.object-'));
    const staged = join(stagingDirectory, 'body');
    await pipeline(Readable.fromWeb(response.body), async function* bounded(chunks) {
      let count = 0;
      for await (const chunk of chunks) {
        count += chunk.length;
        if (count > expected) throw Error('Downloaded Storage bytes exceed the original object size.');
        yield chunk;
      }
      if (count !== expected) throw Error('Downloaded Storage bytes differ from the original object size.');
    }, createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal });
    const captured = await stat(staged);
    if (captured.size !== expected) throw Error('Downloaded Storage bytes differ from the original object size.');
    await chmod(staged, 0o600);
    signal.throwIfAborted();
    // The archive path appears only after complete validation. A competing
    // capture's destination is never overwritten or removed during cleanup.
    await link(staged, outputPath);
    return captured.size;
  } finally {
    if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
    if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: false });
  }
}
