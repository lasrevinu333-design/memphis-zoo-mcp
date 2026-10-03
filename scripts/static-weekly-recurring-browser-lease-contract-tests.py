"""Pure launcher contracts only: no lease, browser, Docker, or database."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

SOURCE = Path(__file__).with_name('static-weekly-recurring-browser-lease-launcher.py')
spec = importlib.util.spec_from_file_location('recurring_browser_launcher', SOURCE)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

assert launcher.STAGE == 'current-manager-218'
assert 'fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed' in launcher.IMAGE
assert len(launcher.BACKEND_MEMBERS) == len(set(launcher.BACKEND_MEMBERS))
bound = {'childPid': 333, 'stageParentPid': 222, 'leaseParentPid': 111,
    'remainingContexts': 0, 'sharedUserBrowserAccessed': False,
    'launched': True, 'contextCreated': True, 'contextClosed': True, 'browserClosed': True}
assert launcher.classify_stage_cleanup(bound, 222, 111) == 'PROVEN'
assert launcher.classify_stage_cleanup({**bound, 'contextClosed': False}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'remainingContexts': 1}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'sharedUserBrowserAccessed': True}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'stageParentPid': 444}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'leaseParentPid': 444}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'launched': False, 'contextCreated': False,
    'contextClosed': False, 'browserClosed': False}, 222, 111) == 'NOT_LAUNCHED'
assert launcher.classify_stage_cleanup({**bound, 'contextCreated': False,
    'contextClosed': False}, 222, 111) == 'LAUNCHED_NO_CONTEXT_CLOSED'
with tempfile.TemporaryDirectory(prefix='mz-browser-launcher-pure-') as directory:
    own = Path(directory)
    os.chmod(own, 0o700)
    assert launcher.exact_directory(str(own), 'test', private=True) == own
    link = own / 'linked'
    link.symlink_to(own, target_is_directory=True)
    try:
        launcher.exact_directory(str(link), 'test')
        raise AssertionError('symlink accepted')
    except ValueError:
        pass
    receipt = own / 'receipt.json'
    launcher.private_json(receipt, {'status': 'SOURCE_ONLY'})
    assert json.loads(receipt.read_text()) == {'status': 'SOURCE_ONLY'}
    assert receipt.stat().st_mode & 0o777 == 0o600
    try:
        launcher.private_json(receipt, {'status': 'OVERWRITE'})
        raise AssertionError('receipt overwrite accepted')
    except FileExistsError:
        pass
    try:
        launcher.load_plan(receipt, '0' * 64)
        raise AssertionError('incorrect plan SHA accepted')
    except ValueError as error:
        assert 'plan SHA mismatch' in str(error)

    output = io.StringIO()
    child = subprocess.Popen([sys.executable, '-c', 'print("bounded source child")'],
        stdout=subprocess.PIPE, start_new_session=True)
    seen = []
    launcher.bounded_stream(child, output, time.monotonic() + 3,
        lambda line, log: (seen.append(line), log.write(line)), lambda: None)
    assert child.wait(timeout=3) == 0
    assert seen == ['bounded source child\n']
    assert output.getvalue() == 'bounded source child\n'

    silent = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(2)'],
        stdout=subprocess.PIPE, start_new_session=True)
    try:
        try:
            launcher.bounded_stream(silent, io.StringIO(), time.monotonic() + 0.15,
                lambda line, log: None, lambda: None)
            raise AssertionError('silent child exceeded bound')
        except TimeoutError:
            pass
    finally:
        silent.terminate()
        silent.wait(timeout=3)

source = SOURCE.read_text()
for required in ('BrowserLeaseClient()', 'client.acquire(', 'client.renew(',
        'client.check(', 'client.close_targets_and_release(',
        "['node', 'scripts/run-isolated-shift-end-tests.mjs', STAGE]",
        "'STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER': '1'",
        "'CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID': str(os.getpid())",
        'browser-stage-cleanup.json', 'owned_container_absent(child.pid)',
        'child_process_group_absent', 'source-receipt.json'):
    assert required in source, required
print('PASS recurring browser lease launcher pure source, private receipt, and silent-child bound contracts')
