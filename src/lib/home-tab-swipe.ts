import { useCallback, useLayoutEffect, useRef } from 'react';

const wrappedListeners = new WeakMap<EventListener, EventListener>();
const filteredRoots = new WeakSet<EventTarget>();

function asElement(target: EventTarget | null): Element | null {
  if (typeof Element === 'undefined' || typeof Node === 'undefined') return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

// 新しいタブのリンク上で指が動くと、ページのスワイプが touchmove を止める。
// iPhone Safari はそのジェスチャーで target=_blank を捨て、同じタブで開く。
export function touchTargetOpensNewTab(target: EventTarget | null): boolean {
  const link = asElement(target)?.closest('a');
  return link?.getAttribute('target') === '_blank';
}

// ライブラリのタッチ監視を、新しいタブのリンクでは呼ばない。
// イベント自体は止めない。止めるとクリックが届かなくなる。
export function ignoreNewTabLinkTouches(element: HTMLElement): void {
  if (filteredRoots.has(element)) return;
  filteredRoots.add(element);
  const add = element.addEventListener.bind(element);
  const remove = element.removeEventListener.bind(element);
  element.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    if (type.startsWith('touch') && typeof listener === 'function') {
      let wrapped = wrappedListeners.get(listener);
      if (!wrapped) {
        wrapped = function (this: EventTarget, event: Event) {
          if (touchTargetOpensNewTab(event.target)) return;
          listener.call(this, event);
        };
        wrappedListeners.set(listener, wrapped);
      }
      add(type, wrapped, options);
      return;
    }
    add(type, listener as EventListener, options);
  }) as HTMLElement['addEventListener'];
  element.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
    const wrapped = typeof listener === 'function' ? wrappedListeners.get(listener) : undefined;
    remove(type, (wrapped ?? listener) as EventListener, options);
  }) as HTMLElement['removeEventListener'];
}

// 描画のたびに新しい関数を返すと、React は前の ref を null で外そうとする。
// 同じ関数を渡し続け、中で呼ぶ監視だけ最新にする。
export function useHomeSwipeRef(swipeRef: (node: HTMLElement | null) => void) {
  const swipeRefHolder = useRef(swipeRef);
  useLayoutEffect(() => {
    swipeRefHolder.current = swipeRef;
  });
  return useCallback((node: HTMLElement | null) => {
    if (node) ignoreNewTabLinkTouches(node);
    swipeRefHolder.current(node);
  }, []);
}
