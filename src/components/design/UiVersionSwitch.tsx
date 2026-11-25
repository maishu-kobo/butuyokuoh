'use client';

import { useRouter } from 'next/navigation';
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
  function toggle() {
    setUiVersion(enabled ? 'legacy' : 'new');
    if (enabled) {
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
  return <button type="button" role="switch" aria-checked={enabled} aria-label="新しい表示を使う"
    title={enabled ? '従来の表示に切り替え' : '新しい表示に切り替え'} className="ui-version-switch" onClick={toggle}>
    <span className="ui-version-track" aria-hidden="true"><span /></span>
  </button>;
}
