"""Pure launcher contracts only: no lease, browser, Docker, or database."""
import importlib.util
import io
import json
import os
import secrets
import shutil
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
assert launcher.STAGE_219 == 'current-manager-219'
assert launcher.PROFILE_SCHEMAS == {
    'current-manager-218': 'custodial.recurring-browser-218-plan.v1',
    'current-manager-219': 'custodial.recurring-browser-219-plan.v1'}
assert 'fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed' in launcher.IMAGE
assert len(launcher.BACKEND_MEMBERS) == len(set(launcher.BACKEND_MEMBERS))
assert launcher.BACKEND_LOCK_SHA256 == '2085bec2833f5e08e3314aa12003b2a8e0863b07837742384e92072b77beb6b1'
assert set(launcher.BACKEND_PACKAGES) == {'pg', 'highs', 'express', 'dotenv', '@supabase/supabase-js'}
bound = {'childPid': 333, 'stageParentPid': 222, 'leaseParentPid': 111,
    'remainingContexts': 0, 'sharedUserBrowserAccessed': False,
    'launched': True, 'contextCreated': True, 'contextClosed': True, 'browserClosed': True,
    'serverClosed': True, 'processGone': True, 'processIdentityRecorded': True}
assert launcher.classify_stage_cleanup(bound, 222, 111) == 'PROVEN'
assert launcher.classify_stage_cleanup({**bound, 'contextClosed': False}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'processGone': False}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'serverClosed': False}, 222, 111) == 'UNPROVEN'
assert launcher.classify_stage_cleanup({**bound, 'processIdentityRecorded': False}, 222, 111) == 'UNPROVEN'
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
    base_plan = {key: '0' * 40 if key.endswith(('_head', '_tree')) else '0' * 64
        for key in launcher.PLAN_KEYS}
    base_plan.update(schema='custodial.recurring-browser-218-plan.v1',stage='current-manager-219')
    wrong_profile = own / 'wrong-profile.json'
    launcher.private_json(wrong_profile, base_plan)
    try:
        launcher.load_plan(wrong_profile, launcher.digest(wrong_profile))
        raise AssertionError('219 stage accepted 218 plan schema')
    except ValueError as error:
        assert 'exact manager 218/219 browser profiles' in str(error)

    # Backend module setup is an ignored real directory with only exact
    # caller-owned links. This test never imports a SQL child or starts Docker.
    test_backend = own / 'backend'
    test_backend.mkdir()
    shutil.copyfile(SOURCE.parent.parent / 'package-lock.json', test_backend / 'package-lock.json')
    assert launcher.validate_backend_dependency_source(test_backend) == launcher.INSTALLED_BACKEND / 'node_modules'
    assert not os.path.lexists(test_backend / 'node_modules')
    (test_backend / 'node_modules').symlink_to(own, target_is_directory=True)
    try:
        launcher.install_backend_dependencies(test_backend, smoke=False, clean=lambda: True)
        raise AssertionError('preexisting top-level dependency symlink accepted')
    except ValueError as error:
        assert 'must not preexist' in str(error)
    never_created = launcher.new_backend_dependency_layout(test_backend)
    preexisting_receipt, preexisting_failures = {}, []
    launcher.record_backend_dependency_cleanup(never_created, preexisting_receipt, preexisting_failures)
    assert preexisting_receipt['backend_dependency_cleanup'] == 'UNPROVEN'
    assert preexisting_failures == ['backend_dependency_cleanup:RuntimeError']
    (test_backend / 'node_modules').unlink()
    layout = launcher.install_backend_dependencies(test_backend, smoke=False, clean=lambda: True)
    try:
        assert (test_backend / 'node_modules').is_dir() and not (test_backend / 'node_modules').is_symlink()
        assert (test_backend / 'node_modules/@supabase').is_dir()
        assert len(layout['links']) == 5
        for member, target in layout['links']:
            assert member.is_symlink() and os.readlink(member) == str(target)
        try:
            launcher.install_backend_dependencies(test_backend, smoke=False, clean=lambda: True)
            raise AssertionError('preexisting dependency layout accepted')
        except ValueError as error:
            assert 'must not preexist' in str(error)
        member, target = layout['links'][0]
        member.unlink()
        member.symlink_to(own, target_is_directory=True)
        try:
            launcher.cleanup_backend_dependencies(layout)
            raise AssertionError('replaced dependency link silently removed')
        except RuntimeError as error:
            assert 'changed before cleanup' in str(error)
        assert all(other.is_symlink() for other, _ in layout['links'][1:]), 'refusal must not partially unlink'
        member.unlink()
        member.symlink_to(target, target_is_directory=True)
    finally:
        assert launcher.cleanup_backend_dependencies(layout) == 'EXACT_OWNED_LINKS_AND_DIRECTORIES_REMOVED'
    assert not os.path.lexists(test_backend / 'node_modules')
    try:
        launcher.install_backend_dependencies(test_backend, smoke=False, clean=lambda: False)
        raise AssertionError('dirty source accepted after dependency setup')
    except ValueError as error:
        assert 'changed clean source' in str(error)
    assert not os.path.lexists(test_backend / 'node_modules'), 'partial setup must clean exact owned links'
    # A setup error remains the original error even when an unexpected file
    # blocks cleanup. The caller retains the layout and cannot claim absent.
    retained = launcher.new_backend_dependency_layout(test_backend)
    foreign = test_backend / 'node_modules' / 'unexpected-from-test'
    class SetupFailure(RuntimeError):
        pass
    original = SetupFailure('synthetic setup failure')
    def fail_after_foreign_file():
        foreign.write_text('synthetic')
        raise original
    try:
        launcher.install_backend_dependencies(test_backend, smoke=False,
            clean=fail_after_foreign_file, layout=retained)
        raise AssertionError('setup error swallowed')
    except SetupFailure as error:
        assert error is original
    assert retained['created'] and not retained['cleaned']
    assert retained['setup_cleanup_error'] == 'RuntimeError'
    assert len(retained['links']) == 5 and all(member.is_symlink() for member, _ in retained['links'])
    failed_receipt, failed_cleanup = {}, []
    launcher.record_backend_dependency_cleanup(retained, failed_receipt, failed_cleanup)
    assert failed_receipt['backend_dependency_cleanup'] == 'UNPROVEN'
    assert failed_cleanup == ['backend_dependency_cleanup:RuntimeError']
    assert foreign.read_text() == 'synthetic', 'foreign file must not be removed'
    foreign.unlink()  # exact file created by this synthetic test only
    assert launcher.cleanup_backend_dependencies(retained) == 'EXACT_OWNED_LINKS_AND_DIRECTORIES_REMOVED'
    assert not os.path.lexists(test_backend / 'node_modules')
    with (test_backend / 'package-lock.json').open('ab') as stream:
        stream.write(b' ')
    try:
        launcher.validate_backend_dependency_source(test_backend)
        raise AssertionError('changed source lock accepted')
    except ValueError as error:
        assert 'dependency lock changed' in str(error)
    wrong_stage = own / 'wrong-stage.json'
    launcher.private_json(wrong_stage, {**base_plan, 'stage': 'current-manager-220'})
    try:
        launcher.load_plan(wrong_stage, launcher.digest(wrong_stage))
        raise AssertionError('unapproved stage accepted')
    except ValueError as error:
        assert 'exact manager 218/219 browser profiles' in str(error)

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

    # The fallback may touch only a fresh, exact synthetic process marker plus
    # the matching PID birth/boot/UID/executable. No browser or lease is used.
    marker = secrets.token_hex(16)
    marked_env = {**os.environ, 'CUSTODIAL_RECURRING_BROWSER_RUN_ID': marker}
    owned = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'],
        env=marked_env, start_new_session=True)
    try:
        identity = launcher.read_process_identity(owned.pid)
        assert identity is not None and identity['uid'] == os.getuid()
        assert identity in launcher.exact_marked_processes(marker)
        sidecar = {**identity, 'runId': marker, 'stageParentPid': 222,
            'leaseParentPid': 111, 'production': False}
        wrong = {**sidecar, 'startTicks': '0'}
        try:
            launcher.stop_exact_marked_processes(marker, wrong, 222, 111)
            raise AssertionError('reused or mismatched PID identity accepted')
        except RuntimeError:
            assert owned.poll() is None
        try:
            launcher.stop_exact_marked_processes(marker, {**sidecar, 'runId': 'b' * 32}, 222, 111)
            raise AssertionError('foreign marker accepted')
        except RuntimeError:
            assert owned.poll() is None
        stopped = launcher.stop_exact_marked_processes(marker, sidecar, 222, 111)
        owned.wait(timeout=3)
        assert stopped['matched_before'] >= 1 and stopped['remaining'] == 0
        assert launcher.read_process_identity(owned.pid) is None
    finally:
        if owned.poll() is None:
            owned.terminate()
            owned.wait(timeout=3)

real_backend = SOURCE.parent.parent
before = subprocess.check_output(['git', 'status', '--porcelain'], cwd=real_backend, text=True)
assert not os.path.lexists(real_backend / 'node_modules')
previous_node_options = os.environ.get('NODE_OPTIONS')
previous_dotenv_path = os.environ.get('DOTENV_CONFIG_PATH')
os.environ['NODE_OPTIONS'] = '--invalid-test-only-node-option'
os.environ['DOTENV_CONFIG_PATH'] = '/definitely-not-this-test-dotenv-file'
try:
    real_layout = launcher.install_backend_dependencies(real_backend, clean=lambda: True)
finally:
    if previous_node_options is None:
        os.environ.pop('NODE_OPTIONS', None)
    else:
        os.environ['NODE_OPTIONS'] = previous_node_options
    if previous_dotenv_path is None:
        os.environ.pop('DOTENV_CONFIG_PATH', None)
    else:
        os.environ['DOTENV_CONFIG_PATH'] = previous_dotenv_path
try:
    assert len(real_layout['links']) == 5, 'actual reachable fixture package closure'
finally:
    assert launcher.cleanup_backend_dependencies(real_layout) == 'EXACT_OWNED_LINKS_AND_DIRECTORIES_REMOVED'
assert not os.path.lexists(real_backend / 'node_modules')
assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=real_backend, text=True) == before

source = SOURCE.read_text()
for required in ('BrowserLeaseClient()', 'client.acquire(', 'client.renew(',
        'client.check(', 'client.close_targets_and_release(',
        "['node', 'scripts/run-isolated-shift-end-tests.mjs', profile]",
        "'STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER': '1'",
        "'CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID': str(os.getpid())",
        "'scripts/fixtures/current-manager-219-source.mjs'",
        "'scripts/static-weekly-current-manager-219-manifest-tests.mjs'",
        'assertCurrentManager219MigrationSet();',
        'browser-stage-cleanup.json', 'owned_container_absent(child.pid)',
        'browser-process.json', 'stop_exact_marked_processes(',
        'install_backend_dependencies(backend, layout=dependency_layout)',
        'record_backend_dependency_cleanup(dependency_layout, receipt, failures)',
        "env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}",
        'child_process_group_absent', 'source-receipt.json'):
    assert required in source, required
print('PASS recurring browser lease launcher pure source, private receipt, and silent-child bound contracts')
