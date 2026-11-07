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

const idle = 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600';
const active = 'bg-[var(--shu)] text-white shadow-md';

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
    <div className="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-20">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <nav className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onChange(tab.id);
                  if (tab.id === 'list') onOpenList();
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id ? active : idle
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
