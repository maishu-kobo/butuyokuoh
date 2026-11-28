'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { BarChart3, ListChecks, LogOut, Plus, Settings, ShoppingBag, SlidersHorizontal, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '../AuthProvider';
import { useTheme } from '../ThemeProvider';
import { reviewHref, reviewSettingsHref, type ReviewTab } from '@/lib/design-home';
import { useDesktopPreview } from './DesktopPreviewControls';
import UiVersionSwitch from './UiVersionSwitch';

type Workspace = ReturnType<typeof useDesktopPreview> & {
  registerAction: (action: () => void) => () => void;
  setBusy: (busy: boolean) => void;
  openRegistration: () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);

export function useDesktopWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('DesktopWorkspace is required');
  return context;
}

// Each page keeps its own form mounted while the shared navigation invokes it.
export function useDesktopPageActions(open: () => void, busy: boolean) {
  const { registerAction, setBusy } = useDesktopWorkspace();
  useEffect(() => registerAction(open), [registerAction, open]);
  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);
}

const primary = [
  { tab: undefined, label: 'ほしいものリスト', Icon: ListChecks },
  { tab: 'budget', label: '出費予定', Icon: Wallet },
  { tab: 'manage', label: 'リストの管理', Icon: SlidersHorizontal },
] as const;
const secondary = [
  { tab: 'purchased', label: '購入履歴', Icon: ShoppingBag },
  { tab: 'stats', label: '統計', Icon: BarChart3 },
  { tab: 'trash', label: 'ゴミ箱', Icon: Trash2 },
] as const;

export default function DesktopWorkspace({ children }: { children: React.ReactNode }) {
  const desktop = useDesktopPreview();
  const { user, logout } = useAuth();
  const { isNewUi, palette, resolvedTheme } = useTheme();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const action = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(user && isNewUi && desktop.active && (pathname === '/design' || pathname === '/settings'));
  const requested = params?.get('tab');
  const selected = desktop.layout === 'reading' && requested === 'manage' ? undefined : requested || (params?.get('view') === 'plan' ? 'budget' : undefined);
  const registerAction = useCallback((next: () => void) => {
    action.current = next;
    return () => { if (action.current === next) action.current = null; };
  }, []);
  const openRegistration = useCallback(() => action.current?.(), []);
  useLayoutEffect(() => {
    const banner = document.querySelector<HTMLElement>('[data-app-banner]');
    if (!banner || !enabled) return;
    const fit = () => root.current?.style.setProperty('--home-banner-height', `${banner.getBoundingClientRect().height}px`);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(banner);
    return () => observer.disconnect();
  }, [enabled]);
  function links(entries: readonly { tab?: ReviewTab; label: string; Icon: typeof ListChecks }[]) {
    return entries.map(({ tab, label, Icon }) => <Link key={label} href={reviewHref('rank', tab, palette, resolvedTheme)}
      aria-current={pathname === '/design' && selected === tab ? 'page' : undefined}>
      <Icon size={19} aria-hidden /><span>{label}</span>
    </Link>);
  }
  return <WorkspaceContext.Provider value={{ ...desktop, registerAction, setBusy, openRegistration }}>
    <div ref={root} className={`desktop-workspace${enabled ? ' design-review' : ''}`} data-desktop-enabled={enabled}>
      <nav className="desktop-sidebar" aria-label="PCナビゲーション" inert={busy || !enabled}>
        <Link className="desktop-brand" href={reviewHref('rank', undefined, palette, resolvedTheme)}><Image unoptimized alt="" src="/icons/icon-192.png" width={31} height={31}/><span>物欲王</span></Link>
        <Button type="button" variant="primary" className="desktop-register" icon={<Plus size={19}/>} label="登録" onClick={openRegistration}/>
        <div className="desktop-nav-primary">{links(desktop.layout === 'reading' ? primary.filter(entry => entry.tab !== 'manage') : primary)}</div>
        <div className="desktop-nav-secondary">{links(secondary)}</div>
        <div className="desktop-nav-bottom">
          {enabled && <UiVersionSwitch enabled inSidebar/>}
          <Link href={reviewSettingsHref('rank', palette, resolvedTheme)} aria-current={pathname === '/settings' ? 'page' : undefined}><Settings size={18} aria-hidden/><span>設定</span></Link>
          <button type="button" onClick={async () => { await logout(); router.push('/'); }}><LogOut size={18} aria-hidden/><span>ログアウト</span></button>
        </div>
      </nav>
      <div className="desktop-workspace-content">{children}</div>
    </div>
  </WorkspaceContext.Provider>;
}
