/** エージェント接続カード／ヘルプ用の短い説明文（画面とテストで共有）。 */

export const MCP_CARD_TITLE = 'AI エージェントとつなぐ';

export const MCP_CARD_SUBTITLE =
  '自分の AI（ChatGPT や Claude など）から、欲しいものリストを見たり商品を登録したりできます。';

/** 画面上のラベル。専門用語だけに頼らず、何の URL か分かるようにする。 */
export const MCP_URL_LABEL = '自分の AI につなぐ URL';

export const MCP_LOCALHOST_NOTE =
  'これは開発用のアドレスです。ChatGPT や claude.ai など Web の AI からはつながりません。同じパソコンの Claude Code や Cursor から使えます。';

export const MCP_GUEST_HINT = 'ログインするとエージェント連携が使えます';

export const MCP_WHAT_IS =
  '自分の AI（ChatGPT、Claude、Cursor、Grok Bot など）を物欲王につなぐための住所です。AI 側の「コネクター」や「MCP サーバー」の欄に貼ります。';

/**
 * OAuth 対応クライアントでは手動トークン不要（コード: agent-oauth / agent-mcp、
 * クライアント公式: Claude Connectors / Claude Code MCP / ChatGPT custom MCP / Cursor MCP）。
 */
export const MCP_OAUTH_NO_TOKEN =
  'ログインして許可する方式（OAuth）に対応した AI では、物欲王の設定でエージェント用トークンを自分で発行する必要はありません。URL を貼って、物欲王の許可画面で「許可」すれば足ります。';

/** AI への頼み方の例。AGENT_TOOLS にある操作だけ。 */
export const MCP_ASK_EXAMPLES = [
  '「この商品を物欲王に入れて」— URL や名前で登録できます。複数店の URL も1商品にまとめられます。価格は物欲王が取り直します',
  '「欲しいものリストを見せて」— 一覧や検索ができます',
  '「今月の予算あといくら？」— 出費予定の合計を確認できます',
  'カテゴリや価格の履歴も聞けます。購入済みにしたり、ゴミ箱へ移したり、名前やメモの更新もできます（価格・画像は変えられません）',
  '「ゴミ箱のこれを完全に消して、同じ URL で登録し直して」— ゴミ箱に移した品目は1件ずつ完全に削除でき、そのあと同じ URL を新しく登録して価格・画像を取り直せます。ゴミ箱を空にする操作はありません',
] as const;

/** 共通の流れ（詳細は AI ごと）。 */
export const MCP_CONNECT_STEPS = [
  '上の URL をコピーします',
  '下の「AIごとのつなぎ方」で、使っている AI の手順どおりに URL を貼ります',
  '物欲王の許可画面が出たら「許可」を選びます（OAuth 対応の AI では、ここで終わりです）',
] as const;

export type McpClientGuide = {
  /** 見出し（クライアント名） */
  name: string;
  /** 公式ドキュメントまたはリポ内で確認した手順だけ */
  steps: readonly string[];
  /** 補足（プラン制限など）。無いときは出さない */
  note?: string;
};

/**
 * AI ごとの貼り付け場所。手順は公式ヘルプ／ドキュメントで確認したものだけ。
 * - Claude: support.claude.com（Customize → Connectors → Add custom connector）
 * - Claude Code: code.claude.com/docs/en/mcp（claude mcp add --transport http、/mcp または claude mcp login）
 * - ChatGPT: help.openai.com / developers.openai.com（Plugins → Add custom MCP server）
 * - Cursor: cursor.com/docs/mcp（Customize または mcp.json の url）
 * - Grok Bot: cursor.com/docs/mcp と cursor.com/docs/grok-bot/work（Connect apps でログイン）
 */
export const MCP_CLIENT_GUIDES: readonly McpClientGuide[] = [
  {
    name: 'Claude（claude.ai・デスクトップ・スマホ）',
    steps: [
      'Customize → Connectors を開く',
      '「+ Add」→「Add custom connector」を選ぶ',
      '名前と、上の URL（Remote MCP server URL）を入れる',
      '認証の案内に従い、物欲王の許可画面で許可する',
    ],
    note: '手動のエージェント用トークンは不要です。メニュー名は公式の英語表記のままです。',
  },
  {
    name: 'Claude Code（ターミナル）',
    steps: [
      'ターミナルで次を実行する（末尾は上の URL）: claude mcp add --transport http butuyokuoh …',
      'claude を起動し、/mcp からログインする（または claude mcp login butuyokuoh）',
      'ブラウザで物欲王の許可画面が出たら許可する',
    ],
    note: '手動のエージェント用トークンは不要です。Bearer を自分で付けたいときだけ --header を使います。',
  },
  {
    name: 'ChatGPT（Web）',
    steps: [
      'Plugins を開く',
      '「+」→「Add custom MCP server」を選ぶ',
      '名前を入れ、Connection の Server URL に上の URL を貼る（本番は https。localhost ではつながらない）',
      '認証で OAuth（ログイン）を選び、注意事項に同意して作成し、物欲王の許可画面で許可する',
      '作成後はプラグインをインストールし、会話で @ から選んで使う',
    ],
    note:
      '手動のエージェント用トークンは不要です。公式ヘルプによると、カスタム MCP の接続は主に Business / Enterprise・Edu 向けです（プランによって画面が出ないことがあります）。スマホアプリからは追加できません。くわしくは OpenAI の「Connecting custom MCP servers in ChatGPT」を見てください。',
  },
  {
    name: 'Cursor',
    steps: [
      'サイドバーの Customize から MCP を追加するか、~/.cursor/mcp.json（全体）または .cursor/mcp.json（このプロジェクト）を開く',
      'mcpServers に、url へ上の URL を書いたエントリを追加する',
      '表示されたログイン案内に従い、物欲王の許可画面で許可する',
    ],
    note: '手動のエージェント用トークンは不要です。OAuth 対応のリモート接続では headers にトークンを書かなくて大丈夫です。',
  },
  {
    name: 'Grok Bot',
    steps: [
      'Cursor と同じく、Customize または mcp.json の url に上の URL を入れる',
      'Grok Bot のサイドバーで Connect apps を開き、接続のログインをブラウザで完了する',
    ],
    note:
      '手動のエージェント用トークンは不要です（OAuth）。Grok Bot は Cursor の MCP 設定を使います。チャットに URL を貼るだけの手順は、公式ドキュメントには載っていません。',
  },
] as const;

/** トークンがまだ必要なケース（設定の PAT、REST、ヘッダ直指定）。 */
export const MCP_TOKEN_NEEDED_INTRO =
  '次のときは、設定の「エージェント用トークン」を発行して使います。';

export const MCP_TOKEN_NEEDED_CASES = [
  'ログインして許可する方式（OAuth）に対応していない AI やツールを使うとき',
  'iPhone のショートカットや、REST API を自分で呼ぶとき（Authorization: Bearer にトークンを付ける）',
  'Claude Code で --header に Authorization: Bearer を付けて登録するとき',
] as const;

export const MCP_TROUBLESHOOTING =
  'うまくつながらないときは、使っている AI の公式ヘルプで「コネクター」「MCP」「custom connector」を探し、上の手順と食い違っていないか確認してください。それでもだめなときは、設定でトークンを発行して渡す方法もあります。';

export const MCP_ADVANCED_TOKEN =
  '設定でエージェント用トークンを発行し、リクエストに Authorization: Bearer で渡します。';

export const MCP_ADVANCED_CLAUDE =
  'Claude Code の例: claude mcp add --transport http butuyokuoh <URL>';

/** 表示 URL が開発用（localhost / 127.0.0.1 / ::1）かどうか。 */
export function isLoopbackMcpUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}
