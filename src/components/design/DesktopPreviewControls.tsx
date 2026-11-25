'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

type DesktopLayout = 'current' | 'workspace' | 'reading';
const storageKey = 'butuyokuoh:desktop-preview';
const previewKey = 'butuyokuoh:desktop-preview-enabled';
const desktopQuery = '(min-width: 1100px)';
function readLayout(value: string | null): DesktopLayout | null {
  return value === 'current' || value === 'workspace' || value === 'reading' ? value : null;
}
function subscribeWidth(listener: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function isDesktop() { return window.matchMedia(desktopQuery).matches; }
function serverWidth() { return false; }

export function useDesktopPreview() {
  const [layout, setLayout] = useState<DesktopLayout>('reading');
  const [preview, setPreview] = useState(false);
  const wide = useSyncExternalStore(subscribeWidth, isDesktop, serverWidth);
  useEffect(() => {
    const restore = () => {
      let value = readLayout(new URLSearchParams(window.location.search).get('pc'));
      let comparing = value !== null;
      try {
        comparing ||= sessionStorage.getItem(previewKey) === 'true';
        if (comparing) value ||= readLayout(localStorage.getItem(storageKey));
      } catch { /* The explicit preview URL still works without storage. */ }
      const next = value ?? 'reading';
      setLayout(next);
      setPreview(comparing);
      if (comparing) {
        try { sessionStorage.setItem(previewKey, 'true');localStorage.setItem(storageKey, next); } catch { /* Keep the current session usable. */ }
      }
    };
    queueMicrotask(restore);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function choose(next: DesktopLayout) {
    setLayout(next);
    setPreview(true);
    try { sessionStorage.setItem(previewKey, 'true');localStorage.setItem(storageKey, next); } catch { /* Keep the current session usable. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('pc', next);
    window.history.replaceState(window.history.state, '', url);
  }
  return { layout, active: wide && layout !== 'current', preview, choose };
}

export default function DesktopLayoutToggle({value,onChange}: {value:DesktopLayout;onChange:(value:DesktopLayout)=>void}) {
  return <div className="desktop-layout-toggle" role="group" aria-label="PCの表示を比較">
    <button type="button" aria-pressed={value==='current'} onClick={()=>onChange('current')}>今のPC表示</button>
    <button type="button" aria-pressed={value==='workspace'} onClick={()=>onChange('workspace')}>PC専用</button>
    <button type="button" aria-pressed={value==='reading'} onClick={()=>onChange('reading')}>縦リスト</button>
  </div>;
}
