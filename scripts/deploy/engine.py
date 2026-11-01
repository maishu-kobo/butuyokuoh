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
import tempfile
import time
import urllib.request

SHA_RE = re.compile(r'[0-9a-f]{40}')


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

    def recover(self, offline=False):
        if not self.transaction.exists(): return
        tx = json.loads(self.transaction.read_text())
        if not offline: self.host.stop()
        # No candidate process has served traffic in these phases.
        if tx['phase'] in ('backed-up', 'migrating'):
            self.host.restore_db(tx)
        self.host.switch(tx['old'])
        if not offline:
            self.host.start()
            self.host.health(tx['old'])
            self.host.resume(tx['timers'])
        self.transaction.unlink()

    def run(self, sha):
        if not SHA_RE.fullmatch(sha): raise ValueError('invalid SHA')
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.state / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.recover()
            tx = None
            try:
                if self.host.latest() != sha: return self.result(sha, 'superseded')
                if self.host.active() == sha:
                    self.host.health(sha)
                    return self.result(sha, 'already-deployed')
                self.host.prepare(sha)
                if self.host.latest() != sha: return self.result(sha, 'superseded')
                tx = {'sha': sha, 'old': self.host.active(), 'phase': 'stopping',
                      'timers': self.host.timers(), 'id': f'{sha}-{time.time_ns()}'}
                self.save(tx)
                self.host.stop()
                self.host.backup(tx)
                tx['phase'] = 'backed-up'; self.save(tx)
                tx['phase'] = 'migrating'; self.save(tx)
                self.host.migrate(sha)
                self.host.validate(tx)
                tx['phase'] = 'validated'; self.save(tx)
                # A new main may have arrived during migration; keep additive schema,
                # restore the prior application, and let the newer run deploy it.
                if self.host.latest() != sha:
                    self.recover()
                    return self.result(sha, 'superseded')
                tx['phase'] = 'activating'; self.save(tx)
                self.host.switch(sha)
                self.host.start()
                self.host.health(sha)
                self.host.resume(tx['timers'])
                self.transaction.unlink()
                return self.result(sha, 'success')
            except Exception:
                if tx is None: return self.result(sha, 'failed')
                try:
                    self.recover()
                    return self.result(sha, 'rolled-back')
                except Exception:
                    # Keep the journal and both DB copies. Never claim recovery.
                    return self.result(sha, 'recovery-required')

    def result(self, sha, status):
        result = {'sha': sha, 'status': status, 'at': int(time.time())}
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
    raise RuntimeError('unsupported table definition')


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
                raise RuntimeError('existing index or trigger changed')
        elif table not in after or after[table]['columns'][:len(definition['columns'])] != definition['columns'] or after[table]['foreign_keys'] != definition['foreign_keys']:
            raise RuntimeError('non-additive schema migration')
        else:
            prior, prior_tail = definition['definition']
            current, current_tail = after[table]['definition']
            added_columns = len(after[table]['columns']) - len(definition['columns'])
            if Counter(prior) - Counter(current) or current_tail != prior_tail or len(current) - len(prior) != added_columns:
                raise RuntimeError('existing table constraints changed')


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
            raise RuntimeError('command timed out') from None
        if process.returncode != 0: raise RuntimeError('host command failed')
        return output.decode().strip()

    def systemctl(self, *args): return self.command(['sudo', '-n', 'systemctl', *args])

    def latest(self):
        line = self.command(['git', 'ls-remote', self.c['repository'], self.c.get('ref', 'refs/heads/main')])
        sha = line.split()[0]
        if not SHA_RE.fullmatch(sha): raise RuntimeError('main unavailable')
        return sha

    def active(self):
        sha = (self.current / 'RELEASE_SHA').read_text().strip()
        if not SHA_RE.fullmatch(sha): raise RuntimeError('active release unknown')
        return sha

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
        if tuple(map(int, version[:2])) < (22, 12): raise RuntimeError('Node 22.12 required')
        for required in ('env_file', 'database', 'uploads'):
            if not Path(self.c[required]).exists(): raise RuntimeError('missing persistent configuration')
        if shutil.disk_usage(self.releases).free < self.c.get('minimum_free_bytes', 2 * 1024**3):
            raise RuntimeError('insufficient free space; no automatic deletion')
        release = self.releases / sha
        # Never mutate an active or previously built release. Incomplete builds remain
        # for inspection and a rerun uses a fresh staging directory.
        if release.exists():
            if (release / 'RELEASE_SHA').read_text().strip() != sha: raise RuntimeError('invalid release')
            return
        staging = Path(tempfile.mkdtemp(prefix=f'build-{sha[:8]}-', dir=self.releases))
        self.app(['git', 'clone', '--no-checkout', self.c['repository'], '.'], staging, timeout=300)
        self.app(['git', 'checkout', '--detach', sha], staging)
        if self.app(['git', 'rev-parse', 'HEAD'], staging) != sha: raise RuntimeError('checkout mismatch')
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
        os.rename(staging, release)

    def timers(self):
        return [name for name in self.c['timers'] if subprocess.run(
            ['systemctl', 'is-active', '--quiet', name], check=False).returncode == 0]

    def stop(self):
        self.systemctl('stop', *self.c['timers'])
        self.systemctl('stop', *self.c['writers'])
        self.systemctl('stop', self.c['service'])

    def backup_path(self, tx): return self.state / 'backups' / (tx['id'] + '.sqlite')

    def backup(self, tx):
        target = self.backup_path(tx)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with sqlite3.connect(self.db) as source, sqlite3.connect(target) as backup:
            source.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('bad backup')

    def migrate(self, sha):
        self.app([self.node, '--import', 'tsx', '-e',
                  "import('./src/lib/db.ts').then(m => (m.getDb || m.default.getDb)().close())"],
                 self.releases / sha, {'BUTUYOKUOH_DB_PATH': str(self.db)})

    def validate(self, tx):
        with sqlite3.connect(self.backup_path(tx)) as before, sqlite3.connect(self.db) as after:
            if after.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('bad migrated DB')
            prior = schema(before)
            validate_additive(prior, schema(after))
            for table, definition in prior.items():
                if table == '__objects__': continue
                columns = [column[1] for column in definition['columns']]
                if existing_rows(before, table, columns) - existing_rows(after, table, columns):
                    raise RuntimeError('existing data changed during migration')

    def restore_db(self, tx):
        with sqlite3.connect(self.backup_path(tx)) as source, sqlite3.connect(self.db) as destination:
            if source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('bad backup')
            source.backup(destination)

    def switch(self, sha):
        target = self.releases / sha
        if not (target / '.next' / 'BUILD_ID').is_file(): raise RuntimeError('release not built')
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
        raise RuntimeError('readiness failed')

    def resume(self, timers):
        if timers: self.systemctl('start', *timers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['run', 'recover', 'recover-online', 'status'])
    parser.add_argument('sha', nargs='?')
    parser.add_argument('--config', default='/etc/butuyokuoh-deploy.json')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    import pwd
    if os.geteuid() != pwd.getpwnam(config['user']).pw_uid or os.geteuid() == 0:
        raise RuntimeError('deployment must run as the configured non-root app user')
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
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.mode == 'recover' and runner.transaction.exists():
            for service in [config['service'], *config['writers']]:
                if subprocess.run(['systemctl', 'is-active', '--quiet', service], check=False).returncode == 0:
                    raise RuntimeError('offline recovery requires stopped writers')
        runner.recover(offline=args.mode == 'recover')
    return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception:
        print('Deployment failed; inspect private host logs/state. No credentials emitted.')
        raise SystemExit(1)
