/** MCP 接続カード用の短い説明文（画面とテストで共有）。 */

export const MCP_CARD_TITLE = 'AI エージェントとつなぐ';

export const MCP_CARD_SUBTITLE =
  'ChatGPT や Claude など、いつもの AI から欲しいものリストを見たり、商品を登録したりできます。';

export const MCP_URL_LABEL = '接続用 URL（MCP）';

export const MCP_LOCALHOST_NOTE =
  'これは開発用のアドレスです。ChatGPT や claude.ai など Web の AI からはつながりません。同じパソコンの Claude Code や Cursor から使えます。';

export const MCP_GUEST_HINT = 'ログインするとエージェント連携が使えます';

export const MCP_WHAT_IS =
  '自分の AI（ChatGPT、Claude、Cursor など）を物欲王につなぐための URL です。MCP は、AI とサービスをつなぐ共通のしくみです。';

/** AI への頼み方の例。AGENT_TOOLS にある操作だけ。 */
export const MCP_ASK_EXAMPLES = [
  '「この商品を物欲王に入れて」— URL や名前で登録できます。複数店の URL も1商品にまとめられます。価格は物欲王が取り直します',
  '「欲しいものリストを見せて」— 一覧や検索ができます',
  '「今月の予算あといくら？」— 出費予定の合計を確認できます',
  'カテゴリや価格の履歴も聞けます。購入済みにしたり、ゴミ箱へ移したり、名前やメモの更新もできます（価格・画像は変えられません）',
] as const;

export const MCP_CONNECT_STEPS = [
  '上の URL をコピーします',
  '使っている AI の設定で、「コネクター」や「MCP サーバー」を追加する画面を開き、URL を貼ります。メニュー名はアプリごとに違うので、そのアプリの公式ヘルプも見てください',
  '物欲王の許可画面が出たら「許可」を選びます',
] as const;

export const MCP_TROUBLESHOOTING =
  'うまくつながらないときは、設定でトークンを発行して渡す方法もあります。';

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
