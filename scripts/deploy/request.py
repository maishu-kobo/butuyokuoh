#!/usr/bin/env python3
"""Root-owned bridge: only an exact SHA can become a systemd unit name."""
import json
import re
import subprocess
import sys
from pathlib import Path


def main(args, config_path='/etc/butuyokuoh-deploy.json'):
    if len(args) != 2 or args[0] not in ('start', 'status') or not re.fullmatch('[0-9a-f]{40}', args[1]):
        raise ValueError('expected start|status and full SHA')
    action, sha = args
    config = json.loads(Path(config_path).read_text())
    result = Path(config['state']) / 'results' / (sha + '.json')
    unit = f'butuyokuoh-deploy-{sha}'
    if action == 'start':
        # Serialize request/result reset as well as the longer deployment itself.
        import fcntl
        with (Path(config['state']) / 'request.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            active = subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=False).returncode == 0
            if not active:
                result.unlink(missing_ok=True)
                subprocess.run(['sudo', '-n', 'systemctl', 'reset-failed', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                subprocess.run(['sudo', '-n', 'systemd-run', '--quiet', '--collect', f'--unit={unit}',
                                '--uid=' + config['user'],
                                '--property=Type=exec', '--property=RuntimeMaxSec=2400',
                                '--property=KillMode=control-group',
                                '--property=TimeoutStopSec=120',
                                '--property=ExecStopPost=/usr/bin/python3 /opt/butuyokuoh-deploy/engine.py recover-online',
                                '/usr/bin/python3', '/opt/butuyokuoh-deploy/engine.py', 'run', sha], check=True)
        print(json.dumps({'sha': sha, 'status': 'accepted'}))
    elif result.exists(): print(result.read_text())
    else:
        active = subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=False).returncode == 0
        print(json.dumps({'sha': sha, 'status': 'running' if active else 'interrupted'}))

if __name__ == '__main__':
    try: main(sys.argv[1:])
    except Exception:
        print('Deployment request failed (details are private).', file=sys.stderr)
        sys.exit(1)
