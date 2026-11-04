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

    def test_corrupt_result_aborts_before_any_deletion(self):
        shas = [self.release(n) for n in range(1, 6)]
        self.activate(shas[-1])
        (self.state / 'results' / (shas[1] + '.json')).write_text('{')
        with self.assertRaises(engine.SafeFailure): self.host.prune_releases(apply=True)
        self.assertEqual(self.names(), shas)

    def test_retention_for_each_active_generation_and_count(self):
        # Exhaust the boundary cases, including rollback to an older active SHA.
        for count in range(1, 8):
            for active in range(1, count + 1):
                with self.subTest(count=count, active=active):
                    with tempfile.TemporaryDirectory() as directory:
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
