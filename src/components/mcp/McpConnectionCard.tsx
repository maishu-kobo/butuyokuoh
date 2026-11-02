'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Info } from 'lucide-react';
import {
  MCP_CAPABILITY_BULLETS,
  MCP_CARD_TITLE,
  MCP_CONNECT_BULLETS,
  MCP_GUEST_HINT,
} from '@/lib/mcp-connection-copy';

export function McpConnectionInfoPanel({ url }: { url: string }) {
  return (
    <>
      <p className="font-medium mb-1">できること</p>
      <ul className="list-disc pl-4 space-y-1 text-[var(--color-muted)]">
        {MCP_CAPABILITY_BULLETS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="font-medium mt-3 mb-1">つなぎ方</p>
      <ul className="list-disc pl-4 space-y-1 text-[var(--color-muted)]">
        {MCP_CONNECT_BULLETS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-3 text-[var(--color-muted)]">
        詳しくは
        <Link href="/help/agents" className="underline underline-offset-2 mx-1">
          エージェント連携のヘルプ
        </Link>
        と
        <Link href="/settings" className="underline underline-offset-2 mx-1">
          設定
        </Link>
        へ。
      </p>
      <p className="sr-only">接続先: {url}</p>
    </>
  );
}

export type McpConnectionCardProps = {
  /** mcpResourceUrl() と同じ値 */
  url: string;
  /** ゲスト向けの短い案内を出す */
  guest?: boolean;
  /** home=コンパクト / help・settings=やや広め */
  variant?: 'home' | 'help' | 'settings';
  className?: string;
};

export default function McpConnectionCard({
  url,
  guest = false,
  variant = 'home',
  className = '',
}: McpConnectionCardProps) {
  const [copied, setCopied] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const panelId = useId();
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInfoOpen(false);
        infoButtonRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (infoButtonRef.current?.contains(target)) return;
      setInfoOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [infoOpen]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const padding = variant === 'home' ? 'p-3' : 'p-4';

  return (
    <section
      className={`bg-[var(--color-card)] rounded-lg shadow border border-[var(--color-border)] ${padding} ${className}`}
      aria-label={MCP_CARD_TITLE}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h2 className={`font-semibold text-[var(--color-text)] ${variant === 'home' ? 'text-sm' : 'text-base'}`}>
              {MCP_CARD_TITLE}
            </h2>
            <div className="relative">
              <button
                ref={infoButtonRef}
                type="button"
                className="p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
                aria-label="MCP接続の説明を開く"
                aria-expanded={infoOpen}
                aria-controls={panelId}
                onClick={() => setInfoOpen((open) => !open)}
              >
                <Info size={16} aria-hidden="true" />
              </button>
              {infoOpen && (
                <div
                  ref={panelRef}
                  id={panelId}
                  role="dialog"
                  aria-label="MCP接続の説明"
                  className="absolute left-0 z-20 mt-1 w-[min(100vw-2rem,20rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-lg text-sm text-[var(--color-text)]"
                >
                  <McpConnectionInfoPanel url={url} />
                </div>
              )}
            </div>
          </div>

          {guest && (
            <p className="text-xs text-amber-800 dark:text-amber-200">{MCP_GUEST_HINT}</p>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code
              className="block min-w-0 flex-1 truncate rounded-md bg-gray-50 dark:bg-slate-800/80 px-2.5 py-1.5 text-xs sm:text-sm font-mono text-[var(--color-text)] border border-[var(--color-border)]"
              title={url}
            >
              {url}
            </code>
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] transition-colors"
              aria-label={copied ? 'MCP接続URLをコピー済み' : 'MCP接続URLをコピー'}
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? 'コピーした' : 'コピー'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
