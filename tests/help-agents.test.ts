import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentHelpPage from '../src/app/help/agents/page';
import {
  AGENT_AUDIT_RETENTION_DAYS,
  AGENT_RATE_LIMITS,
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
} from '../src/lib/agent-access-limits';

test('エージェント連携ヘルプは定数の数字を出し、秘密や内部構成を出さない', () => {
  const page = renderToStaticMarkup(createElement(AgentHelpPage));
  assert.match(page, /エージェント連携/);
  assert.match(page, /つなぎ方/);
  assert.match(page, /OAuth 対応の MCP クライアント/);
  assert.match(page, /設定画面の「エージェント用トークン」/);
  assert.match(page, /発行したときに一度だけ表示します/);
  assert.match(page, new RegExp(`既定の有効期限は${AGENT_TOKEN_DEFAULT_DAYS}日`));
  assert.match(page, new RegExp(`最大は${AGENT_TOKEN_MAX_DAYS}日`));
  assert.match(page, /パスワードを変えると、発行済みのエージェント用トークンはすべて無効になります/);
  assert.match(page, /ログアウトでは、エージェント用トークンは無効になりません/);
  assert.match(page, /リストを読む/);
  assert.match(page, /品目を追加する/);
  assert.match(page, /品目を更新する/);
  assert.match(page, /購入済みにする/);
  assert.match(page, /ゴミ箱に移す/);
  assert.match(page, /完全に削除することはできません/);
  assert.match(page, /取り消し機能で戻せる場合があります/);
  assert.match(page, new RegExp(`操作の記録は${AGENT_AUDIT_RETENTION_DAYS}日間保存します`));
  assert.match(page, new RegExp(`読み取り：1分あたり${AGENT_RATE_LIMITS.read}回`));
  assert.match(page, new RegExp(`追加：1分あたり${AGENT_RATE_LIMITS.add}回`));
  assert.match(page, new RegExp(`URLの追加：1分あたり${AGENT_RATE_LIMITS.add_url}回`));
  assert.match(page, new RegExp(`追加の1日上限：${AGENT_RATE_LIMITS.add_day}件`));
  assert.match(page, /値は変わることがあります/);
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.equal(page.includes('JWT'), false);
  assert.equal(page.includes('SQLite'), false);
  assert.equal(page.includes('exe.dev'), false);
  assert.equal(page.includes('GitHub'), false);
  assert.equal(page.includes('byoagt_'), false);
});
