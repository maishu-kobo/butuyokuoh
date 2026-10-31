import type { Metadata } from 'next';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import {
  AGENT_AUDIT_RETENTION_DAYS,
  AGENT_RATE_LIMITS,
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
} from '@/lib/agent-access-limits';

export const metadata: Metadata = {
  title: 'エージェント連携 - 物欲王',
};

export default function AgentHelpPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <h1 className="text-2xl font-bold">エージェント連携</h1>
        <p>
          AIエージェントから、自分のほしいものリストを読んだり更新したりできます。
          ここでは、トークンと OAuth、回数の上限を説明します。
        </p>

        <h2 className="text-lg font-semibold pt-2">つなぎ方</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            設定画面でエージェント用トークンを発行し、対応する AI エージェントや MCP クライアントに渡します。
          </li>
          <li>
            OAuth 対応の MCP クライアントは、同意画面で許可すると、同じ種類のアクセス・トークンが発行されます。
          </li>
          <li>
            使い方の技術メモはサイト上のエージェント向け案内（llms.txt）にもあります。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">トークンの発行と無効化</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            設定画面の「エージェント用トークン」から、トークンを発行・無効化できます。
          </li>
          <li>
            トークンの文字列は、発行したときに一度だけ表示します。あとから同じ文字列を見ることはできません。
          </li>
          <li>
            いらなくなったトークンや、漏れたかもしれないトークンは、すぐに無効にしてください。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">有効期限</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            既定の有効期限は{AGENT_TOKEN_DEFAULT_DAYS}日です。最大は{AGENT_TOKEN_MAX_DAYS}日です。
          </li>
          <li>
            パスワードを変えると、発行済みのエージェント用トークンはすべて無効になります。
          </li>
          <li>
            ログアウトでは、エージェント用トークンは無効になりません。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">できる操作</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>リストを読む</li>
          <li>品目を追加する</li>
          <li>品目を更新する</li>
          <li>購入済みにする</li>
          <li>ゴミ箱に移す</li>
        </ul>
        <p>
          完全に削除することはできません。間違えた操作は、取り消し機能で戻せる場合があります。
          操作の記録は{AGENT_AUDIT_RETENTION_DAYS}日間保存します。
        </p>

        <h2 className="text-lg font-semibold pt-2">回数の上限</h2>
        <p>使いすぎを防ぐため、次の上限があります。値は変わることがあります。</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>読み取り：1分あたり{AGENT_RATE_LIMITS.read}回</li>
          <li>追加：1分あたり{AGENT_RATE_LIMITS.add}回</li>
          <li>URLの追加：1分あたり{AGENT_RATE_LIMITS.add_url}回</li>
          <li>追加の1日上限：{AGENT_RATE_LIMITS.add_day}件</li>
        </ul>

        <p className="pt-2 text-sm text-[var(--color-muted)]">
          取扱いの詳細は
          <Link href="/privacy" className="underline underline-offset-2 mx-1">プライバシーポリシー</Link>
          と
          <Link href="/terms" className="underline underline-offset-2 mx-1">利用規約</Link>
          をご覧ください。
        </p>
        <LegalLinks />
      </article>
    </main>
  );
}
