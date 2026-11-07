import importlib.util
from pathlib import Path
import subprocess
import unittest

spec=importlib.util.spec_from_file_location('client',Path(__file__).with_name('client.py'))
client=importlib.util.module_from_spec(spec); spec.loader.exec_module(client)
SHA='a'*40
class ClientTests(unittest.TestCase):
 def test_only_expected_main_events_and_repository_are_allowed(self):
  base={'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/main','GITHUB_SHA':SHA,'GITHUB_REPOSITORY':'maishu-kobo/butuyokuoh'}
  for event in ['push','workflow_dispatch']:
   self.assertEqual(client.deployment_target({**base,'GITHUB_EVENT_NAME':event}),SHA)
  for key,values in {'GITHUB_EVENT_NAME':['pull_request','pull_request_target','workflow_run',''], 'GITHUB_REF':['refs/heads/develop','refs/pull/1/merge',''], 'GITHUB_SHA':['main','a'*39,'a'*41,'a;id'], 'GITHUB_REPOSITORY':['fork/butuyokuoh','']}.items():
   for value in values:
    with self.subTest(key=key,value=value),self.assertRaises(ValueError): client.deployment_target({**base,key:value})
 def monitor(self,values,attempts=10):
  replies=iter(values); actions=[]
  def call(action):
   actions.append(action); value=next(replies)
   if isinstance(value,Exception): raise value
   return value
  return client.monitor(call,sleep=lambda _:None,attempts=attempts),actions
 def test_lost_start_response_does_not_cancel_vm_monitoring(self):
  result,actions=self.monitor([subprocess.TimeoutExpired('ssh',90),'running','success'])
  self.assertEqual((result,actions),('success',['start','status','status']))
 def test_reconnects_during_monitoring(self):
  self.assertEqual(self.monitor(['accepted',OSError('offline'),'running','already-deployed'])[0],'already-deployed')
 def test_failed_and_unknown_states_are_not_success(self):
  for status in ['failed','rolled-back','recovery-required','interrupted','unknown']:
   with self.subTest(status=status),self.assertRaises(RuntimeError): self.monitor(['accepted',status])
 def test_old_sha_and_bounded_monitor(self):
  self.assertEqual(self.monitor(['accepted','superseded'])[0],'superseded')
  with self.assertRaises(RuntimeError): self.monitor(['accepted','running','running'],attempts=2)
if __name__=='__main__': unittest.main()
