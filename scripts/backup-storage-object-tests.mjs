import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureBackupStorageObject } from './backup-storage-object.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'custodial-storage-transfer-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return {dir, outputPath: join(dir, 'object')};
}
function response(parts) {
  return new Response(new ReadableStream({start(controller) {
    for (const part of parts) controller.enqueue(Buffer.from(part));
    controller.close();
  }}));
}
function capture(outputPath, size, fetchImpl, extra = {}) {
  return captureBackupStorageObject({projectRef: 'fixture', object: {bucket_id: 'test', name: 'a/b c', metadata: {size}},
    secret: 'fixture', outputPath, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://fixture.supabase.co/storage/v1/object/authenticated/test/a/b%20c');
      assert.equal(options.redirect, 'error');
      assert(options.signal instanceof AbortSignal);
      return fetchImpl(options);
    }, ...extra});
}
test('ordinary producer delegates every archived object to the bounded capture', async () => {
  const text = await readFile(new URL('./production-backup.mjs', import.meta.url), 'utf8');
  assert.match(text, /import \{ captureBackupStorageObject \} from ".\/backup-storage-object.mjs"/);
  assert.match(text, /for \(const original of storageObjects\) \{[^}]+await captureBackupStorageObject\(\{ projectRef, object, secret, outputPath \}\)/);
});
for (const [name, parts] of [['empty', []], ['chunked', ['a', 'bc']]]) {
  test('accepts and publishes exact ' + name + ' content', async t => {
    const {outputPath, dir} = await fixture(t);
    const bytes = parts.join('');
    assert.equal(await capture(outputPath, bytes.length, () => response(parts)), bytes.length);
    assert.equal(await readFile(outputPath, 'utf8'), bytes);
    assert.deepEqual(await readdir(dir), ['object']);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  });
}
for (const [name, fetchImpl] of [
  ['short response', () => response(['ab'])],
  ['long response', () => response(['ab', 'cdef'])],
  ['wrong Content-Length', () => new Response('abcde', {headers: {'content-length': '6'}})],
  ['partial content', () => new Response('abcde', {status: 206})],
  ['lost body', () => new Response(new ReadableStream({pull(c) { c.error(Error('connection lost')); }}))],
]) {
  test(name + ' leaves no staging residue and permits same-path retry', async t => {
    const {outputPath, dir} = await fixture(t);
    await assert.rejects(capture(outputPath, 5, fetchImpl));
    assert.deepEqual(await readdir(dir), []);
    await capture(outputPath, 5, () => response(['abcde']));
    assert.equal(await readFile(outputPath, 'utf8'), 'abcde');
  });
}
test('deadline cancels a stalled body and cleans the partial transfer', async t => {
  const {outputPath, dir} = await fixture(t);
  let cancelled = false;
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(capture(outputPath, 5, () => new Response(new ReadableStream({
      start(c) { c.enqueue(Buffer.from('ab')); }, cancel() { cancelled = true; },
    })), {signal: AbortSignal.timeout(80)}), {name: 'AbortError'});
    assert.equal(cancelled, true);
    assert.deepEqual(await readdir(dir), []);
    await capture(outputPath, 5, () => response(['abcde']));
  } finally { clearTimeout(keepAlive); }
});
test('destination collisions preserve the previously published object', async t => {
  const {outputPath, dir} = await fixture(t);
  await writeFile(outputPath, 'original', {flag: 'wx'});
  const original = await stat(outputPath);
  await assert.rejects(capture(outputPath, 5, () => response(['abcde'])), {code: 'EEXIST'});
  assert.equal((await stat(outputPath)).ino, original.ino);
  assert.equal(await readFile(outputPath, 'utf8'), 'original');
  assert.deepEqual(await readdir(dir), ['object']);
});
test('concurrent complete responses can publish just one complete file', async t => {
  const {outputPath, dir} = await fixture(t);
  const variants = ['abcde', 'other'];
  const attempts = await Promise.allSettled(variants.map(value => capture(outputPath, 5, () => response([value]))));
  assert.equal(attempts.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(v => v.status === 'rejected').reason.code, 'EEXIST');
  assert.equal(await readFile(outputPath, 'utf8'), variants[attempts.findIndex(v => v.status === 'fulfilled')]);
  assert.deepEqual(await readdir(dir), ['object']);
});
