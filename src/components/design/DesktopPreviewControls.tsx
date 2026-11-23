'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

type DesktopLayout = 'current' | 'workspace';
const storageKey = 'butuyokuoh:desktop-preview';
const desktopQuery = '(min-width: 1100px)';
function subscribeWidth(listener: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function isDesktop() { return window.matchMedia(desktopQuery).matches; }
function serverWidth() { return false; }

export function useDesktopPreview() {
  const [layout, setLayout] = useState<DesktopLayout>('current');
  const wide = useSyncExternalStore(subscribeWidth, isDesktop, serverWidth);
  useEffect(() => {
    const restore = () => {
      let value = new URLSearchParams(window.location.search).get('pc');
      try { value ||= localStorage.getItem(storageKey); } catch { /* The URL still works without storage. */ }
      const next = value === 'workspace' ? 'workspace' : 'current';
      setLayout(next);
      try { localStorage.setItem(storageKey, next); } catch { /* Keep the current session usable. */ }
    };
    queueMicrotask(restore);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function choose(next: DesktopLayout) {
    setLayout(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the current session usable. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('pc', next);
    window.history.replaceState(window.history.state, '', url);
  }
  return { layout, active: wide && layout === 'workspace', choose };
}

export default function DesktopLayoutToggle({value,onChange}: {value:DesktopLayout;onChange:(value:DesktopLayout)=>void}) {
  return <div className="desktop-layout-toggle" role="group" aria-label="PCの表示を比較">
    <button type="button" aria-pressed={value==='current'} onClick={()=>onChange('current')}>今のPC表示</button>
    <button type="button" aria-pressed={value==='workspace'} onClick={()=>onChange('workspace')}>PC専用</button>
  </div>;
}
