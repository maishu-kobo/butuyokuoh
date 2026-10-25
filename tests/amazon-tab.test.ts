import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAmazonSearchTab } from '../src/lib/capture/amazon-tab';

const href = 'https://www.amazon.co.jp/s?k=pen&tag=test-tag-22';

function click(extra: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...extra,
  };
}

test('an unmodified click opens one noreferrer tab and cancels the current page', () => {
  const event = click();
  const opened: unknown[][] = [];
  openAmazonSearchTab(event, href, ((...args: unknown[]) => {
    opened.push(args);
    return null;
  }) as typeof window.open);
  assert.deepEqual(opened, [[href, '_blank', 'noopener,noreferrer']]);
  assert.equal(event.prevented, true);
});

test('modified clicks leave the new tab to the browser', () => {
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const event = click(extra);
    let called = false;
    openAmazonSearchTab(event, href, (() => {
      called = true;
      return null;
    }) as typeof window.open);
    assert.equal(called, false);
    assert.equal(event.prevented, false);
  }
});
