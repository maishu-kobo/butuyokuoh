'use client';

import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@astryxdesign/core/DropdownMenu';
import { ArrowLeftRight, LayoutGrid, PanelsTopLeft } from 'lucide-react';
import { useTheme } from '../ThemeProvider';
import { readReviewTab, readReviewView, reviewHref } from '@/lib/design-home';
import { readLightPalette, readPreviewAppearance } from '@/lib/design-palettes';
import { readListPreview } from '@/lib/design-list-preview';

const savedLocationKey = 'butuyokuoh:new-ui-location';

// Only known local routes and parameters can become a navigation destination.
function newUiHref(value: string | null): string {
  if (!value || !(value === '/design' || value.startsWith('/design?'))) return '/design';
  const params = new URLSearchParams(value.split('?')[1]);
  return reviewHref(readReviewView(params.get('view')), readReviewTab(params.get('tab')),
    readLightPalette(params.get('palette')), readPreviewAppearance(params.get('appearance')),readListPreview(params.get('list')));
}

export default function UiVersionSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { setUiVersion } = useTheme();
  function choose(version: string) {
    if (version !== 'new' && version !== 'legacy') return;
    if ((version === 'new') === enabled) return;
    setUiVersion(version);
    if (version === 'legacy') {
      const current = newUiHref(window.location.pathname + window.location.search);
      try { localStorage.setItem(savedLocationKey, current); } catch { /* Navigation also works when storage is unavailable. */ }
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab') || (params.get('view') === 'plan' ? 'budget' : null);
      const legacyTab = ['budget', 'purchased', 'stats', 'trash'].includes(tab ?? '') ? tab : null;
      router.push(legacyTab ? '/?tab=' + legacyTab : '/');
    } else {
      let saved: string | null = null;
      try { saved = localStorage.getItem(savedLocationKey); } catch { /* Use the default new home. */ }
      router.push(newUiHref(saved));
    }
  }
  return <DropdownMenu className="ui-version-menu" aria-label="画面デザイン" menuWidth={224} alignment="end"
    renderTrigger={props => <button {...props} type="button" className="ui-version-switch"
      aria-label="画面の表示切替" title="画面の表示を切り替える">
      <PanelsTopLeft size={21} aria-hidden="true" />
      <ArrowLeftRight size={13} className="ui-version-arrows" aria-hidden="true" />
    </button>}>
    <DropdownMenuRadioGroup label="画面デザイン" value={enabled ? 'new' : 'legacy'} onChange={choose}>
      <DropdownMenuRadioItem value="new" label="新しい表示" icon={<PanelsTopLeft size={19} aria-hidden="true" />} />
      <DropdownMenuRadioItem value="legacy" label="従来の表示" icon={<LayoutGrid size={19} aria-hidden="true" />} />
    </DropdownMenuRadioGroup>
  </DropdownMenu>;
}
