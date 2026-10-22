import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { photoForUpload } from '../src/lib/capture/photo-pick';
import { useCapturePhotoPick, type CapturePhotoPick } from '../src/components/CapturePhotoPicker';

class IframeElement {}
class HostElement {}
class HostNode {}

class FakeNode {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  style: Record<string, string> = {};
  childNodes: FakeNode[] = [];
  attributes: Record<string, string> = {};
  ownerDocument: FakeDocument | null = null;
  parentNode: FakeNode | null = null;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  textContent = '';

  constructor(tag: string) {
    this.nodeName = tag.toUpperCase();
    this.tagName = this.nodeName;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    this.childNodes = this.childNodes.filter(item => item !== child);
    child.parentNode = null;
    return child;
  }

  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  addEventListener() {}

  removeEventListener() {}

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.childNodes.some(child => child === other || child.contains(other));
  }

  focus() {}

  blur() {}

  compareDocumentPosition() {
    return 0;
  }
}

class FakeDocument {
  nodeType = 9;
  documentElement: FakeNode;
  body: FakeNode;
  head: FakeNode;
  activeElement: FakeNode;
  defaultView: object | null = null;
  HTMLIFrameElement = IframeElement;

  constructor() {
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tag: string) {
    const node = new FakeNode(tag);
    node.ownerDocument = this;
    return node;
  }

  createElementNS(_namespace: string, tag: string) {
    return this.createElement(tag);
  }

  createTextNode(text: string) {
    const node = new FakeNode('#text');
    node.nodeType = 3;
    node.textContent = String(text);
    return node;
  }

  createComment(text: string) {
    const node = new FakeNode('#comment');
    node.nodeType = 8;
    node.textContent = text;
    return node;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getElementById() {
    return null;
  }

  addEventListener() {}

  removeEventListener() {}
}

function installDom() {
  const document = new FakeDocument();
  const windowObj = {
    document,
    HTMLIFrameElement: IframeElement,
    HTMLElement: HostElement,
    Element: HostElement,
    Node: HostNode,
    navigator: { userAgent: 'node' },
    location: { protocol: 'http:', href: 'http://localhost/' },
    addEventListener() {},
    removeEventListener() {},
    getSelection() {
      return null;
    },
    getComputedStyle() {
      return { getPropertyValue: () => '' };
    },
    self: null as unknown,
    top: null as unknown,
    parent: null as unknown,
  };
  windowObj.self = windowObj;
  windowObj.top = windowObj;
  windowObj.parent = windowObj;
  document.defaultView = windowObj;
  Object.assign(globalThis, {
    window: windowObj,
    document,
    HTMLElement: HostElement,
    Element: HostElement,
    Node: HostNode,
    HTMLIFrameElement: IframeElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return document;
}

function jpeg(name: string) {
  return new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], name, { type: 'image/jpeg' });
}

test('closing the add card while a photo is shrinking drops the result instead of sending it', async () => {
  const document = installDom();
  const queued: Array<(value: Awaited<ReturnType<typeof photoForUpload>>) => void> = [];
  const upload: typeof photoForUpload = () => new Promise(resolve => {
    queued.push(resolve);
  });
  const accepted: File[] = [];
  const pickRef: MutableRefObject<CapturePhotoPick | null> = { current: null };

  function Host({ enabled }: { enabled: boolean }) {
    const pick = useCapturePhotoPick(enabled, file => {
      accepted.push(file);
    }, upload);
    pickRef.current = pick;
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(createElement(Host, { enabled: true }));
    });
    await act(async () => {
      pickRef.current?.acceptFiles([jpeg('shot.jpg')]);
    });
    assert.equal(queued.length, 1);
    assert.equal(accepted.length, 0);

    await act(async () => {
      root?.render(createElement(Host, { enabled: false }));
    });
    await act(async () => {
      root?.render(createElement(Host, { enabled: true }));
    });
    const finished = jpeg('shot.jpg');
    await act(async () => {
      queued[0]({ ok: true, file: finished });
    });

    assert.equal(accepted.length, 0, 'a shrink that finishes after the card was closed must not be sent');
    assert.equal(pickRef.current?.selected, false);

    await act(async () => {
      pickRef.current?.acceptFiles([jpeg('after.jpg')]);
    });
    const after = jpeg('after.jpg');
    await act(async () => {
      queued[1]({ ok: true, file: after });
    });
    assert.deepEqual(accepted.map(file => file.name), ['after.jpg']);
    assert.equal(pickRef.current?.selected, true);
  } finally {
    await act(async () => {
      root?.unmount();
    });
  }
});
