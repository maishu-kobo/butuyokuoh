import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchQuery } from '../src/lib/capture/contract';
import { searchWithPorts } from '../src/lib/capture/fakes';
import { getCapturePorts, portsForRequest } from '../src/lib/capture/ports';

const query: SearchQuery = { name: 'ペン', brand: null, model: null, jan: null };

test('the scenario header is ignored unless the test hook is on outside production', async () => {
  assert.equal(portsForRequest('yahoo-down', { NODE_ENV: 'development' }), getCapturePorts());
  assert.equal(portsForRequest('yahoo-down', { NODE_ENV: 'test', CAPTURE_TEST_HOOKS: '0' }), getCapturePorts());
  assert.equal(portsForRequest('empty', { NODE_ENV: 'production', CAPTURE_TEST_HOOKS: '1' }), getCapturePorts());
  assert.equal(portsForRequest('nope', { NODE_ENV: 'development', CAPTURE_TEST_HOOKS: '1' }), getCapturePorts());
  assert.equal(portsForRequest(null, { NODE_ENV: 'development', CAPTURE_TEST_HOOKS: '1' }), getCapturePorts());

  const hooked = portsForRequest('yahoo-down', { NODE_ENV: 'development', CAPTURE_TEST_HOOKS: '1' });
  assert.notEqual(hooked, getCapturePorts());
  const result = await searchWithPorts(query, hooked, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map(item => item.site), ['rakuten']);
  assert.equal(result.value.failures[0].site, 'yahoo');
  assert.equal(getCapturePorts(), portsForRequest(null, { NODE_ENV: 'development' }));
});
