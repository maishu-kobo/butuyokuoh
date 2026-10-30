'use client';

import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';

export default function HomeHeader({
  user,
  onLogout,
}: {
  user: { name: string | null; email: string | null };
  onLogout: () => void;
}) {
  return (
    <header className="home-header">
      <div className="home-header-inner">
        <h1 className="home-wordmark">物欲王</h1>
        <div className="home-account">
          <span className="home-account-name">{user.name || user.email}</span>
          <Link href="/settings" className="home-icon-action" aria-label="設定" title="設定">
            <Settings size={20} aria-hidden="true" />
          </Link>
          <button type="button" onClick={onLogout} className="home-icon-action" aria-label="ログアウト" title="ログアウト">
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
