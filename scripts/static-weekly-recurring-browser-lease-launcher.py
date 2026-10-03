"""Test-only exact 218 manager SQL fixture with guarded isolated Chromium.

--preflight performs source/dependency checks only. --run requires the live
supported BrowserLeaseClient; it never uses shared user Chrome or a phone.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, '/opt/forge-control-plane/runtime/site-packages')

STAGE = 'current-manager-218'
IMAGE = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
BACKEND_MEMBERS = (
    'scripts/run-isolated-shift-end-tests.mjs',
    'scripts/static-weekly-current-roster-publication-tests.mjs',
    'scripts/static-weekly-recurring-confirmation-http-integration.mjs',
    'scripts/static-weekly-recurring-browser-transport.mjs',
    'scripts/static-weekly-recurring-browser-stage.mjs',
    'scripts/fixtures/current-manager-publication-source.mjs',
)
PLAN_KEYS = frozenset(('schema', 'backend_root', 'backend_head', 'backend_tree',
    'frontend_root', 'frontend_head', 'frontend_tree', 'playwright_index_sha256',
    'playwright_package_sha256', 'frontend_lock_sha256', 'output_parent', 'stage'))
SHA = re.compile(r'^[0-9a-f]{64}$')
GIT = re.compile(r'^[0-9a-f]{40}$')


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private_json(path, value):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf8') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write('\n')
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def exact_directory(value, label, private=False):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError(label + ' must be a resolved real directory')
    if private:
        metadata = path.stat()
        if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ValueError(label + ' must be caller-owned and private')
    return path


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, timeout=20).strip()


def load_plan(plan_path, expected_sha):
    if not SHA.fullmatch(expected_sha) or digest(plan_path) != expected_sha:
        raise ValueError('exact plan SHA mismatch')
    metadata = Path(plan_path).stat()
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError('plan must be caller-owned and private')
    plan = json.loads(Path(plan_path).read_text())
    if not isinstance(plan, dict) or frozenset(plan) != PLAN_KEYS:
        raise ValueError('exact plan schema keys')
    if plan['schema'] != 'custodial.recurring-browser-218-plan.v1' or plan['stage'] != STAGE:
        raise ValueError('only exact manager 218 browser profile is supported')
    for field in ('backend_head', 'backend_tree', 'frontend_head', 'frontend_tree'):
        if not GIT.fullmatch(plan[field]):
            raise ValueError('exact Git identity required: ' + field)
    for field in ('playwright_index_sha256', 'playwright_package_sha256', 'frontend_lock_sha256'):
        if not SHA.fullmatch(plan[field]):
            raise ValueError('exact dependency SHA required: ' + field)
    backend = exact_directory(plan['backend_root'], 'backend source')
    frontend = exact_directory(plan['frontend_root'], 'frontend source')
    output_parent = exact_directory(plan['output_parent'], 'evidence parent', private=True)
    for label, root in (('backend', backend), ('frontend', frontend)):
        if git(root, 'rev-parse', 'HEAD') != plan[label + '_head'] or \
           git(root, 'rev-parse', 'HEAD^{tree}') != plan[label + '_tree'] or \
           git(root, 'status', '--porcelain'):
            raise ValueError(label + ' exact source identity or cleanliness changed')
    dependencies = (
        (frontend / 'node_modules/playwright/index.mjs', 'playwright_index_sha256'),
        (frontend / 'node_modules/playwright/package.json', 'playwright_package_sha256'),
        (frontend / 'package-lock.json', 'frontend_lock_sha256'),
    )
    for file, field in dependencies:
        if file.is_symlink() or file.resolve() != file or digest(file) != plan[field]:
            raise ValueError('installed browser dependency changed: ' + field)
    if json.loads((frontend / 'node_modules/playwright/package.json').read_text()).get('version') != '1.61.1':
        raise ValueError('supported Playwright version changed')
    members = {name: digest(backend / name) for name in BACKEND_MEMBERS}
    if IMAGE not in (backend / 'scripts/run-isolated-shift-end-tests.mjs').read_text():
        raise ValueError('pinned network-none database image changed')
    subprocess.check_output(['node', '--input-type=module', '-e',
        "import {assertCurrentManager218MigrationSet} from './scripts/fixtures/current-manager-publication-source.mjs';"
        "assertCurrentManager218MigrationSet();"], cwd=backend, text=True, timeout=30)
    return plan, backend, frontend, output_parent, members


def bounded_stream(child, log, deadline, on_line, on_tick):
    pending = b''
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        while True:
            on_tick()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('guarded manager browser fixture exceeded outer execution bound')
            if not selector.select(min(remaining, 0.5)):
                continue
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                if pending:
                    on_line(pending.decode('utf8', errors='replace'), log)
                return
            pending += chunk
            if len(pending) > 1024 * 1024:
                raise ValueError('fixture child output line exceeds one megabyte')
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                on_line(line.decode('utf8', errors='replace') + '\n', log)


def group_absent(pid):
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return True
    return False


def owned_container_absent(pid):
    name = 'mz_schema_shift_end_' + str(pid)
    result = subprocess.check_output(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$',
        '--format', '{{.Names}}'], text=True, timeout=20).strip()
    return result == ''


def read_process_identity(pid):
    """Linux PID plus birth, boot, owner and executable; PID alone is never custody."""
    try:
        stat_text = Path(f'/proc/{pid}/stat').read_text()
        fields = stat_text[stat_text.rfind(')') + 2:].split()
        process_dir = Path(f'/proc/{pid}')
        if fields[0] == 'Z':
            return None
        return {'pid': pid, 'startTicks': fields[19], 'processGroup': int(fields[2]),
            'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'uid': process_dir.stat().st_uid, 'executable': str((process_dir / 'exe').resolve(strict=True))}
    except FileNotFoundError:
        return None


def exact_marked_processes(run_id):
    marker = ('CUSTODIAL_RECURRING_BROWSER_RUN_ID=' + run_id).encode()
    found = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            pid = int(proc.name)
            if proc.stat().st_uid != os.getuid():
                continue
            # Read the exact fresh nonce first. Some pre-existing same-UID
            # services disallow their exe inspection; they predate this nonce.
            if marker not in (proc / 'environ').read_bytes().split(b'\0'):
                continue
            identity = read_process_identity(pid)
            if identity is not None and identity['uid'] == os.getuid():
                found.append(identity)
        except FileNotFoundError:
            continue
        except PermissionError:
            continue  # inaccessible pre-existing process cannot inherit a fresh nonce
    return found


def identical_process(wanted):
    current = read_process_identity(wanted['pid'])
    return current is not None and all(current.get(key) == wanted.get(key)
        for key in ('pid', 'startTicks', 'bootId', 'uid', 'executable'))


def stop_exact_marked_processes(run_id, browser_record, stage_pid, lease_pid):
    """Bounded fallback only for this synthetic run, after the SQL process group ends."""
    marker_processes = exact_marked_processes(run_id)
    if browser_record is not None:
        if (browser_record.get('runId') != run_id or browser_record.get('stageParentPid') != stage_pid
                or browser_record.get('leaseParentPid') != lease_pid or browser_record.get('production') is not False
                or browser_record.get('uid') != os.getuid()):
            raise RuntimeError('browser sidecar identity or parent mismatch')
        expected = {key: browser_record.get(key) for key in
            ('pid', 'startTicks', 'bootId', 'uid', 'executable')}
        current = read_process_identity(expected['pid']) if isinstance(expected['pid'], int) else None
        if current is not None and not identical_process(expected):
            raise RuntimeError('recorded browser PID birth or executable changed')
        if current is not None and expected not in [
                {key: item.get(key) for key in expected} for item in marker_processes]:
            raise RuntimeError('recorded browser lacks exact synthetic process marker')
    signalled = []
    for identity in marker_processes:
        if identical_process(identity):
            os.kill(identity['pid'], signal.SIGTERM)
            signalled.append(identity)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(identical_process(item) for item in signalled):
        time.sleep(0.1)
    for identity in signalled:
        if identical_process(identity):
            os.kill(identity['pid'], signal.SIGKILL)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and exact_marked_processes(run_id):
        time.sleep(0.1)
    remaining = exact_marked_processes(run_id)
    if remaining or (browser_record is not None and identical_process(browser_record)):
        raise RuntimeError('exact synthetic browser process remains after bounded cleanup')
    return {'matched_before': len(marker_processes), 'signalled': len(signalled),
        'remaining': 0, 'recorded_browser_gone': browser_record is None or not identical_process(browser_record)}


def classify_stage_cleanup(cleanup, stage_pid, lease_pid):
    if (not isinstance(cleanup, dict) or not isinstance(cleanup.get('childPid'), int)
            or cleanup['childPid'] <= 1 or cleanup.get('stageParentPid') != stage_pid
            or cleanup.get('leaseParentPid') != lease_pid or cleanup.get('remainingContexts') != 0
            or cleanup.get('sharedUserBrowserAccessed') is not False):
        return 'UNPROVEN'
    if cleanup.get('launched') is False and cleanup.get('contextCreated') is False:
        return 'NOT_LAUNCHED'
    if (cleanup.get('launched') is True and cleanup.get('contextCreated') is False
            and cleanup.get('serverClosed') is True and cleanup.get('processGone') is True
            and cleanup.get('processIdentityRecorded') is True):
        return 'LAUNCHED_NO_CONTEXT_CLOSED'
    if (cleanup.get('launched') is True and cleanup.get('contextCreated') is True
            and cleanup.get('contextClosed') is True and cleanup.get('browserClosed') is True
            and cleanup.get('serverClosed') is True and cleanup.get('processGone') is True
            and cleanup.get('processIdentityRecorded') is True):
        return 'PROVEN'
    return 'UNPROVEN'


def run(plan_path, expected_sha):
    from forge.browser import BrowserLeaseClient, CleanupTracker
    plan, backend, frontend, parent, members = load_plan(plan_path, expected_sha)
    output = Path(tempfile.mkdtemp(prefix='recurring-browser-218-', dir=parent))
    os.chmod(output, 0o700)
    client = BrowserLeaseClient()
    if client.status().get('lease') is not None:
        raise RuntimeError('exclusive browser lease unavailable; no launch')
    lease = client.acquire('Custodial synthetic manager 218 Chromium transport',
        '/root/events_modules', ttl_seconds=600, wait_seconds=0)
    tracker = CleanupTracker.from_snapshot([])
    receipt = {'schema': 'custodial.recurring-browser-218-execution.v1',
        'plan_sha256': expected_sha, 'backend_head': plan['backend_head'],
        'backend_tree': plan['backend_tree'], 'frontend_head': plan['frontend_head'],
        'frontend_tree': plan['frontend_tree'], 'backend_member_sha256': members,
        'image': IMAGE, 'stage': STAGE, 'started_at': stamp(),
        'lease_owner': lease.owner, 'lease_session_id': lease.session_id,
        'lease_generation_id': lease.generation_id, 'shared_browser_accessed': False,
        'production': False, 'phone_accessed': False, 'independent_audit': False}
    child = None
    run_id = secrets.token_hex(16)
    receipt['browser_run_id'] = run_id
    released = False
    entered = 0
    cleaned = 0
    renew_at = time.monotonic() + 240
    started = time.monotonic()

    def on_line(line, log):
        nonlocal entered, cleaned
        log.write(line)
        log.flush()
        if line.strip() == 'BROWSER_TRANSPORT_STAGE_ENTERED':
            entered += 1
        if line.strip() == 'BROWSER_TRANSPORT_STAGE_CLEANUP':
            cleaned += 1
        if line.startswith(('BROWSER_TRANSPORT_STAGE_', 'OWNED_CONTAINER_REMOVED',
            'NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS')):
            print(line, end='', flush=True)

    def renew_if_due():
        nonlocal lease, renew_at
        if time.monotonic() >= renew_at:
            lease = client.renew(lease, ttl_seconds=600)
            renew_at = time.monotonic() + 240

    def interrupt(signum, frame):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
        raise InterruptedError('guarded manager browser fixture interrupted')

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupt)
    execution_error = None
    try:
        private_json(output / 'source-receipt.json', receipt)
        print('RECURRING_BROWSER_OUTPUT=' + str(output), flush=True)
        if not client.check(lease):
            raise RuntimeError('live supported browser lease check failed before child launch')
        env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'HOME',
            'XDG_RUNTIME_DIR', 'PLAYWRIGHT_BROWSERS_PATH') if key in os.environ}
        env.update({'STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER': '1',
            'CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID': str(os.getpid()),
            'CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR': str(output),
            'CUSTODIAL_RECURRING_BROWSER_RUN_ID': run_id,
            'CUSTODIAL_RECURRING_BROWSER_FRONTEND_ROOT': str(frontend),
            'CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256': plan['playwright_index_sha256'],
            'CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_PACKAGE_SHA256': plan['playwright_package_sha256'],
            'CUSTODIAL_RECURRING_BROWSER_PACKAGE_LOCK_SHA256': plan['frontend_lock_sha256'],
            'STATIC_WEEKLY_CONTINUITY_EVIDENCE': str(output / 'fixture-result.json')})
        child = subprocess.Popen(['node', 'scripts/run-isolated-shift-end-tests.mjs', STAGE],
            cwd=backend, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=False, start_new_session=True)
        receipt['child_pid'] = child.pid
        receipt['child_process_group'] = child.pid
        with (output / 'raw.log').open('x', encoding='utf8') as log:
            os.chmod(output / 'raw.log', 0o600)
            bounded_stream(child, log, started + 1800, on_line, renew_if_due)
        code = child.wait(timeout=10)
        receipt['exit_code'] = code
    except BaseException as error:
        execution_error = error
    finally:
        failures = []
        try:
            if child is not None and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
        except BaseException as error:
            failures.append('child_cleanup:' + type(error).__name__)
        receipt['child_exited'] = child is None or child.poll() is not None
        receipt['child_process_group_absent'] = child is None or group_absent(child.pid)
        try:
            receipt['owned_container_absent'] = child is None or owned_container_absent(child.pid)
        except BaseException as error:
            receipt['owned_container_absent'] = False
            failures.append('container_check:' + type(error).__name__)
        browser_path = output / 'browser-process.json'
        browser_record = None
        if browser_path.exists():
            try:
                browser_record = json.loads(browser_path.read_text())
                receipt['browser_process_sha256'] = digest(browser_path)
            except BaseException as error:
                failures.append('browser_sidecar:' + type(error).__name__)
        try:
            receipt['exact_browser_cleanup'] = stop_exact_marked_processes(
                run_id, browser_record, child.pid if child else None, os.getpid())
        except BaseException as error:
            failures.append('exact_browser_cleanup:' + type(error).__name__)
        receipt['child_process_group_absent'] = child is None or group_absent(child.pid)
        if not receipt['child_process_group_absent']:
            failures.append('child_group_still_present')
        cleanup_path = output / 'browser-stage-cleanup.json'
        if entered:
            if entered != 1 or cleaned != 1 or not cleanup_path.exists():
                receipt['browser_cleanup_state'] = 'UNPROVEN'
            else:
                try:
                    cleanup = json.loads(cleanup_path.read_text())
                    receipt['browser_cleanup_sha256'] = digest(cleanup_path)
                    receipt['browser_cleanup_state'] = classify_stage_cleanup(cleanup, child.pid, os.getpid())
                except BaseException as error:
                    receipt['browser_cleanup_state'] = 'UNPROVEN'
                    failures.append('cleanup_receipt:' + type(error).__name__)
        else:
            receipt['browser_cleanup_state'] = 'NOT_ENTERED'
        safe = (receipt.get('child_exited') is True
            and receipt.get('child_process_group_absent') is True
            and receipt.get('owned_container_absent') is True
            and receipt.get('exact_browser_cleanup', {}).get('remaining') == 0
            and not failures)
        if safe:
            try:
                if client.check(lease):
                    client.close_targets_and_release(lease, tracker,
                        close_target=lambda target: None, list_target_ids=lambda: [])
                    released = True
            except BaseException as error:
                failures.append('normal_lease_release:' + type(error).__name__)
        receipt['lease_released'] = released
        receipt['finished_at'] = stamp()
        receipt['elapsed_seconds'] = round(time.monotonic() - started, 3)
        if (output / 'raw.log').exists():
            receipt['raw_log_sha256'] = digest(output / 'raw.log')
        try:
            receipt['backend_source_unchanged'] = (git(backend, 'rev-parse', 'HEAD') == plan['backend_head']
                and git(backend, 'rev-parse', 'HEAD^{tree}') == plan['backend_tree']
                and not git(backend, 'status', '--porcelain')
                and all(digest(backend / name) == wanted for name, wanted in members.items()))
            receipt['frontend_source_unchanged'] = (git(frontend, 'rev-parse', 'HEAD') == plan['frontend_head']
                and git(frontend, 'rev-parse', 'HEAD^{tree}') == plan['frontend_tree']
                and not git(frontend, 'status', '--porcelain'))
        except BaseException as error:
            receipt['backend_source_unchanged'] = False
            receipt['frontend_source_unchanged'] = False
            failures.append('source_recheck:' + type(error).__name__)
        receipt['cleanup_failure_classes'] = failures
        receipt['execution_error_class'] = type(execution_error).__name__ if execution_error else None
        receipt['status'] = ('PASS_SYNTHETIC_CHROMIUM_HTTP_SQL' if released and entered == 1
            and receipt.get('exit_code') == 0 and receipt['browser_cleanup_state'] == 'PROVEN'
            and receipt['backend_source_unchanged'] and receipt['frontend_source_unchanged']
            and not failures and execution_error is None
            else 'FAIL_OR_INCOMPLETE')
        try:
            private_json(output / 'execution-receipt.json', receipt)
        except BaseException as error:
            if execution_error is None:
                execution_error = error
        print('RECURRING_BROWSER_STATUS=' + receipt['status'], flush=True)
    if execution_error is not None:
        raise execution_error
    return 0 if receipt['status'] == 'PASS_SYNTHETIC_CHROMIUM_HTTP_SQL' else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('preflight', 'run'))
    parser.add_argument('plan')
    parser.add_argument('plan_sha256')
    args = parser.parse_args()
    if args.mode == 'preflight':
        plan, backend, frontend, _, members = load_plan(args.plan, args.plan_sha256)
        print(json.dumps({'status': 'SOURCE_PREFLIGHT_ONLY', 'stage': STAGE,
            'backend_head': plan['backend_head'], 'frontend_head': plan['frontend_head'],
            'backend_member_sha256': members, 'browser': False, 'database': False}, sort_keys=True))
        return 0
    return run(args.plan, args.plan_sha256)


if __name__ == '__main__':
    sys.exit(main())
