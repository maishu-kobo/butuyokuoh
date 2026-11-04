import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('engine', Path(__file__).with_name('engine.py'))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(engine.time, 'time', return_value=1000000)
        clock.start()
        self.addCleanup(clock.stop)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.releases = self.root / 'releases'
        self.releases.mkdir()
        self.state = self.root / 'state'
        (self.state / 'results').mkdir(parents=True)
        (self.state / 'backups').mkdir()
        (self.state / 'backups' / 'saved.sqlite').write_text('backup')
        self.db = self.root / 'app.sqlite'
        self.db.write_text('live database')
        self.env = self.root / 'app.env'
        self.env.write_text('private config')
        self.uploads = self.root / 'uploads'
        self.uploads.mkdir()
        (self.uploads / 'photo').write_text('user image')
        self.config = dict(state=str(self.state), releases=str(self.releases),
                           current=str(self.releases / 'current'), node='/unused',
                           database=str(self.db), env_file=str(self.env), uploads=str(self.uploads))
        self.host = engine.LinuxHost(self.config)

    def release(self, n, status='success'):
        sha = f'{n:040x}'
        p = self.releases / sha
        p.mkdir()
        (p / 'RELEASE_SHA').write_text(sha)
        (p / '.next').mkdir()
        (p / '.next' / 'BUILD_ID').write_text('built')
        (p / 'public').mkdir()
        (p / 'public' / 'uploads').symlink_to(self.uploads)
        (p / '.env.local').symlink_to(self.env)
        (p / 'payload').write_text('built code')
        (self.state / 'results' / (sha + '.json')).write_text(json.dumps(
            dict(sha=sha, status=status, at=n)))
        return sha

    def activate(self, sha):
        current = Path(self.config['current'])
        current.unlink(missing_ok=True)
        current.symlink_to(self.releases / sha)

    def names(self):
        return sorted(p.name for p in self.releases.iterdir() if p.is_dir() and not p.is_symlink())

    def test_dry_run_keeps_current_and_two_most_recent_successes(self):
        shas = [self.release(n) for n in range(1, 7)]
        self.activate(shas[0])  # Active may be older than the latest result.
        plan = self.host.prune_releases()
        self.assertEqual(set(plan['keep']), {shas[0], shas[4], shas[5]})
        self.assertEqual(set(plan['remove']), set(shas[1:4]))
        self.assertEqual(self.names(), shas)

    def test_apply_is_idempotent_and_preserves_all_shared_data_and_results(self):
        shas = [self.release(n) for n in range(1, 7)]
        self.activate(shas[-1])
        results = {p.name: p.read_bytes() for p in (self.state / 'results').iterdir()}
        self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas[-3:])
        self.assertEqual(self.host.prune_releases(apply=True)['remove'], [])
        self.assertEqual(self.db.read_text(), 'live database')
        self.assertEqual(self.env.read_text(), 'private config')
        self.assertEqual((self.uploads / 'photo').read_text(), 'user image')
        self.assertEqual((self.state / 'backups' / 'saved.sqlite').read_text(), 'backup')
        self.assertEqual(results, {p.name: p.read_bytes() for p in (self.state / 'results').iterdir()})

    def test_pending_transaction_prevents_even_partial_cleanup(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        (self.state / 'transaction.json').write_text('{}')
        with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_target_and_immediate_previous_release_can_be_protected(self):
        shas = [self.release(n) for n in range(1, 7)]
        self.activate(shas[-1])
        self.host.prune_releases(apply=True, protected=[shas[0]])
        self.assertEqual(self.names(), [shas[0], shas[-2], shas[-1]])

    def test_failed_build_does_not_displace_a_successful_generation(self):
        shas = [self.release(n) for n in range(1, 5)]
        failed = self.release(5, 'rolled-back')
        self.activate(shas[-1])
        self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas[-3:])
        self.assertFalse((self.releases / failed).exists())

    def test_initial_release_survives_after_success_without_per_sha_result(self):
        old = self.release(1)
        (self.state / 'results' / (old + '.json')).unlink()
        self.activate(old)
        self.host.prune_releases(apply=True)
        current = self.release(2)
        self.activate(current)
        self.host.prune_releases(apply=True, protected=[old])
        self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), [old, current])

    def test_success_history_survives_result_reset_and_superseded_retry(self):
        shas = [self.release(n) for n in range(1, 4)]
        self.activate(shas[-1])
        self.host.prune_releases(apply=True)
        (self.state / 'results' / (shas[0] + '.json')).unlink()
        (self.state / 'results' / (shas[1] + '.json')).write_text(json.dumps(
            dict(sha=shas[1], status='superseded', at=100)))
        self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_unmanaged_directories_and_symlink_targets_are_not_removed(self):
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        for name in ('notes', 'build-interrupted', 'f' * 40):
            (self.releases / name).mkdir()
            (self.releases / name / 'evidence').write_text('preserve')
        link = self.releases / ('e' * 40)
        link.symlink_to(self.uploads)
        self.host.prune_releases(apply=True)
        self.assertTrue(link.is_symlink())
        for name in ('notes', 'build-interrupted', 'f' * 40):
            self.assertEqual((self.releases / name / 'evidence').read_text(), 'preserve')
        self.assertEqual((self.uploads / 'photo').read_text(), 'user image')

    def test_symlinked_release_marker_is_not_managed(self):
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        marker = self.releases / shas[0] / 'RELEASE_SHA'
        outside = self.root / 'marker'
        outside.write_text(shas[0])
        marker.unlink(); marker.symlink_to(outside)
        self.host.prune_releases(apply=True)
        self.assertTrue(marker.is_symlink())

    def test_persistent_storage_inside_release_root_aborts_all_deletion(self):
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        for key in ('database', 'uploads', 'env_file', 'state'):
            with self.subTest(key=key):
                config = {**self.config, key: str(self.releases / shas[0] / 'payload')}
                with self.assertRaises(engine.SafeFailure):
                    engine.LinuxHost(config).prune_releases(apply=True)
                self.assertEqual(self.names(), shas)

    def test_bad_current_identity_aborts_all_deletion(self):
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        (self.releases / shas[-1] / 'RELEASE_SHA').write_text(shas[0])
        with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_mount_beneath_candidate_aborts_before_any_deletion(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        mounted = self.releases / shas[1] / '.next'
        with patch.object(engine.os.path, 'ismount', side_effect=lambda p: Path(p) == mounted):
            with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_bind_mount_beneath_candidate_aborts_before_any_deletion(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        with patch.object(engine, 'mounted_paths', return_value={self.releases / shas[1] / 'bound-data'}):
            with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def assert_shared_bind_mount_source_is_preserved(self, key):
        import os
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        original_stat = os.stat
        source = self.releases / shas[1] / ('.next' if key in ('uploads', 'state') else 'payload')
        # A bind mount exposes the source inode at an outside path;
        # resolve() still reports the outside path, not its source.
        def stat(path, *args, **kwargs):
            if Path(path) == Path(self.config[key]):
                return original_stat(source, *args, **kwargs)
            return original_stat(path, *args, **kwargs)
        with patch.object(engine.os, 'stat', side_effect=stat):
            with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_shared_upload_bind_source_is_preserved(self):
        self.assert_shared_bind_mount_source_is_preserved('uploads')

    def test_shared_database_bind_source_is_preserved(self):
        self.assert_shared_bind_mount_source_is_preserved('database')

    def test_shared_configuration_bind_source_is_preserved(self):
        self.assert_shared_bind_mount_source_is_preserved('env_file')

    def test_shared_state_bind_source_is_preserved(self):
        self.assert_shared_bind_mount_source_is_preserved('state')

    def assert_shared_child_bind_mount_source_is_preserved(self, key):
        import os
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        source = self.releases / shas[1] / '.next'
        target = Path(self.config[key]) / 'mounted-child'
        target.mkdir()
        original_stat = os.stat
        def stat(path, *args, **kwargs):
            return original_stat(source if Path(path) == target else path, *args, **kwargs)
        with patch.object(engine.os, 'stat', side_effect=stat), \
                patch.object(engine, 'mounted_paths', return_value={target}):
            with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_shared_upload_child_bind_source_is_preserved(self):
        self.assert_shared_child_bind_mount_source_is_preserved('uploads')

    def test_shared_state_child_bind_source_is_preserved(self):
        self.assert_shared_child_bind_mount_source_is_preserved('state')

    def test_missing_shared_resource_reports_safe_reason_without_deleting(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        self.db.unlink()
        with self.assertRaises(engine.SafeFailure) as raised:
            self.host.prune_releases(apply=True)
        self.assertEqual(raised.exception.reason, 'retention-persistent-storage-unavailable')
        self.assertEqual(self.names(), shas)

    def test_mountinfo_decodes_bind_mount_paths_with_spaces(self):
        text = '1 2 0:1 /source /releases/a\\040b/data rw - ext4 /dev/root rw\n'
        with patch.object(engine.sys, 'platform', 'linux'), patch.object(Path, 'read_text', return_value=text):
            self.assertEqual(engine.mounted_paths(), {Path('/releases/a b/data')})

    def test_missing_mountinfo_on_linux_aborts_cleanup(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        with patch.object(engine, 'mounted_paths', side_effect=engine.SafeFailure('retention-mount-information-unavailable')):
            with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_corrupt_result_aborts_before_any_deletion(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        (self.state / 'results' / (shas[1] + '.json')).write_text('{')
        with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_failed_build_removes_only_its_temporary_directory(self):
        from collections import namedtuple
        sha = self.release(1)
        self.activate(sha)
        self.config['home'] = str(self.root)
        host = engine.LinuxHost(self.config)
        usage = namedtuple('usage', 'total used free')(10**12, 0, 10**12)
        def failed_build(target, staging):
            (staging / 'partial').write_text('partial build')
            raise engine.SafeFailure('build-failed')
        with patch.object(host, 'command', return_value='22.23.4'), \
                patch.object(engine.shutil, 'disk_usage', return_value=usage), \
                patch.object(host, 'build_release', side_effect=failed_build):
            with self.assertRaises(engine.SafeFailure): host.prepare('f' * 40)
        self.assertEqual(self.names(), [sha])
        self.assertEqual(self.db.read_text(), 'live database')

    def test_prune_cli_refuses_deployment_lock(self):
        import fcntl
        import os
        import pwd
        import subprocess
        import sys
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        config = self.root / 'config.json'
        config.write_text(json.dumps({**self.config, 'user': pwd.getpwuid(os.geteuid()).pw_name}))
        with (self.state / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('engine.py')),
                                     'prune', '--apply', '--config', str(config)],
                                    capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)['reason'], 'deployment-lock-busy')
        self.assertEqual(self.names(), shas)

    def test_prune_cli_reports_safe_failure_reason(self):
        import os
        import pwd
        import subprocess
        import sys
        sha = self.release(1)
        self.activate(sha)
        (self.state / 'transaction.json').write_text('{}')
        config = self.root / 'config.json'
        config.write_text(json.dumps({**self.config, 'user': pwd.getpwuid(os.geteuid()).pw_name}))
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('engine.py')),
                                 'prune', '--apply', '--config', str(config)],
                                capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {'status': 'failed', 'reason': 'retention-pending-transaction'})

    def test_install_rejects_symlinked_release_layouts(self):
        spec = importlib.util.spec_from_file_location('install', Path(__file__).with_name('install.py'))
        install = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(install)
        sha = self.release(1)
        self.activate(sha)
        config = {**self.config, 'initial_release': str(self.releases / sha)}
        alias = self.root / 'release-alias'
        alias.symlink_to(self.releases)
        with self.assertRaises(ValueError):
            install.validate_initial({**config, 'releases': str(alias)})
        release = self.releases / sha
        actual = self.root / 'actual-release'
        release.rename(actual)
        release.symlink_to(actual)
        with self.assertRaises(ValueError): install.validate_initial(config)

    def test_prune_cli_defaults_to_preview_and_apply_keeps_three(self):
        import os
        import pwd
        shas = [self.release(n) for n in range(1, 5)]
        self.activate(shas[-1])
        config = self.root / 'config.json'
        config.write_text(json.dumps({**self.config, 'user': pwd.getpwuid(os.geteuid()).pw_name}))
        args = ['engine.py', 'prune', '--config', str(config)]
        with patch('sys.argv', args), patch('builtins.print'):
            self.assertEqual(engine.main(), 0)
        self.assertEqual(self.names(), shas)
        with patch('sys.argv', [*args, '--apply']), patch('builtins.print'):
            self.assertEqual(engine.main(), 0)
        self.assertEqual(self.names(), shas[-3:])

    def test_retention_for_each_active_generation_and_count(self):
        # Exhaust the boundary cases, including rollback to an older active SHA.
        for count in range(1, 8):
            for active in range(1, count + 1):
                with self.subTest(count=count, active=active):
                    with tempfile.TemporaryDirectory() as directory:
                        (self.state / 'release-history.json').unlink(missing_ok=True)
                        previous = self.config['releases'], self.config['current']
                        self.config['releases'] = directory
                        self.config['current'] = str(Path(directory) / 'current')
                        old_releases = self.releases
                        self.releases = Path(directory)
                        shas = [self.release(n) for n in range(1, count + 1)]
                        self.activate(shas[active - 1])
                        engine.LinuxHost(self.config).prune_releases(apply=True)
                        kept = self.names()
                        self.assertEqual(len(kept), min(3, count))
                        self.assertIn(shas[active - 1], kept)
                        expected = {shas[active - 1]}
                        expected.update([s for s in reversed(shas) if s not in expected][:2])
                        self.assertEqual(set(kept), expected)
                        self.releases = old_releases
                        self.config['releases'], self.config['current'] = previous


if __name__ == '__main__': unittest.main()
