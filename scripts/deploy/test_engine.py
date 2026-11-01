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
    def preflight(self): self.act('preflight')
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
    def test_preflight_failure_never_stops_app_or_leaves_transaction(self):
        with tempfile.TemporaryDirectory() as folder:
            host = Host('preflight'); runner = engine.Deployer(Path(folder), host)
            result = runner.run(SHA)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['failure']['phase'], 'preflight')
            self.assertNotIn('stop', host.events)
            self.assertFalse(runner.transaction.exists())

    def test_partial_stop_failure_resumes_old_app_without_repeating_stop(self):
        result, host = self.execute(Host('stop'))
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(host.events.count('stop'), 1)
        self.assertIn('start', host.events); self.assertIn('resume', host.events)
        self.assertNotIn('restore_db', host.events); self.assertNotIn('switch', host.events)
        self.assertEqual(result['failure']['phase'], 'stop')

    def test_recovery_stop_failure_never_restores_database_and_records_safe_reason(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            host = Host('stop'); runner = engine.Deployer(Path(folder), host)
            runner.save({'sha': SHA, 'old': OLD, 'phase': 'migrating', 'timers': []})
            result = runner.run(SHA)
            self.assertEqual(result['status'], 'recovery-required')
            self.assertEqual(result['failure']['phase'], 'recovery-stop')
            self.assertNotIn('restore_db', host.events)
            self.assertTrue(runner.transaction.exists())
            host.fail = None
            self.assertEqual(runner.run(SHA)['status'], 'success')

    def test_failure_diagnostics_never_contain_exception_or_command_output(self):
        import json
        for operation in ('prepare', 'migrate', 'health'):
            host = Host()
            def fail(*args): raise RuntimeError('SECRET=private-user-value')
            setattr(host, operation, fail)
            result, _ = self.execute(host)
            self.assertIn('failure', result)
            self.assertNotIn('SECRET', json.dumps(result))
            self.assertNotIn('private-user-value', json.dumps(result))

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

    def test_retry_after_recovery_restart_preserves_new_writes(self):
        for failure in ('health', 'resume'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                host = Host(failure)
                def restore(_):
                    host.act('restore_db')
                    host.rows = ['saved item']
                def start():
                    host.act('start')
                    host.rows.append('write accepted by recovered app')
                host.restore_db, host.start = restore, start
                runner = engine.Deployer(Path(folder), host)
                runner.save({'sha': SHA, 'old': OLD, 'phase': 'migrating', 'timers': ['prices']})
                with self.assertRaises(RuntimeError): runner.recover()
                host.fail = None
                runner.recover()
                self.assertEqual(host.events.count('restore_db'), 1)
                self.assertEqual(host.rows.count('write accepted by recovered app'), 2)

    def test_failed_recovery_checkpoint_does_not_restart_writers(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            host = Host()
            runner = engine.Deployer(Path(folder), host)
            runner.save({'sha': SHA, 'old': OLD, 'phase': 'migrating', 'timers': []})
            with patch.object(runner, 'save', side_effect=OSError('disk unavailable')):
                with self.assertRaises(OSError): runner.recover()
            self.assertIn('restore_db', host.events)
            self.assertNotIn('start', host.events)
            self.assertNotIn('resume', host.events)

class SqliteTests(unittest.TestCase):
    def test_recovery_retry_keeps_c_and_next_deployment_backs_it_up(self):
        import sqlite3
        from contextlib import closing
        for failure in ('health', 'resume'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                class HostWithSqlite(engine.LinuxHost):
                    current = OLD
                    failing = True
                    accepted_c = False
                    backups = []
                    def latest(self): return SHA
                    def active(self): return self.current
                    def preflight(self): pass
                    def prepare(self, sha): pass
                    def timers(self): return ['test.timer']
                    def stop(self): pass
                    def switch(self, sha): self.current = sha
                    def start(self):
                        # A real write accepted after the old app is restarted.
                        if not self.accepted_c:
                            with closing(sqlite3.connect(self.db)) as db, db:
                                db.execute("INSERT INTO items VALUES ('C')")
                            self.accepted_c = True
                    def health(self, sha):
                        if self.failing and failure == 'health': raise RuntimeError('health interrupted')
                    def resume(self, timers):
                        if self.failing and failure == 'resume': raise RuntimeError('timer restart interrupted')
                    def backup(self, tx):
                        super().backup(tx)
                        self.backups.append(self.backup_path(tx))
                    def migrate(self, sha):
                        with closing(sqlite3.connect(self.db)) as db, db:
                            db.execute('CREATE TABLE IF NOT EXISTS new_table(value TEXT)')
                host = HostWithSqlite({'state': str(root), 'releases': str(root),
                    'current': str(root/'current'), 'node': '/unused', 'database': str(root/'app.db')})
                with closing(sqlite3.connect(host.db)) as db, db:
                    db.execute('PRAGMA journal_mode=WAL')
                    db.execute('CREATE TABLE items(name TEXT PRIMARY KEY)')
                    db.executemany('INSERT INTO items VALUES (?)', [('A',), ('B',)])
                tx = {'id': 'first-deployment', 'sha': SHA, 'old': OLD, 'phase': 'migrating', 'timers': ['test.timer']}
                host.backup(tx)
                runner = engine.Deployer(root, host); runner.save(tx)
                with self.assertRaises(RuntimeError): runner.recover()
                host.failing = False
                runner.recover()
                def contents(path):
                    with closing(sqlite3.connect(path)) as db:
                        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                        return db.execute('SELECT name FROM items ORDER BY name').fetchall()
                self.assertEqual(contents(host.db), [('A',), ('B',), ('C',)])
                self.assertEqual(runner.run(SHA)['status'], 'success')
                self.assertEqual(len(host.backups), 2)
                self.assertNotEqual(host.backups[0], host.backups[1])
                self.assertEqual(contents(host.backups[0]), [('A',), ('B',)])
                self.assertEqual(contents(host.backups[1]), [('A',), ('B',), ('C',)])
                self.assertEqual(contents(host.db), [('A',), ('B',), ('C',)])

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
    def test_initial_and_switch_require_shared_database_and_uploads(self):
        install = self.load('install')
        cases = ('valid', 'valid_quoted', 'missing_env', 'regular_env', 'wrong_env', 'wrong_database',
                 'shadow_database', 'export_database', 'multiline_database',
                 'missing_uploads', 'regular_uploads', 'wrong_uploads')
        for entry in ('install', 'switch'):
            for case in cases:
                with self.subTest(entry=entry, case=case), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder).resolve()
                    release = root/SHA; (release/'.next').mkdir(parents=True)
                    (release/'.next/BUILD_ID').write_text('built')
                    (release/'RELEASE_SHA').write_text(SHA)
                    (release/'public').mkdir()
                    uploads = root/'shared-uploads'; uploads.mkdir()
                    db = root/'shared.sqlite'; db.touch()
                    env = root/'app.env'; env.write_text('BUTUYOKUOH_DB_PATH='+str(db)+'\n')
                    env_link=release/'.env.local'; env_link.symlink_to(env)
                    upload_link=release/'public/uploads'; upload_link.symlink_to(uploads)
                    if case in ('missing_env', 'regular_env', 'wrong_env'):
                        env_link.unlink()
                        if case=='regular_env': env_link.write_text(env.read_text())
                        if case=='wrong_env':
                            other=root/'wrong.env'; other.write_text(env.read_text()); env_link.symlink_to(other)
                    if case=='wrong_database': env.write_text('BUTUYOKUOH_DB_PATH='+str(root/'other.sqlite')+'\n')
                    if case=='valid_quoted': env.write_text('BUTUYOKUOH_DB_PATH="'+str(db)+'"\nEXAMPLE=\'a value\'\n')
                    if case=='shadow_database': env.write_text(env.read_text()+' BUTUYOKUOH_DB_PATH='+str(root/'other.sqlite')+'\n')
                    if case=='export_database': env.write_text(env.read_text()+'export BUTUYOKUOH_DB_PATH='+str(root/'other.sqlite')+'\n')
                    if case=='multiline_database': env.write_text('EXAMPLE="\nBUTUYOKUOH_DB_PATH='+str(db)+'\n"\n')
                    if case in ('missing_uploads', 'regular_uploads', 'wrong_uploads'):
                        upload_link.unlink()
                        if case=='regular_uploads': upload_link.mkdir()
                        if case=='wrong_uploads':
                            other=root/'wrong-uploads'; other.mkdir(); upload_link.symlink_to(other)
                    current=root/'current'; current.symlink_to(release if entry=='install' else root/OLD)
                    original=current.readlink()
                    config={'state':str(root), 'releases':str(root), 'current':str(current),
                            'node':'/unused', 'database':str(db), 'env_file':str(env),
                            'uploads':str(uploads), 'initial_release':str(release)}
                    def check():
                        if entry=='install': install.validate_initial(config)
                        else: engine.LinuxHost(config).switch(SHA)
                    if case in ('valid', 'valid_quoted', 'wrong_database', 'shadow_database', 'export_database', 'multiline_database'): check()
                    else:
                        with self.assertRaises((ValueError, RuntimeError, OSError)): check()
                        self.assertEqual(current.readlink(), original)
    def test_startup_pins_db_for_web_and_workers_despite_environment_contents(self):
        import json, os, shutil, subprocess, shlex
        node = shutil.which('node')
        self.assertIsNotNone(node)
        for content in ('BUTUYOKUOH_DB_PATH=/wrong\n',
                        'EXAMPLE=x\x0bBUTUYOKUOH_DB_PATH=/phantom\n',
                        'EXAMPLE="\nBUTUYOKUOH_DB_PATH=/phantom\n"\n',
                        'BUTUYOKUOH_DB_PATH=/wrong\nexport BUTUYOKUOH_DB_PATH=/other\n'):
            with tempfile.TemporaryDirectory() as folder:
                root=Path(folder).resolve(); env=root/'app.env'; env.write_text(content)
                config={'database':str(root/'shared.sqlite'), 'node':node, 'current':str(root),
                        'service':'web', 'env_file':str(env), 'port':8000,
                        'writer_scripts':{'worker':'check-prices.ts'}}
                commands=engine.startup_commands(config)
                for service, command in commands.items():
                    prefix=shlex.split(command)[:3]  # env, explicit DB, node
                    self.assertEqual(Path(prefix[0]).name, 'env')
                    args=[*prefix, '--env-file='+str(env)]
                    # Exercise Node's parser and the actual Next.js env loader used by web.
                    code="console.log(process.env.BUTUYOKUOH_DB_PATH)"
                    if service=='web':
                        code="require('@next/env').loadEnvConfig(process.cwd());"+code
                    output=subprocess.check_output([*args, '-e', code], env={**os.environ,
                        'BUTUYOKUOH_DB_PATH':'/inherited-wrong'}, text=True)
                    self.assertEqual(output.strip().splitlines()[-1], config['database'])

    def test_missing_unit_or_sudo_permission_fails_before_any_stop(self):
        for failure in ('not-found', 'permission'):
            with self.subTest(failure=failure):
                class Probe(engine.LinuxHost):
                    calls=[]
                    def command(self, args, **options):
                        self.calls.append(args)
                        if '--property=LoadState' in args:
                            return 'not-found' if failure=='not-found' else 'loaded'
                        if '-l' in args: raise RuntimeError('permission denied')
                        if any(x.startswith('--property=RefuseManual') for x in args): return 'no'
                        return ''
                host=Probe({'state':'/unused','releases':'/unused','current':'/unused',
                            'node':'/unused','database':'/unused','service':'web',
                            'timers':['worker.timer'],'writers':['worker']})
                with self.assertRaises(RuntimeError): host.check_units(check_startup=False)
                self.assertFalse(any('stop' in call and '-l' not in call for call in host.calls))

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
