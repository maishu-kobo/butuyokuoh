'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Info } from 'lucide-react';
import {
  MCP_ADVANCED_CLAUDE,
  MCP_ADVANCED_TOKEN,
  MCP_ASK_EXAMPLES,
  MCP_CARD_SUBTITLE,
  MCP_CARD_TITLE,
  MCP_CLIENT_GUIDES,
  MCP_CONNECT_STEPS,
  MCP_GUEST_HINT,
  MCP_LOCALHOST_NOTE,
  MCP_OAUTH_NO_TOKEN,
  MCP_TOKEN_NEEDED_CASES,
  MCP_TOKEN_NEEDED_INTRO,
  MCP_TROUBLESHOOTING,
  MCP_URL_LABEL,
  MCP_WHAT_IS,
  isLoopbackMcpUrl,
} from '@/lib/mcp-connection-copy';

/** 「全て更新」などと同じ中立セカンダリ。赤（危険色）は破壊操作だけに使う。 */
const SECONDARY_BTN =
  'shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors';

export function McpConnectionInfoPanel({ url }: { url: string }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium mb-1">これは何か</p>
        <p className="text-[var(--color-muted)]">{MCP_WHAT_IS}</p>
      </div>

      <div>
        <p className="font-medium mb-1">トークンは基本いらない</p>
        <p className="text-[var(--color-muted)]">{MCP_OAUTH_NO_TOKEN}</p>
      </div>

      <div>
        <p className="font-medium mb-1">つなぎ方（共通）</p>
        <ol className="list-decimal pl-4 space-y-1 text-[var(--color-muted)]">
          {MCP_CONNECT_STEPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>

      <div>
        <p className="font-medium mb-1">AIごとのつなぎ方</p>
        <div className="space-y-3">
          {MCP_CLIENT_GUIDES.map((guide) => (
            <div key={guide.name}>
              <p className="text-[var(--color-text)] font-medium">{guide.name}</p>
              <ol className="list-decimal pl-4 space-y-1 text-[var(--color-muted)]">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {guide.note ? (
                <p className="mt-1 text-[var(--color-muted)] text-sm">{guide.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="font-medium mb-1">トークンが要るとき</p>
        <p className="text-[var(--color-muted)] mb-1">{MCP_TOKEN_NEEDED_INTRO}</p>
        <ul className="list-disc pl-4 space-y-1 text-[var(--color-muted)]">
          {MCP_TOKEN_NEEDED_CASES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="font-medium mb-1">AI に頼めること</p>
        <ul className="list-disc pl-4 space-y-1 text-[var(--color-muted)]">
          {MCP_ASK_EXAMPLES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="font-medium mb-1">うまくつながらないとき</p>
        <p className="text-[var(--color-muted)] mb-2">{MCP_TROUBLESHOOTING}</p>
        <details className="rounded-md border border-[var(--color-border)] bg-white/60 dark:bg-slate-900/40 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
            上級者向け（トークンとコマンド）
          </summary>
          <ul className="mt-2 list-disc pl-4 space-y-1 text-[var(--color-muted)] text-sm">
            <li>{MCP_ADVANCED_TOKEN}</li>
            <li>{MCP_ADVANCED_CLAUDE}</li>
          </ul>
        </details>
      </div>

      <p className="text-[var(--color-muted)]">
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
    </div>
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
  const showLocalhostNote = isLoopbackMcpUrl(url);

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
            <button
              ref={infoButtonRef}
              type="button"
              className="p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label="AIエージェント接続の説明を開く"
              aria-expanded={infoOpen}
              aria-controls={panelId}
              onClick={() => setInfoOpen((open) => !open)}
            >
              <Info size={16} aria-hidden="true" />
            </button>
          </div>

          <p className={`text-[var(--color-muted)] ${variant === 'home' ? 'text-xs' : 'text-sm'}`}>
            {MCP_CARD_SUBTITLE}
          </p>

          {infoOpen && (
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="AIエージェント接続の説明"
              className="w-full rounded-lg border border-[var(--color-border)] bg-gray-50 dark:bg-slate-800/60 p-3 text-sm text-[var(--color-text)]"
            >
              <McpConnectionInfoPanel url={url} />
            </div>
          )}

          {guest && (
            <p className="text-xs text-amber-800 dark:text-amber-200">{MCP_GUEST_HINT}</p>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--color-muted)]">{MCP_URL_LABEL}</p>
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
                className={SECONDARY_BTN}
                aria-label={copied ? '接続用URLをコピー済み' : '接続用URLをコピー'}
              >
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? 'コピーした' : 'コピー'}
              </button>
            </div>
            {showLocalhostNote && (
              <p className="text-[11px] leading-snug text-[var(--color-muted)]">{MCP_LOCALHOST_NOTE}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
