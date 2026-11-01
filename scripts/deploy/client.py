#!/usr/bin/env python3
"""GitHub-hosted runner client. Never copies application secrets or databases."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request


def deployment_target(env):
    if env.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch') or env.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('only main push/manual execution may deploy')
    sha = env.get('GITHUB_SHA', '')
    if not re.fullmatch('[a-f0-9]{40}', sha): raise ValueError('invalid SHA')
    if env.get('GITHUB_REPOSITORY') != 'maishu-kobo/butuyokuoh': raise ValueError('wrong repository')
    return sha


def main():
    sha = deployment_target(os.environ)
    request = urllib.request.Request('https://api.github.com/repos/maishu-kobo/butuyokuoh/git/ref/heads/main',
                                     headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=20) as response: latest = json.load(response)['object']['sha']
    if latest != sha:
        summary(sha, 'superseded (new main will deploy)'); return
    host = os.environ['EXE_DEPLOY_HOST']
    user = os.environ.get('EXE_DEPLOY_USER', 'exedev')
    if not re.fullmatch('[a-z0-9][a-z0-9.-]+', host) or not re.fullmatch('[a-z][a-z0-9_-]*', user):
        raise ValueError('invalid SSH destination')
    with tempfile.TemporaryDirectory() as folder:
        key, known = Path(folder)/'key', Path(folder)/'known_hosts'
        key.write_text(os.environ['EXE_DEPLOY_SSH_KEY'].strip() + '\n'); key.chmod(0o600)
        known.write_text(os.environ['EXE_DEPLOY_KNOWN_HOSTS'].strip() + '\n'); known.chmod(0o600)
        ssh = ['ssh', '-F', '/dev/null', '-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
               '-o', f'UserKnownHostsFile={known}', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
               f'{user}@{host}', '/usr/bin/python3', '/opt/butuyokuoh-deploy/request.py']
        def call(action):
            result = subprocess.run([*ssh, action, sha], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    check=True, timeout=90)
            body = json.loads(result.stdout)
            if body.get('sha') != sha: raise ValueError('deployment response SHA mismatch')
            return body['status']
        try:
            status = monitor(call)
        except RuntimeError:
            summary(sha, 'failed or monitoring incomplete; inspect VM status before retry')
            raise
        summary(sha, status)


def monitor(call, sleep=time.sleep, attempts=240):
    try:
        if call('start') != 'accepted': raise RuntimeError('request not accepted')
    except (subprocess.SubprocessError, OSError):
        # The server may have accepted the request even if SSH lost its response.
        pass
    for _ in range(attempts):
        try: status = call('status')
        except (subprocess.SubprocessError, OSError):
            sleep(10); continue
        if status in ('success', 'already-deployed', 'superseded'): return status
        if status != 'running': raise RuntimeError('deployment did not complete: ' + status)
        sleep(10)
    raise RuntimeError('monitor timed out')



def summary(sha, status):
    # Both values are validated or fixed strings, not remote HTML/secret output.
    print(f'deployment {sha}: {status}')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(f'## exe.dev deployment\n\nSHA: `{sha}`\n\nResult: {status}\n\nhttps://butsuyokuoh.exe.xyz/\n')


if __name__ == '__main__':
    try: main()
    except Exception:
        print('Deployment failed. See safe status summary; private SSH diagnostics are not printed.')
        raise SystemExit(1)
