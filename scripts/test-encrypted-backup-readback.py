#!/usr/bin/env python3
"""Offline fixtures only. npm verifier is mocked; no production data or network."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('readback', Path(__file__).with_name('verify-encrypted-backup-readback.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='readback-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.archive = self.root / 'test.tar.gz'

    def archive_with(self, entries):
        with tarfile.open(self.archive, 'w:gz') as tar:
            for name, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = '../outside'
                data = b'fixture' if kind == tarfile.REGTYPE else b''
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

    def test_valid_tar(self):
        self.archive_with([('./', tarfile.DIRTYPE), ('./nested/', tarfile.DIRTYPE), ('./nested/file', tarfile.REGTYPE)])
        M.safe_extract(self.archive, self.root / 'out')
        self.assertEqual((self.root / 'out/nested/file').read_bytes(), b'fixture')

    def test_rejected_paths_and_types(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('a/../../x', tarfile.REGTYPE), ('a\\x', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE),
                           ('dev', tarfile.CHRTYPE), ('fifo', tarfile.FIFOTYPE)]:
            with self.subTest(name=name):
                self.archive_with([(name, kind)])
                with tempfile.TemporaryDirectory(dir=self.root) as d:
                    with self.assertRaises(ValueError):
                        M.safe_extract(self.archive, Path(d) / 'out')

    def test_duplicates(self):
        self.archive_with([('file', tarfile.REGTYPE), ('./file', tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            M.safe_extract(self.archive, self.root / 'out')
        self.assertEqual(list((self.root / 'out').iterdir()), [])

    def test_limits(self):
        self.archive_with([('file', tarfile.REGTYPE)])
        for options in ({'max_bytes': 10}, {'max_members': 0}):
            with tempfile.TemporaryDirectory(dir=self.root) as d:
                with self.assertRaises(ValueError):
                    M.safe_extract(self.archive, Path(d) / 'out', **options)

    def encrypted_args(self):
        self.archive_with([('fixture', tarfile.REGTYPE)])
        ciphertext = self.root / 'ciphertext'
        subprocess.run(['openssl', 'enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '250000',
                        '-in', str(self.archive), '-out', str(ciphertext), '-pass', 'pass:offline-fixture'], check=True)
        sha, size = M.digest(ciphertext)
        return argparse.Namespace(ciphertext=ciphertext, sha256=sha, size=size, repository='fixture/repo',
                                  run_id='123', run_attempt='1', artifact_id='456', receipt=self.root / 'receipt.json')

    def test_checksum_and_size_mismatch_no_receipt(self):
        args = self.encrypted_args()
        args.sha256 = '0' * 64
        with self.assertRaisesRegex(ValueError, 'differs'):
            M.verify(args)
        args.sha256 = M.digest(args.ciphertext)[0]
        args.size += 1
        with self.assertRaisesRegex(ValueError, 'differs'):
            M.verify(args)
        self.assertFalse(args.receipt.exists())

    def test_wrong_key_no_receipt(self):
        args = self.encrypted_args()
        with patch.dict(os.environ, {'BACKUP_ENCRYPTION_PASSPHRASE': 'wrong-fixture'}):
            with self.assertRaises((subprocess.CalledProcessError, ValueError, OSError)):
                M.verify(args)
        self.assertFalse(args.receipt.exists())

    def test_corrupt_ciphertext_no_receipt(self):
        args = self.encrypted_args()
        args.ciphertext.write_bytes(args.ciphertext.read_bytes()[:-1])
        args.sha256, args.size = M.digest(args.ciphertext)
        with patch.dict(os.environ, {'BACKUP_ENCRYPTION_PASSPHRASE': 'offline-fixture'}):
            with self.assertRaises(subprocess.CalledProcessError):
                M.verify(args)
        self.assertFalse(args.receipt.exists())

    def test_verifier_failure_no_receipt_and_plaintext_cleaned(self):
        args = self.encrypted_args()
        real_run = subprocess.run
        dirs = []
        def run(command, **kwargs):
            if command[0] == 'npm':
                dirs.append(Path(kwargs['env']['RESTORE_SOURCE_DIR']))
                self.assertEqual(kwargs['env']['RESTORE_APPLY'], 'false')
                self.assertNotIn('SUPABASE_DB_URL', kwargs['env'])
                raise subprocess.CalledProcessError(1, command)
            return real_run(command, **kwargs)
        with patch.dict(os.environ, {'BACKUP_ENCRYPTION_PASSPHRASE': 'offline-fixture', 'SUPABASE_DB_URL': 'fixture-not-a-connection'}), patch.object(M.subprocess, 'run', side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError):
                M.verify(args)
        self.assertFalse(args.receipt.exists())
        self.assertTrue(dirs)
        self.assertFalse(dirs[0].exists())

    def test_real_inner_verifier_rejects_missing_manifest(self):
        args = self.encrypted_args()
        # Synthetic malformed archive only. No database/service credentials passed.
        with patch.dict(os.environ, {'BACKUP_ENCRYPTION_PASSPHRASE': 'offline-fixture',
                                     'RESTORE_ARCHIVE_VERIFY_KEY': 'offline-fixture-signing-key-32-bytes',
                                     'RESTORE_ARCHIVE_VERIFY_KEY_ID': 'offline-fixture'}):
            with self.assertRaises(subprocess.CalledProcessError):
                M.verify(args)
        self.assertFalse(args.receipt.exists())

    def test_success_receipt_mocked_inner_verifier(self):
        args = self.encrypted_args()
        real_run = subprocess.run
        def run(command, **kwargs):
            if command[0] == 'npm':
                self.assertTrue((Path(kwargs['env']['RESTORE_SOURCE_DIR']) / 'fixture').exists())
                return subprocess.CompletedProcess(command, 0)
            return real_run(command, **kwargs)
        with patch.dict(os.environ, {'BACKUP_ENCRYPTION_PASSPHRASE': 'offline-fixture'}), patch.object(M.subprocess, 'run', side_effect=run):
            M.verify(args)
        receipt = json.loads(args.receipt.read_text())
        self.assertEqual(receipt['artifact_id'], '456')
        self.assertFalse(receipt['database_restore_performed'])
        self.assertFalse(receipt['storage_restore_performed'])

    def test_workflow_contracts(self):
        workflow = (Path(__file__).parent.parent / '.github/workflows/production-disaster-recovery-backup.yml').read_text()
        self.assertIn('artifact-ids: ${{ steps.encrypted_upload.outputs.artifact-id }}', workflow)
        self.assertIn('actions: read', workflow)
        self.assertLess(workflow.index('run: npm ci'), workflow.index('run: npm run test:backup-source-contracts'))
        self.assertLess(workflow.index('run: npm run test:backup-source-contracts'), workflow.index('run: npm run test:ci-workflows'))
        self.assertLess(workflow.index('run: npm run test:ci-workflows'), workflow.index('Require configured recovery secrets'))
        self.assertLess(workflow.index('run: npm run test:ci-workflows'), workflow.index('run: npm run backup:production'))
        self.assertIn("node-version: '22.23.1'", workflow)
        self.assertIn('run-id: ${{ github.run_id }}', workflow)
        self.assertIn('if: ${{ success() }}', workflow)
        self.assertEqual(workflow.count('retention-days: 14'), 2)
        self.assertNotIn('continue-on-error', workflow)
        self.assertIn('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093', workflow)
        self.assertLess(workflow.index('id: ciphertext'), workflow.index('id: encrypted_upload'))
        self.assertLess(workflow.index('Download exact just-uploaded'), workflow.index('Publish successful readback'))


if __name__ == '__main__':
    unittest.main()
