#!/usr/bin/env python3
"""Explicit one-time host installation; does not start an application or deploy.
Run as root with a reviewed config JSON. Existing DB/uploads/keys are never copied.
"""
import json
import os
from pathlib import Path
import re
import shutil
import pwd
import subprocess
import sys
from engine import validate_release, startup_commands, LinuxHost


def owned_directory(path, uid, gid):
    # Traverse anchored directory descriptors, refusing symlinks at every level.
    # fchown targets the opened directory, not an app-replaceable pathname.
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in Path(path).parts[1:]:
            try: os.mkdir(part, mode=0o700, dir_fd=descriptor)
            except FileExistsError: pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor); descriptor = child
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, 0o700)
    finally: os.close(descriptor)


def validate_initial(c):
    release = Path(c['initial_release'])
    sha = (release / 'RELEASE_SHA').read_text().strip()
    if not re.fullmatch('[a-f0-9]{40}', sha) or not (release / '.next' / 'BUILD_ID').is_file():
        raise ValueError('invalid initial release')
    if (Path(c['releases']).is_symlink() or release.is_symlink()
            or release.resolve() != Path(c['releases']).resolve() / sha):
        raise ValueError('initial release must be stored as releases/FULL_SHA')
    current = Path(c['current'])
    if os.path.lexists(current) and (not current.is_symlink() or current.resolve() != release.resolve()):
        raise ValueError('existing current differs from initial release')
    validate_release(release, c, sha)


def install(config_path):
    if os.geteuid() != 0: raise ValueError('root required')
    c = json.loads(Path(config_path).read_text())
    for key in ('state', 'releases', 'current', 'database', 'uploads', 'env_file', 'node', 'home', 'initial_release'):
        if not re.fullmatch(r'/[A-Za-z0-9_./-]+', c[key]): raise ValueError('invalid path')
    for key in ('user', 'service'):
        if not re.fullmatch('[a-z][a-z0-9-]*', c[key]): raise ValueError('invalid service/user')
    if c.get('ref', 'refs/heads/main') != 'refs/heads/main': raise ValueError('production must track main')
    for key in ('database', 'uploads', 'env_file', 'node', 'initial_release'):
        if not Path(c[key]).exists(): raise ValueError('missing existing resource')
    validate_initial(c)
    # Validate every unit before installing any configuration.
    for name in c['timers']:
        if not re.fullmatch(r'[a-z][a-z0-9-]*\.timer', name): raise ValueError('invalid timer')
    for name in c['writers']:
        if not re.fullmatch('[a-z][a-z0-9-]*', name): raise ValueError('invalid writer')
    for name, script in c['writer_scripts'].items():
        if name not in c['writers'] or script not in ('check-prices.ts', 'cleanup-guests.ts', 'check-prices.ts --mode=stock-watch'):
            raise ValueError('invalid writer command')
    if set(c['writer_scripts']) != set(c['writers']): raise ValueError('writer definitions must match')
    if not isinstance(c['port'], int) or not 1 <= c['port'] <= 65535: raise ValueError('invalid port')
    owner = pwd.getpwnam(c['user'])
    if owner.pw_uid == 0: raise ValueError('non-root app user required')
    LinuxHost(c).check_units(check_startup=False, permission_user=c['user'])
    owned_directory('/opt/butuyokuoh-deploy', 0, 0)
    for directory in (Path(c['state']), Path(c['state']) / 'results'):
        owned_directory(directory, owner.pw_uid, owner.pw_gid)
    for name in ('engine.py', 'request.py'):
        shutil.copyfile(Path(__file__).with_name(name), Path('/opt/butuyokuoh-deploy') / name)
        os.chmod(Path('/opt/butuyokuoh-deploy') / name, 0o755)
    Path('/etc/butuyokuoh-deploy.json').write_text(json.dumps(c, indent=2))
    os.chmod('/etc/butuyokuoh-deploy.json', 0o644)
    os.chmod('/opt/butuyokuoh-deploy', 0o755)
    current = Path(c['current'])
    if not current.exists(): current.symlink_to(c['initial_release'])
    if not current.is_symlink(): raise ValueError('current must be a symlink')
    units = [c['service'], *c['timers']]
    recovery = '''[Unit]
Description=Recover interrupted Butuyokuoh deployment before application startup
After=local-fs.target
Before={units}
[Service]
Type=oneshot
RemainAfterExit=yes
User={user}
ExecStart=/usr/bin/python3 /opt/butuyokuoh-deploy/engine.py recover
[Install]
WantedBy=multi-user.target
'''.format(user=c['user'], units=' '.join(name if name.endswith('.timer') else name + '.service' for name in units))
    Path('/etc/systemd/system/butuyokuoh-deploy-recover.service').write_text(recovery)
    service_commands = startup_commands(c)
    for name, command in service_commands.items():
        folder = Path(f'/etc/systemd/system/{name}.service.d'); folder.mkdir(exist_ok=True)
        (folder / 'zz-auto-deploy.conf').write_text(f'''[Unit]
Requires=butuyokuoh-deploy-recover.service
After=butuyokuoh-deploy-recover.service
[Service]
User={c['user']}
KillMode=control-group
WorkingDirectory={c['current']}
EnvironmentFile=
EnvironmentFile={c['env_file']}
ExecStart=
ExecStart={command}
''')
    for name in c['timers']:
        if not re.fullmatch(r'[a-z][a-z0-9-]*\.timer', name): raise ValueError('invalid timer')
        folder = Path(f'/etc/systemd/system/{name}.d'); folder.mkdir(exist_ok=True)
        (folder / 'zz-auto-deploy.conf').write_text('[Unit]\nRequires=butuyokuoh-deploy-recover.service\nAfter=butuyokuoh-deploy-recover.service\n')
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', 'butuyokuoh-deploy-recover.service'], check=True)
    subprocess.run(['systemctl', 'start', 'butuyokuoh-deploy-recover.service'], check=True)
    # Do not restart existing services, trigger price checks, or enable deployment.
    print('Installed. Existing application remains running. Activation is a separate step.')

if __name__ == '__main__': install(sys.argv[1])
