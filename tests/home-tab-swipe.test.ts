import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSwipeable } from 'react-swipeable';
import { useHomeSwipeRef } from '../src/lib/home-tab-swipe';

class IframeElement {}
class HostElement {}
class HostNode {}

type Listener = (event: Event) => void;

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
  listeners = new Map<string, Set<Listener>>();
  removed: string[] = [];

  constructor(tag: string) {
    this.nodeName = tag.toUpperCase();
    this.tagName = this.nodeName;
  }

  setAttribute(name: string, value: string) { this.attributes[name] = String(value); }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  hasAttribute(name: string) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }

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

  addEventListener(type: string, listener: Listener) {
    const list = this.listeners.get(type) ?? new Set<Listener>();
    list.add(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener) {
    this.removed.push(type);
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event) {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener.call(this, event);
    return true;
  }

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.childNodes.some(child => child === other || child.contains(other));
  }

  focus() {}
  blur() {}
  compareDocumentPosition() { return 0; }
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

  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }

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

  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementById() { return null; }
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
    getSelection() { return null; },
    getComputedStyle() { return { getPropertyValue: () => '' }; },
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

function touch(type: string, x: number, timeStamp: number) {
  return {
    type,
    timeStamp,
    cancelable: true,
    touches: [{ clientX: x, clientY: 8 }],
    preventDefault() {},
  } as unknown as Event;
}

function findShell(document: FakeDocument): FakeNode {
  const walk = (node: FakeNode): FakeNode | null => {
    if (node.attributes.id === 'shell') return node;
    for (const child of node.childNodes) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(document.body);
  if (!found) throw new Error('shell missing');
  return found;
}

test('a home re-render during a swipe does not detach the handlers', async () => {
  const document = installDom();
  const calls: string[] = [];
  const controls: { bump?: () => void } = {};

  function HomeShell() {
    const [tick, setTick] = useState(0);
    const [tab, setTab] = useState('list');
    controls.bump = () => setTick(value => value + 1);
    const swipeHandlers = useSwipeable({
      onSwipedLeft: () => setTab('budget'),
      trackMouse: false,
      preventScrollOnSwipe: true,
      delta: 30,
      swipeDuration: 500,
      touchEventOptions: { passive: false },
    });
    const swipeRef = useHomeSwipeRef((node) => {
      calls.push(node ? 'element' : 'null');
      swipeHandlers.ref(node);
    });
    return createElement('div', {
      ref: swipeRef,
      id: 'shell',
      'data-tab': tab,
      'data-tick': String(tick),
    });
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(createElement(HomeShell));
    });
    const shell = findShell(document);
    assert.equal(shell.listeners.get('touchmove')?.size, 1);
    shell.dispatchEvent(touch('touchstart', 120, 0));

    calls.length = 0;
    shell.removed.length = 0;
    await act(async () => { controls.bump?.(); });

    const during = findShell(document);
    assert.equal(during.attributes['data-tick'], '1');
    assert.deepEqual(calls, []);
    assert.deepEqual(during.removed, []);
    assert.equal(during.listeners.get('touchmove')?.size, 1);

    await act(async () => {
      during.dispatchEvent(touch('touchmove', 40, 30));
      during.dispatchEvent(touch('touchend', 40, 40));
    });
    assert.equal(findShell(document).attributes['data-tab'], 'budget');
  } finally {
    await act(async () => { root?.unmount(); });
  }
});
