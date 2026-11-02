/** MCP 接続カード用の短い説明文（画面とテストで共有）。 */

export const MCP_CAPABILITY_BULLETS = [
  'ほしいものリストの閲覧・検索',
  '商品 URL や名前での登録（価格はサーバーが取り直します）',
  '品目の更新（価格・画像は変更できません）',
  '購入済み・ゴミ箱への移動',
  '価格履歴・カテゴリ・予算の確認',
] as const;

export const MCP_CONNECT_BULLETS = [
  'OAuth 対応のクライアントは、この URL を入れるだけでつながります',
  'それ以外は設定でトークンを発行し、Authorization: Bearer で渡します',
  'Claude Code の例: claude mcp add --transport http butuyokuoh <URL>',
] as const;

export const MCP_CARD_TITLE = 'MCP 接続 URL';

export const MCP_GUEST_HINT = 'ログインするとエージェント連携が使えます';
