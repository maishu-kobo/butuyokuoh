'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Category, ComparisonGroup } from '@/types';
import { reviewHref } from '@/lib/design-home';
import { useTheme } from '../ThemeProvider';
import DesktopLayoutToggle from './DesktopPreviewControls';
import { useDesktopPageActions, useDesktopWorkspace } from './DesktopWorkspace';
import RegistrationSheet from './RegistrationSheet';
import UiVersionSwitch from './UiVersionSwitch';

interface Props {
  title: string;
  page: string;
  enabled?: boolean;
  children: React.ReactNode;
  groups: ComparisonGroup[];
  categories: Category[];
  isGuest: boolean;
  onReload?: () => Promise<void>;
}

export default function DesktopPage({ title, page, enabled = true, children, groups, categories, isGuest, onReload }: Props) {
  const desktop = useDesktopWorkspace();
  const { palette, resolvedTheme } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const frame = useRef<HTMLDivElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const active = enabled && desktop.active;
  function openRegistration() {
    if (busy) return;
    if (!open) invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice('');
    setOpen(true);
  }
  useDesktopPageActions(openRegistration, busy);
  function close() {
    setOpen(false);
    setBusy(false);
    requestAnimationFrame(() => (invoker.current?.isConnected && invoker.current.getClientRects().length ? invoker.current : frame.current)?.focus({ preventScroll: true }));
  }
  const comparison = <DesktopLayoutToggle value={desktop.layout} onChange={desktop.choose}/>;
  return <div className={`desktop-secondary-page${enabled ? ' design-review' : ''}`} data-page={page} data-desktop-layout={active ? 'workspace' : 'current'}>
    <div className="desktop-page-frame" ref={frame} tabIndex={-1} data-panel-open={open}>
      <div className="desktop-page-surface" inert={busy || (open && !active)}>
        {enabled && <header className="desktop-page-heading">
          <h1>{title}</h1>
          <div>{!open && comparison}<span className="desktop-page-version"><UiVersionSwitch enabled/></span></div>
        </header>}
        {notice && <p className="desktop-page-notice" role="status">{notice}</p>}
        <div className="desktop-page-content">{children}</div>
      </div>
      {open && <div className="desktop-page-registration"><RegistrationSheet groups={groups} categories={categories} isGuest={isGuest}
        presentation={active ? 'aside' : 'modal'} toolbar={comparison} onCancel={close} onSavingChange={setBusy}
        onSaved={message => { close(); setNotice(message); void onReload?.(); }}
        onExisting={location => { close(); router.push(reviewHref('rank', location === 'list' ? undefined : location, palette, resolvedTheme)); }}/></div>}
    </div>
  </div>;
}
