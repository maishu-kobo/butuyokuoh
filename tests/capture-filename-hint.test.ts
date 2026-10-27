import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { filenameProductCode } from '../src/lib/capture/filename-hint';

test('a catalog filename offers only an unconfirmed code, never a product identity', () => {
  assert.equal(filenameProductCode('7897722AA4V1000_F.jpg'), '7897722AA4V1000');
  assert.equal(filenameProductCode('AB-123456_front.PNG'), 'AB-123456');
  for (const name of ['IMG_12345678.jpg', 'PXL_20261027_123456.jpg', 'DSC12345678.jpg', '20261027.jpg', 'photo.jpg', 'a1234567.jpg', 'ab123.jpg', '../AB123456.jpg', 'd68fe49d-6c98-455d-918e-68c4d05380fe.jpg']) {
    assert.equal(filenameProductCode(name), null, name);
  }
});

test('filename hints are bounded alphanumeric codes and plain numeric names never become a hint', () => {
  fc.assert(fc.property(fc.string(), value => {
    const code = filenameProductCode(value);
    if (code !== null) {
      assert.match(code, /^[A-Z0-9-]{8,40}$/);
      assert.ok((code.match(/[A-Z]/g) ?? []).length >= 2);
      assert.ok((code.match(/\d/g) ?? []).length >= 3);
    }
  }), { seed: 247, numRuns: 300 });
  fc.assert(fc.property(fc.integer({ min: 10000000, max: 99999999 }), n => assert.equal(filenameProductCode(`${n}.jpg`), null)), { seed: 247 });
});
