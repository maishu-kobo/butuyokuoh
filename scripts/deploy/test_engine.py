import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('engine', Path(__file__).with_name('engine.py'))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

SHA = 'a' * 40
OLD = 'b' * 40

class Host:
    def __init__(self, fail=None):
        self.events = []
        self.current = OLD
        self.tip = SHA
        self.fail = fail
        self.rows = ['saved item']
    def latest(self): return self.tip
    def active(self): return self.current
    def act(self, event):
        self.events.append(event)
        if self.fail == event: raise RuntimeError(event)
    def prepare(self, sha): self.act('prepare')
    def timers(self): return ['prices']
    def stop(self): self.act('stop')
    def backup(self, tx): self.act('backup')
    def migrate(self, sha): self.act('migrate')
    def validate(self, tx): self.act('validate')
    def restore_db(self, tx): self.act('restore_db')
    def switch(self, sha): self.current = sha; self.act('switch')
    def start(self): self.act('start')
    def health(self, sha):
        self.act('health')
        if self.fail == 'new-health' and sha == SHA:
            self.rows.append('write after startup')
            raise RuntimeError('unhealthy')
    def resume(self, timers): self.act('resume')

class DeployTests(unittest.TestCase):
    def execute(self, host):
        with tempfile.TemporaryDirectory() as folder:
            runner = engine.Deployer(Path(folder), host)
            return runner.run(SHA), host
    def test_success_preserves_data(self):
        result, host = self.execute(Host())
        self.assertEqual(result['status'], 'success')
        self.assertEqual(host.rows, ['saved item'])
        self.assertLess(host.events.index('backup'), host.events.index('migrate'))
        self.assertLess(host.events.index('validate'), host.events.index('start'))
    def test_build_failure_does_not_stop_old_app(self):
        result, host = self.execute(Host('prepare'))
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('stop', host.events)
        self.assertEqual(host.current, OLD)
    def test_stale_sha_and_repeat_are_noops(self):
        host = Host(); host.tip = OLD
        self.assertEqual(self.execute(host)[0]['status'], 'superseded')
        self.assertEqual(host.events, [])
        host = Host(); host.current = SHA
        self.assertEqual(self.execute(host)[0]['status'], 'already-deployed')
    def test_migration_failure_restores_backup_before_old_app(self):
        result, host = self.execute(Host('migrate'))
        self.assertEqual(result['status'], 'rolled-back')
        self.assertIn('restore_db', host.events)
        self.assertEqual(host.current, OLD)
    def test_health_failure_keeps_new_writes_and_returns_old_code(self):
        result, host = self.execute(Host('new-health'))
        self.assertEqual(result['status'], 'rolled-back')
        self.assertNotIn('restore_db', host.events)
        self.assertIn('write after startup', host.rows)
        self.assertEqual(host.current, OLD)
    def test_main_advancing_during_build_does_not_switch(self):
        host = Host()
        def prepare(_): host.act('prepare'); host.tip = OLD
        host.prepare = prepare
        result, host = self.execute(host)
        self.assertEqual(result['status'], 'superseded')
        self.assertNotIn('stop', host.events)
    def test_interrupted_activation_recovers_without_restoring_data(self):
        with tempfile.TemporaryDirectory() as folder:
            host = Host(); host.current = SHA
            runner = engine.Deployer(Path(folder), host)
            runner.save({'sha': SHA, 'old': OLD, 'phase': 'activating', 'timers': ['prices']})
            runner.recover()
            self.assertEqual(host.current, OLD)
            self.assertNotIn('restore_db', host.events)
            self.assertFalse(runner.transaction.exists())
    def test_unrecoverable_state_stays_for_operator(self):
        with tempfile.TemporaryDirectory() as folder:
            host = Host('start')
            runner = engine.Deployer(Path(folder), host)
            runner.save({'sha': SHA, 'old': OLD, 'phase': 'validated', 'timers': []})
            with self.assertRaises(RuntimeError): runner.recover()
            self.assertTrue(runner.transaction.exists())

class SqliteTests(unittest.TestCase):
    def test_additive_schema_passes_and_changed_column_is_rejected(self):
        import sqlite3
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)')
            old = engine.schema(db)
            db.execute('ALTER TABLE items ADD COLUMN memo TEXT')
            db.execute('CREATE TABLE tokens(id INTEGER PRIMARY KEY)')
            engine.validate_additive(old, engine.schema(db))
            db.execute('ALTER TABLE items RENAME COLUMN name TO title')
            with self.assertRaises(RuntimeError): engine.validate_additive(old, engine.schema(db))
    def test_backup_captures_wal_and_restore_keeps_existing_rows(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            host = engine.LinuxHost({'state': str(root), 'releases': str(root),
                'current': str(root/'current'), 'node': '/unused', 'database': str(root/'app.db')})
            tx = {'id': 'fixture'}
            with sqlite3.connect(host.db) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE items(name TEXT)')
                db.execute("INSERT INTO items VALUES ('keep')"); db.commit()
                host.backup(tx)
                db.execute('DELETE FROM items'); db.commit()
                host.restore_db(tx)
                self.assertEqual(db.execute('SELECT * FROM items').fetchall(), [('keep',)])
    def test_constraint_change_and_row_loss_are_rejected(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            host = engine.LinuxHost({'state': str(root), 'releases': str(root),
                'current': str(root/'current'), 'node': '/unused', 'database': str(root/'app.db')})
            tx = {'id': 'fixture'}
            with sqlite3.connect(host.db) as db:
                db.execute('CREATE TABLE items(name TEXT)')
                db.execute("INSERT INTO items VALUES ('keep')"); db.commit()
                host.backup(tx)
                db.execute('DELETE FROM items'); db.commit()
                with self.assertRaises(RuntimeError): host.validate(tx)
                host.restore_db(tx)
                db.execute('DROP TABLE items')
                db.execute('CREATE TABLE items(name TEXT CHECK(length(name)<5))')
                db.execute("INSERT INTO items VALUES ('keep')"); db.commit()
                with self.assertRaises(RuntimeError): host.validate(tx)
    def test_declared_constraints_with_quoted_commas_are_preserved(self):
        import sqlite3
        with sqlite3.connect(':memory:') as db:
            db.execute("CREATE TABLE x(name TEXT CHECK(name != 'a,b'))")
            prior = engine.schema(db)
            db.execute('ALTER TABLE x ADD COLUMN memo TEXT')
            engine.validate_additive(prior, engine.schema(db))
    def test_bad_sha_cannot_reach_host(self):
        with tempfile.TemporaryDirectory() as folder:
            host = Host()
            with self.assertRaises(ValueError): engine.Deployer(Path(folder), host).run('main;id')
            self.assertEqual(host.events, [])

class EntryPointTests(unittest.TestCase):
    def load(self, name):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
    def test_installer_rejects_existing_wrong_current_before_changes(self):
        install = self.load('install')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); initial = root / SHA; initial.mkdir()
            (initial/'RELEASE_SHA').write_text(SHA)
            (initial/'.next').mkdir(); (initial/'.next'/'BUILD_ID').write_text('built')
            current = root/'current'; current.symlink_to(root/'wrong')
            with self.assertRaises(ValueError):
                install.validate_initial({'initial_release': str(initial), 'current': str(current), 'releases': str(root)})
    def test_installer_never_follows_state_result_symlink(self):
        import os
        install = self.load('install')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve(); target = root/'protected'; target.mkdir()
            before = target.stat()
            link = root/'results'; link.symlink_to(target)
            with self.assertRaises(OSError): install.owned_directory(link, os.getuid(), os.getgid())
            after = target.stat()
            self.assertEqual((before.st_uid, before.st_gid, before.st_mode), (after.st_uid, after.st_gid, after.st_mode))
    def test_root_execution_is_rejected_before_deployment(self):
        import json
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder)/'config.json'; config.write_text(json.dumps({'user': 'root'}))
            with patch('sys.argv', ['engine.py', 'run', SHA, '--config', str(config)]), patch.object(engine.os, 'geteuid', return_value=0):
                with self.assertRaises(RuntimeError): engine.main()
    def test_gateway_uses_app_user_and_post_stop_recovery(self):
        import json
        from unittest.mock import patch
        from types import SimpleNamespace
        request = self.load('request')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root/'results').mkdir()
            config=root/'config'; config.write_text(json.dumps({'state': folder, 'user': 'exedev'}))
            with patch.object(request.subprocess, 'run', return_value=SimpleNamespace(returncode=1)) as run:
                request.main(['start', SHA], str(config))
                command = run.call_args_list[-1].args[0]
                self.assertIn('--uid=exedev', command)
                self.assertIn('--property=ExecStopPost=/usr/bin/python3 /opt/butuyokuoh-deploy/engine.py recover-online', command)
                self.assertIn('--property=KillMode=control-group', command)
    def test_online_recovery_starts_old_app_but_offline_rejects_live_writers(self):
        import json, os, pwd
        from unittest.mock import patch
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); config=root/'config'
            config.write_text(json.dumps({'state': folder, 'user': pwd.getpwuid(os.getuid()).pw_name,
                                          'service': 'web', 'writers': ['worker']}))
            tx={'sha': SHA, 'old': OLD, 'phase': 'activating', 'timers': []}
            host=Host(); runner=engine.Deployer(root,host); runner.save(tx)
            with patch.object(engine, 'LinuxHost', return_value=host), patch('sys.argv', ['engine.py','recover-online','--config',str(config)]):
                self.assertEqual(engine.main(), 0)
            self.assertIn('start',host.events); self.assertIn('health',host.events)
            runner.save(tx)
            with patch.object(engine, 'LinuxHost', return_value=host), patch('sys.argv', ['engine.py','recover','--config',str(config)]), patch.object(engine.subprocess,'run', return_value=SimpleNamespace(returncode=0)):
                with self.assertRaises(RuntimeError): engine.main()
            self.assertTrue(runner.transaction.exists())

if __name__ == '__main__': unittest.main()
