import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import McpConnectionCard from '@/components/mcp/McpConnectionCard';
import {
  AGENT_AUDIT_RETENTION_DAYS,
  AGENT_RATE_LIMITS,
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
} from '@/lib/agent-access-limits';
import {
  MCP_CLIENT_GUIDES,
  MCP_OAUTH_NO_TOKEN,
  MCP_TOKEN_NEEDED_CASES,
  MCP_TOKEN_NEEDED_INTRO,
} from '@/lib/mcp-connection-copy';

export default function AgentHelpContent({ mcpUrl }: { mcpUrl: string }) {
  const agentItemsUrl = mcpUrl.replace(/\/api\/mcp\/?$/, '/api/agent/v1/items');
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <article className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">アプリへ戻る</Link>
        </p>
        <h1 className="text-2xl font-bold">エージェント連携</h1>
        <p>
          自分の AI（ChatGPT や Claude など）から、ほしいものリストを読んだり更新したりできます。
          まずは下の URL をコピーして、使っている AI の設定に貼ります。
        </p>

        <McpConnectionCard url={mcpUrl} variant="help" />

        <h2 className="text-lg font-semibold pt-2">トークンは基本いらない</h2>
        <p>{MCP_OAUTH_NO_TOKEN}</p>

        <h2 className="text-lg font-semibold pt-2">AIごとのつなぎ方</h2>
        <p>
          メニュー名は各 AI の公式ヘルプの表記です。画面が違うときは、その AI の公式ヘルプで
          「コネクター」「MCP」「custom connector」を探してください。
        </p>
        {MCP_CLIENT_GUIDES.map((guide) => (
          <div key={guide.name} className="space-y-2">
            <h3 className="text-base font-semibold">{guide.name}</h3>
            <ol className="list-decimal pl-6 space-y-2">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {guide.note ? <p>{guide.note}</p> : null}
          </div>
        ))}

        <h2 className="text-lg font-semibold pt-2">トークンが要るとき</h2>
        <p>{MCP_TOKEN_NEEDED_INTRO}</p>
        <ul className="list-disc pl-6 space-y-2">
          {MCP_TOKEN_NEEDED_CASES.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            使い方の技術メモはサイト上のエージェント向け案内（llms.txt）にもあります。
          </li>
        </ul>

        <h2 className="text-lg font-semibold pt-2">iPhone の Siri・ショートカットから使う</h2>
        <p>
          iPhone のショートカット App と組み合わせると、Siri に話しかけて品目を追加したり、
          Safari で見ている商品ページを共有シートから登録したりできます。専用のアプリは要りません。
          ショートカットは OAuth ではなくトークンを使うため、設定でエージェント用トークンが必要です。
        </p>
        <ol className="list-decimal pl-6 space-y-2">
          <li>設定画面でエージェント用トークンを発行し、コピーします。</li>
          <li>
            ショートカット App で新しいショートカットを作り、はじめに「テキストを入力」などで
            商品名や商品ページのURLを受け取るアクションを足します。
          </li>
          <li>
            「URL の内容を取得」アクションを足し、{agentItemsUrl} へ POST する設定にします。
            ヘッダは Authorization に「Bearer 発行したトークン」、Content-Type に「application/json」。
            本文は {'{"name": "商品名"}'} の形の JSON です。「url」も入れると、価格と画像をサーバが取ります。
          </li>
          <li>
            ショートカットに「ほしいもの追加」などの名前を付けます。
            Siri にその名前を話しかけると、そのショートカットが起動します。
          </li>
        </ol>
        <p>
          共有シートに出す設定にすると、Safari で開いている商品ページをそのまま登録できます。
          トークンの文字列はショートカットの中に残るので、ほかの人と共有するときは自分のトークンを外してください。
        </p>
        <p>
          Claude の iPhone アプリを使う場合は、カスタムコネクタに上の「自分の AI につなぐ URL」を登録すると、
          「Ask Claude」から Siri 経由で操作できます（こちらはログインして許可する方式で、手動トークンは不要です）。
        </p>

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
