#!/usr/bin/env python3
"""Verify downloaded ciphertext and signed contents; never perform a restore.

Limits are intentional fail-closed ceilings, not archive-size promises. All plaintext
is confined to an owned temporary directory removed on success or failure.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

MAX_BYTES = 20 * 1024 ** 3
MAX_MEMBERS = 100000


def digest(path):
    h = hashlib.sha256()
    size = 0
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError('Ciphertext exceeds size limit')
            h.update(chunk)
    return h.hexdigest(), size


def safe_extract(archive, destination, max_bytes=MAX_BYTES, max_members=MAX_MEMBERS):
    """Bound decompression, inspect every member, then manually copy regular files.

    No extract()/extractall(), archive permissions, ownership, or links are used.
    Destination must not exist, preventing preexisting-link attacks.
    """
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    with tempfile.TemporaryFile() as raw:
        total = 0
        with gzip.open(archive, 'rb') as source:
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError('Expanded tar exceeds size limit')
                raw.write(chunk)
        raw.seek(0)
        with tarfile.open(fileobj=raw, mode='r:') as tar:
            members = []
            seen = set()
            expanded = 0
            for member in tar:
                if len(members) >= max_members:
                    raise ValueError('Too many tar members')
                name = member.name
                if name.startswith('./'):
                    name = name[2:]
                if name in ('', '.') and member.isdir():
                    name = '.'
                elif (not name or name.startswith('/') or '\\' in name
                      or any(p in ('', '.', '..') for p in name.split('/'))
                      or len(name) > 4096 or any(ord(c) < 32 for c in name)):
                    raise ValueError('Unsafe member path')
                if name in seen:
                    raise ValueError('Duplicate member path')
                seen.add(name)
                if not (member.isdir() or member.isreg()) or member.issparse():
                    raise ValueError('Only ordinary files and directories are permitted')
                if member.size < 0 or (member.isdir() and member.size):
                    raise ValueError('Invalid member size')
                expanded += member.size
                if expanded > max_bytes:
                    raise ValueError('Expanded files exceed size limit')
                members.append((member, name))
            if not members:
                raise ValueError('Empty archive')
            for member, name in members:
                target = destination / name
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with tar.extractfile(member) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
                    if target.stat().st_size != member.size:
                        raise ValueError('Truncated tar member')


def verify(args):
    if not re.fullmatch(r'[0-9a-f]{64}', args.sha256):
        raise ValueError('Invalid expected ciphertext hash')
    for field in ('run_id', 'run_attempt', 'artifact_id'):
        if not re.fullmatch(r'[1-9][0-9]*', getattr(args, field)):
            raise ValueError('Missing or invalid GitHub identity')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        raise ValueError('Invalid repository identity')
    actual_hash, actual_size = digest(args.ciphertext)
    if actual_hash != args.sha256 or actual_size != args.size or actual_size == 0:
        raise ValueError('Downloaded ciphertext differs from pre-upload bytes')
    if Path(args.receipt).exists():
        raise ValueError('Refusing to reuse an existing receipt')
    with tempfile.TemporaryDirectory(prefix='backup-readback-', dir=os.environ.get('RUNNER_TEMP')) as work:
        plain = Path(work) / 'archive.tar.gz'
        subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '250000',
                        '-in', str(args.ciphertext), '-out', str(plain),
                        '-pass', 'env:BACKUP_ENCRYPTION_PASSPHRASE'], check=True, timeout=600)
        extracted = Path(work) / 'contents'
        safe_extract(plain, extracted)
        # Allowlist prevents inherited production credentials or apply toggles.
        env = {key: os.environ[key] for key in ('PATH', 'HOME', 'RUNNER_TEMP',
               'RESTORE_ARCHIVE_VERIFY_KEY', 'RESTORE_ARCHIVE_VERIFY_KEY_ID') if key in os.environ}
        env.update(RESTORE_SOURCE_DIR=str(extracted), RESTORE_APPLY='false')
        subprocess.run(['npm', 'run', 'restore:verify'], env=env, check=True, timeout=1200)
    receipt = dict(schema='custodial.backup-readback.v1', repository=args.repository,
                   run_id=args.run_id, run_attempt=args.run_attempt, artifact_id=args.artifact_id,
                   ciphertext_bytes=actual_size, ciphertext_sha256=actual_hash,
                   uploaded_artifact_readback='passed', signed_archive_validation='passed',
                   database_restore_performed=False, storage_restore_performed=False,
                   verified_at=datetime.now(timezone.utc).isoformat(),
                   scope='Ciphertext readback and signed archive validation only; restore NOT performed.')
    with open(args.receipt, 'x') as output:
        json.dump(receipt, output, indent=2)
        output.write('\n')
    print(json.dumps(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('ciphertext', 'sha256', 'run-id', 'run-attempt', 'artifact-id', 'repository', 'receipt'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--size', required=True, type=int)
    verify(parser.parse_args())


if __name__ == '__main__':
    main()
