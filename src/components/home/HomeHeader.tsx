'use client';

import Link from 'next/link';
import { Crown, LogOut, Settings, User } from 'lucide-react';

export default function HomeHeader({
  user,
  onLogout,
}: {
  user: { name: string | null; email: string | null };
  onLogout: () => void;
}) {
  return (
    <header className="bg-[var(--ai)] text-white shadow-lg">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown size={28} className="text-[var(--kitsune)]" />
            <h1 className="text-xl font-bold">物欲王</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-amber-100 text-sm">
              <User size={16} />
              <span>{user.name || user.email}</span>
            </div>
            <Link
              href="/settings"
              className="p-2 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="設定"
            >
              <Settings size={20} />
            </Link>
            <button
              onClick={onLogout}
              className="p-2 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="ログアウト"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
