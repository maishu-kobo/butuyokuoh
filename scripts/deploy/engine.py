#!/usr/bin/env python3
"""Host-installed deployment coordinator. Code/configuration are root-owned; execution/state use the application user.
Build/migration run as the app user. Never print subprocess output containing secrets.
"""
import argparse
from collections import Counter
import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

SHA_RE = re.compile(r'[0-9a-f]{40}')
RELEASES_TO_KEEP = 3


def mounted_paths():
    # ismount() misses same-device bind mounts on Linux. mountinfo describes
    # these too; octal escapes protect whitespace in the mountpoint field.
    if not sys.platform.startswith('linux'): return set()
    try:
        lines = Path('/proc/self/mountinfo').read_text().splitlines()
        return {Path(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), line.split()[4]))
                for line in lines}
    except (OSError, IndexError):
        raise SafeFailure('retention-mount-information-unavailable') from None


class SafeFailure(RuntimeError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


class CommandFailure(SafeFailure):
    def __init__(self, reason, returncode=None):
        self.reason, self.returncode = reason, returncode
        super().__init__(reason)


def startup_commands(c):
    # env runs AFTER systemd has loaded EnvironmentFile. Node --env-file and
    # Next.js preserve this explicit process value; dotenv is not a DB authority.
    prefix = f"/usr/bin/env BUTUYOKUOH_DB_PATH={c['database']} {c['node']}"
    commands = {c['service']: f"{prefix} {c['current']}/node_modules/next/dist/bin/next start --port {c['port']}"}
    for name, script in c['writer_scripts'].items():
        commands[name] = f"{prefix} --env-file={c['env_file']} --import=tsx scripts/{script}"
    return commands


def validate_release(release, config, sha):
    if not SHA_RE.fullmatch(sha) or (release / 'RELEASE_SHA').read_text().strip() != sha:
        raise SafeFailure('invalid-release-identity')
    if not (release / '.next' / 'BUILD_ID').is_file():
        raise SafeFailure('release-not-built')
    for relative, key in (('.env.local', 'env_file'), ('public/uploads', 'uploads')):
        link = release / relative
        if not link.is_symlink() or link.resolve(strict=True) != Path(config[key]).resolve(strict=True):
            raise SafeFailure('release-does-not-reference-shared-storage')
    if not Path(config['database']).is_absolute() or not Path(config['database']).is_file():
        raise SafeFailure('shared-db-unavailable')


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


class Deployer:
    def __init__(self, state, host):
        self.state, self.host = state, host
        self.transaction = state / 'transaction.json'

    def save(self, tx): atomic_json(self.transaction, tx)

    def step(self, phase, function, *args, **kwargs):
        self.phase = phase
        return function(*args, **kwargs)

    def failure(self, error):
        # Never serialize exception text, arguments, subprocess output or DB rows.
        failure = {'phase': self.phase, 'reason': 'operation-failed'}
        if isinstance(error, SafeFailure): failure['reason'] = error.reason
        if isinstance(error, CommandFailure):
            if error.returncode is not None: failure['exit_code'] = error.returncode
        elif isinstance(error, OSError):
            failure['reason'] = 'os-error'
            if error.errno is not None: failure['errno'] = error.errno
        return failure

    def remember_failure(self, failure):
        tx = json.loads(self.transaction.read_text())
        if 'failure' not in tx:
            # The gateway resets the per-SHA result on retry, so keep the first
            # cause with the durable transaction until recovery is complete.
            tx['failure'] = failure
            self.save(tx)
        return tx

    def recovery_failure_result(self, error):
        failure = self.failure(error)
        tx = self.remember_failure(failure)
        return self.result(tx['sha'], 'recovery-required', tx['failure'], failure)

    def recover(self, offline=False):
        if not self.transaction.exists(): return
        tx = json.loads(self.transaction.read_text())
        if tx['phase'] == 'stopping':
            # No backup/migration/switch has occurred. A partial stop failure must
            # not be repeated: the still-current old app can safely resume without
            # stopping live writers or restoring any DB.
            if self.step('recovery-active', self.host.active) != tx['old']:
                raise SafeFailure('unexpected-release-during-stopping')
            if not offline:
                self.step('recovery-start', self.host.start)
                self.step('recovery-health', self.host.health, tx['old'])
                self.step('recovery-timers', self.host.resume, tx['timers'])
            self.transaction.unlink()
            return
        if not offline: self.step('recovery-stop', self.host.stop)
        if tx['phase'] in ('backed-up', 'migrating'):
            self.step('recovery-restore', self.host.restore_db, tx)
        # Durable boundary BEFORE accepting writes. Retrying never restores again.
        tx['phase'] = 'recovering'
        self.step('recovery-checkpoint', self.save, tx)
        self.step('recovery-switch', self.host.switch, tx['old'])
        if not offline:
            self.step('recovery-start', self.host.start)
            self.step('recovery-health', self.host.health, tx['old'])
            self.step('recovery-timers', self.host.resume, tx['timers'])
        self.transaction.unlink()

    def run(self, sha):
        if not SHA_RE.fullmatch(sha): raise ValueError('invalid SHA')
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.state / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            tx = None
            self.phase = 'recovery'
            try:
                # Recovery failures are recorded too, including before a new tx.
                self.recover()
                if self.step('latest', self.host.latest) != sha: return self.result(sha, 'superseded')
                self.step('preflight', self.host.preflight)
                if self.step('active', self.host.active) == sha:
                    self.step('health', self.host.health, sha)
                    return self.success(sha, 'already-deployed')
                self.step('retention', self.host.prune_releases, apply=True, protected=[sha])
                self.step('prepare', self.host.prepare, sha)
                if self.step('latest', self.host.latest) != sha: return self.result(sha, 'superseded')
                # Recheck service configuration after a potentially lengthy build.
                self.step('preflight', self.host.preflight)
                tx = {'sha': sha, 'old': self.host.active(), 'phase': 'stopping',
                      'timers': self.host.timers(), 'id': f'{sha}-{time.time_ns()}'}
                self.step('checkpoint', self.save, tx)
                self.step('stop', self.host.stop)
                self.step('backup', self.host.backup, tx)
                tx['phase'] = 'backed-up'; self.step('checkpoint', self.save, tx)
                tx['phase'] = 'migrating'; self.step('checkpoint', self.save, tx)
                self.step('migrate', self.host.migrate, sha)
                self.step('validate', self.host.validate, tx)
                tx['phase'] = 'validated'; self.step('checkpoint', self.save, tx)
                if self.step('latest', self.host.latest) != sha:
                    self.recover()
                    return self.result(sha, 'superseded')
                tx['phase'] = 'activating'; self.step('checkpoint', self.save, tx)
                self.step('switch', self.host.switch, sha)
                self.step('start', self.host.start)
                self.step('health', self.host.health, sha)
                self.step('timers', self.host.resume, tx['timers'])
                self.transaction.unlink()
                return self.success(sha, 'success', previous=tx['old'])
            except Exception as error:
                failure = self.failure(error)
                if tx is None:
                    if self.transaction.exists():
                        recovered = self.recovery_failure_result(error)
                        if recovered['sha'] == sha: return recovered
                        return self.result(sha, 'recovery-required', failure)
                    return self.result(sha, 'failed', failure)
                try:
                    if self.transaction.exists(): self.remember_failure(failure)
                    self.recover()
                    return self.result(sha, 'rolled-back', failure)
                except Exception as recovery_error:
                    return self.result(sha, 'recovery-required', failure, self.failure(recovery_error))

    def success(self, sha, status, previous=None):
        result = self.result(sha, status)
        try:
            self.step('retention', self.host.prune_releases, apply=True,
                      protected=[previous] if previous else [])
        except Exception as error:
            # The app is already healthy and accepting writes. A housekeeping
            # failure must never trigger a rollback or erase its success record.
            result['retention_failure'] = self.failure(error)
            atomic_json(self.state / 'results' / f'{sha}.json', result)
        return result

    def result(self, sha, status, failure=None, recovery_failure=None):
        result = {'sha': sha, 'status': status, 'at': int(time.time())}
        if failure: result['failure'] = failure
        if recovery_failure: result['recovery_failure'] = recovery_failure
        atomic_json(self.state / 'results' / f'{sha}.json', result)
        return result


def table_parts(sql):
    # SQLite stores the original CREATE text. Split declarations without losing
    # quoted CHECK literals or nested expressions; reject unsupported rewrites.
    start = sql.index('(')
    depth, quote, begin, parts = 1, None, start + 1, []
    i = begin
    while i < len(sql):
        char = sql[i]
        if quote:
            if char == quote:
                if i + 1 < len(sql) and sql[i + 1] == quote: i += 1
                else: quote = None
        elif char in ("'", '"', '`'): quote = char
        elif char == '[': quote = ']'
        elif char == '(': depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                parts.append(sql[begin:i].strip())
                return parts, sql[i + 1:].strip()
        elif char == ',' and depth == 1:
            parts.append(sql[begin:i].strip()); begin = i + 1
        i += 1
    raise SafeFailure('unsupported-table-definition')


def existing_rows(connection, table, columns):
    quote = lambda name: '"' + name.replace('"', '""') + '"'
    cursor = connection.execute('SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(table))
    # Hashes stay in memory; no names/values are emitted or sent to GitHub.
    return Counter(hashlib.sha256(repr(tuple(row)).encode()).digest() for row in cursor)


def schema(connection):
    result = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        quoted = '"' + name.replace('"', '""') + '"'
        result[name] = {
            'columns': connection.execute(f'PRAGMA table_xinfo({quoted})').fetchall(),
            'foreign_keys': connection.execute(f'PRAGMA foreign_key_list({quoted})').fetchall(),
            'definition': table_parts(connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()[0]),
        }
    result['__objects__'] = connection.execute("SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') ORDER BY type,name").fetchall()
    return result


def validate_additive(before, after):
    for table, definition in before.items():
        if table == '__objects__':
            if not set(map(tuple, definition)).issubset(set(map(tuple, after[table]))):
                raise SafeFailure('existing-index-or-trigger-changed')
        elif table not in after or after[table]['columns'][:len(definition['columns'])] != definition['columns'] or after[table]['foreign_keys'] != definition['foreign_keys']:
            raise SafeFailure('non-additive-schema-migration')
        else:
            prior, prior_tail = definition['definition']
            current, current_tail = after[table]['definition']
            added_columns = len(after[table]['columns']) - len(definition['columns'])
            if Counter(prior) - Counter(current) or current_tail != prior_tail or len(current) - len(prior) != added_columns:
                raise SafeFailure('existing-table-constraints-changed')


class LinuxHost:
    def __init__(self, config):
        self.c = config
        self.state = Path(config['state'])
        self.releases = Path(config['releases'])
        self.current = Path(config['current'])
        self.node = config['node']
        self.db = Path(config['database'])

    def command(self, args, **options):
        timeout = options.pop('timeout', 120)
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, **options)
        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise CommandFailure('command-timeout') from None
        if process.returncode != 0: raise CommandFailure('command-exit', process.returncode)
        return output.decode().strip()

    def systemctl(self, *args): return self.command(['sudo', '-n', '/usr/bin/systemctl', *args])

    def property(self, name, prop):
        return self.command(['/usr/bin/systemctl', 'show', '--value', '--property='+prop, name])

    def check_units(self, check_startup=True, permission_user=None):
        services = [self.c['service'], *self.c['writers']]
        for name in [*services, *self.c['timers']]:
            if self.property(name, 'LoadState') != 'loaded': raise SafeFailure('unit-not-loaded')
            for prop in ('RefuseManualStart', 'RefuseManualStop'):
                if self.property(name, prop) != 'no': raise SafeFailure('unit-refuses-manual-control')
        prefix = ['sudo', '-u', permission_user] if permission_user else []
        operations = [('stop', self.c['timers']), ('stop', self.c['writers']),
                      ('stop', [self.c['service']]), ('start', [self.c['service']])]
        # sudo -l checks authorization without executing start/stop.
        operations += [('start', [name]) for name in self.c['timers']]
        for operation, names in operations:
            if names: self.command([*prefix, 'sudo', '-n', '-l', '/usr/bin/systemctl', operation, *names])
        if check_startup:
            for name, command in startup_commands(self.c).items():
                if f'argv[]={command} ;' not in self.property(name, 'ExecStart'):
                    raise SafeFailure('startup-db-binding-missing')
                if self.property(name, 'User') != self.c['user']:
                    raise SafeFailure('unexpected-runtime-user')
                if self.property(name, 'KillMode') != 'control-group':
                    raise SafeFailure('writer-process-group-not-controlled')

    def preflight(self):
        validate_release(self.current.resolve(strict=True), self.c, self.active())
        self.check_units()

    def latest(self):
        line = self.command(['git', 'ls-remote', self.c['repository'], self.c.get('ref', 'refs/heads/main')])
        sha = line.split()[0]
        if not SHA_RE.fullmatch(sha): raise SafeFailure('main-unavailable')
        return sha

    def active(self):
        sha = (self.current / 'RELEASE_SHA').read_text().strip()
        if not SHA_RE.fullmatch(sha): raise SafeFailure('active-release-unknown')
        return sha

    def prune_releases(self, apply=False, protected=()):
        """Caller holds the deployment lock. Default to a read-only plan."""
        root = self.releases.resolve(strict=True)
        if self.releases.is_symlink(): raise SafeFailure('retention-release-root-is-symlink')
        # Reject layouts where a release could own persistent storage. Symlinks
        # FROM releases to shared files outside this tree are safe to unlink.
        for key in ('state', 'database', 'uploads', 'env_file'):
            if Path(self.c[key]).resolve().is_relative_to(root):
                raise SafeFailure('retention-persistent-storage-inside-releases')
        if os.path.lexists(self.state / 'transaction.json'):
            raise SafeFailure('retention-pending-transaction')
        current = self.current.resolve(strict=True)
        active = self.active()
        if (not self.current.is_symlink() or current != root / active
                or (current / 'RELEASE_SHA').is_symlink()):
            raise SafeFailure('retention-active-release-mismatch')
        validate_release(current, self.c, active)
        if any(not SHA_RE.fullmatch(sha) for sha in protected):
            raise SafeFailure('retention-invalid-protected-sha')
        history_path = self.state / 'release-history.json'
        history = {}
        if os.path.lexists(history_path):
            try:
                if history_path.is_symlink(): raise ValueError()
                history = json.loads(history_path.read_text())
                if not isinstance(history, dict) or any(
                        not SHA_RE.fullmatch(sha) or type(at) is not int or at < 0
                        for sha, at in history.items()): raise ValueError()
            except (ValueError, TypeError):
                raise SafeFailure('retention-invalid-history') from None
        managed, unmanaged = {}, []
        for path in sorted(root.iterdir()):
            if path == self.current: continue
            marker = path / 'RELEASE_SHA'
            if (not SHA_RE.fullmatch(path.name) or path.is_symlink() or not path.is_dir()
                    or marker.is_symlink() or not marker.is_file()
                    or marker.read_text().strip() != path.name):
                unmanaged.append(path.name)
                continue
            result = self.state / 'results' / (path.name + '.json')
            rank = history.get(path.name, 0)
            if os.path.lexists(result):
                try:
                    if result.is_symlink(): raise ValueError()
                    data = json.loads(result.read_text())
                    if (data['sha'] != path.name or type(data['at']) is not int
                            or data['at'] < 0): raise ValueError()
                    if data['status'] in ('success', 'already-deployed'):
                        rank = max(rank, data['at'])
                except (ValueError, KeyError, TypeError):
                    raise SafeFailure('retention-invalid-result') from None
            managed[path.name] = rank
            if rank: history[path.name] = rank
        # Results are mutable (request.py clears them for a retry). Preserve a
        # separate success history, including an initial release with no result.
        history[active] = max(history.get(active, 0), int(time.time()))
        managed[active] = history[active]
        keep = {active, *(sha for sha in protected if sha in managed)}
        if len(keep) > RELEASES_TO_KEEP: raise SafeFailure('retention-too-many-protected-releases')
        # Only successful deployments are rollback generations. Incomplete or
        # unrecognized directories are reported separately, never guessed at.
        newest = sorted(managed, key=lambda sha: (managed[sha], sha), reverse=True)
        for sha in newest:
            if len(keep) >= RELEASES_TO_KEEP: break
            if managed[sha] > 0: keep.add(sha)
        remove = sorted(set(managed) - keep)
        # Validate every candidate BEFORE deleting anything. rmtree does not
        # follow symlinks; reject mounted data inside a release as well.
        mounts = mounted_paths()
        for sha in remove:
            if any(mount.is_relative_to(root / sha) for mount in mounts):
                raise SafeFailure('retention-mounted-storage')
            for directory, dirs, files in os.walk(root / sha, followlinks=False):
                for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
                    if not path.is_symlink() and os.path.ismount(path):
                        raise SafeFailure('retention-mounted-storage')
        plan = {'keep': sorted(keep), 'remove': remove, 'unmanaged': unmanaged}
        if apply:
            if not shutil.rmtree.avoids_symlink_attacks:
                raise SafeFailure('retention-safe-rmtree-required')
            atomic_json(history_path, history)
            for sha in remove: shutil.rmtree(root / sha)
        return plan

    def app(self, args, cwd, env=None, timeout=120):
        # No inherited API credentials; production .env is linked only AFTER build.
        environment = {'PATH': str(Path(self.node).parent) + ':/usr/bin:/bin',
                       'HOME': self.c['home'], 'NEXT_TELEMETRY_DISABLED': '1'}
        environment.update(env or {})
        return self.command(['env', '-i',
                             *[f'{key}={value}' for key, value in environment.items()], *args],
                            cwd=str(cwd), timeout=timeout)

    def prepare(self, sha):
        version = self.command([self.node, '-p', 'process.versions.node']).split('.')
        if tuple(map(int, version[:2])) < (22, 12): raise SafeFailure('node-22-12-required')
        for required in ('env_file', 'database', 'uploads'):
            if not Path(self.c[required]).exists(): raise SafeFailure('missing-persistent-configuration')
        if shutil.disk_usage(self.releases).free < self.c.get('minimum_free_bytes', 2 * 1024**3):
            raise SafeFailure('insufficient-free-space-after-retention')
        release = self.releases / sha
        # Never mutate an active or previously built release. Failed builds use
        # temporary storage and cannot accumulate another full dependency tree.
        if release.exists():
            validate_release(release, self.c, sha)
            return
        with tempfile.TemporaryDirectory(prefix=f'build-{sha[:8]}-', dir=self.releases) as folder:
            staging = Path(folder)
            self.build_release(sha, staging)
            os.rename(staging, release)

    def build_release(self, sha, staging):
        self.app(['git', 'clone', '--no-checkout', self.c['repository'], '.'], staging, timeout=300)
        self.app(['git', 'checkout', '--detach', sha], staging)
        if self.app(['git', 'rev-parse', 'HEAD'], staging) != sha: raise SafeFailure('checkout-mismatch')
        # Build has a separate writable DB and no production environment file.
        build_env = {'BUTUYOKUOH_DB_PATH': str(staging / 'build.sqlite'),
                     'PUPPETEER_CACHE_DIR': str(Path(self.c['home']) / '.cache' / 'puppeteer')}
        self.app(['npm', 'ci'], staging, build_env, timeout=900)
        self.app(['npm', 'rebuild', 'better-sqlite3'], staging, build_env, timeout=300)
        self.app([self.node, '--import', 'tsx', '-e',
                  "import('./src/lib/page-browser.ts').then(async m => {const b=await (m.launchPageBrowser || m.default.launchPageBrowser)(); await b.close()})"], staging, build_env)
        self.app(['npm', 'run', 'build'], staging, build_env, timeout=900)
        (staging / '.env.local').symlink_to(self.c['env_file'])
        # data may have been created by build; production always uses absolute DB path.
        (staging / 'public' / 'uploads').symlink_to(self.c['uploads'])
        (staging / 'RELEASE_SHA').write_text(sha + '\n')
        validate_release(staging, self.c, sha)

    def timers(self):
        return [name for name in self.c['timers'] if subprocess.run(
            ['systemctl', 'is-active', '--quiet', name], check=False).returncode == 0]

    def stop(self):
        if self.c['timers']: self.systemctl('stop', *self.c['timers'])
        if self.c['writers']: self.systemctl('stop', *self.c['writers'])
        self.systemctl('stop', self.c['service'])
        self.ensure_stopped()

    def ensure_stopped(self):
        for name in [self.c['service'], *self.c['writers'], *self.c['timers']]:
            if self.property(name, 'ActiveState') not in ('inactive', 'failed'):
                raise SafeFailure('writer-shutdown-incomplete')

    def backup_path(self, tx): return self.state / 'backups' / (tx['id'] + '.sqlite')

    def backup(self, tx):
        target = self.backup_path(tx)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with sqlite3.connect(self.db) as source, sqlite3.connect(target) as backup:
            source.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SafeFailure('bad-backup')

    def migrate(self, sha):
        self.app([self.node, '--import', 'tsx', '-e',
                  "import('./src/lib/db.ts').then(m => (m.getDb || m.default.getDb)().close())"],
                 self.releases / sha, {'BUTUYOKUOH_DB_PATH': str(self.db)})

    def validate(self, tx):
        with sqlite3.connect(self.backup_path(tx)) as before, sqlite3.connect(self.db) as after:
            if after.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SafeFailure('bad-migrated-db')
            prior = schema(before)
            validate_additive(prior, schema(after))
            for table, definition in prior.items():
                if table == '__objects__': continue
                columns = [column[1] for column in definition['columns']]
                if existing_rows(before, table, columns) - existing_rows(after, table, columns):
                    raise SafeFailure('existing-data-changed-during-migration')

    def restore_db(self, tx):
        with sqlite3.connect(self.backup_path(tx)) as source, sqlite3.connect(self.db) as destination:
            if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise SafeFailure('bad-backup')
            source.backup(destination)

    def switch(self, sha):
        target = self.releases / sha
        validate_release(target, self.c, sha)
        temporary = self.current.with_name('current.next')
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        os.replace(temporary, self.current)

    def start(self): self.systemctl('start', self.c['service'])

    def health(self, sha):
        for _ in range(self.c.get('health_attempts', 30)):
            try:
                with urllib.request.urlopen(self.c['health_url'], timeout=2) as response:
                    body = json.load(response)
                if body == {'ok': True, 'sha': sha}: return
            except (OSError, ValueError):
                if sha == self.c.get('legacy_health_sha'):
                    try:
                        with urllib.request.urlopen(self.c['legacy_health_url'], timeout=2) as old:
                            if old.status == 200: return
                    except OSError: pass
            time.sleep(1)
        raise SafeFailure('readiness-failed')

    def resume(self, timers):
        for timer in timers: self.systemctl('start', timer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['run', 'recover', 'recover-online', 'status', 'prune'])
    parser.add_argument('sha', nargs='?')
    parser.add_argument('--config', default='/etc/butuyokuoh-deploy.json')
    parser.add_argument('--apply', action='store_true', help='apply the prune plan (default: preview only)')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    import pwd
    if os.geteuid() != pwd.getpwnam(config['user']).pw_uid or os.geteuid() == 0:
        raise SafeFailure('deployment-must-run-as-the-configured-non-root-app-user')
    runner = Deployer(Path(config['state']), LinuxHost(config))
    if args.mode == 'run':
        result = runner.run(args.sha or '')
        print(json.dumps(result))
        return 0 if result['status'] in ('success', 'already-deployed', 'superseded') else 1
    if args.mode == 'status':
        if not SHA_RE.fullmatch(args.sha or ''): raise ValueError('invalid SHA')
        path = runner.state / 'results' / f'{args.sha}.json'
        print(path.read_text() if path.exists() else json.dumps({'sha': args.sha, 'status': 'running'}))
        return 0
    runner.state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (runner.state / 'lock').open('a') as lock:
        if args.mode == 'prune':
            # An operator must never wait and apply a stale preview while a
            # deployment is running. Re-read the plan under the same lock.
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(runner.host.prune_releases(apply=args.apply)))
            return 0
        fcntl.flock(lock, fcntl.LOCK_EX)
        runner.phase = 'recovery'
        try:
            if args.mode == 'recover' and runner.transaction.exists():
                runner.step('recovery-preflight', runner.host.ensure_stopped)
            runner.recover(offline=args.mode == 'recover')
        except Exception as error:
            if runner.transaction.exists():
                runner.recovery_failure_result(error)
            raise
    return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception:
        print('Deployment failed; inspect private host logs/state. No credentials emitted.')
        raise SystemExit(1)
