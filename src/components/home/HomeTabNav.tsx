'use client';

import { BarChart3, List, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import type { HomeTab } from '@/lib/home-wishlist';

const TABS: { id: HomeTab; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'リスト', icon: List },
  { id: 'budget', label: '出費予定', icon: Wallet },
  { id: 'purchased', label: '購入済', icon: ShoppingBag },
  { id: 'stats', label: '統計', icon: BarChart3 },
  { id: 'trash', label: 'ゴミ箱', icon: Trash2 },
];

export default function HomeTabNav({
  activeTab,
  onChange,
  onOpenList,
}: {
  activeTab: HomeTab;
  onChange: (tab: HomeTab) => void;
  onOpenList: () => void;
}) {
  return (
    <div className="home-nav-shell">
      <nav className="home-nav" aria-label="物欲王の画面">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeTab === tab.id}
              onClick={() => {
                onChange(tab.id);
                if (tab.id === 'list') onOpenList();
              }}
              className="home-nav-action"
            >
              <Icon size={16} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
