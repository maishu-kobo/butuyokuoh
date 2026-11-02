import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import McpConnectionCard, { McpConnectionInfoPanel } from '../src/components/mcp/McpConnectionCard';
import {
  MCP_ADVANCED_CLAUDE,
  MCP_ADVANCED_TOKEN,
  MCP_ASK_EXAMPLES,
  MCP_CARD_SUBTITLE,
  MCP_CARD_TITLE,
  MCP_CONNECT_STEPS,
  MCP_GUEST_HINT,
  MCP_LOCALHOST_NOTE,
  MCP_URL_LABEL,
  MCP_WHAT_IS,
  isLoopbackMcpUrl,
} from '../src/lib/mcp-connection-copy';
import { mcpResourceUrl, mcpResourceUrlFromHeaders } from '../src/lib/agent-oauth';

test('mcpResourceUrlFromHeaders は Host から mcpResourceUrl と同じ値になる', () => {
  const previousAuth = process.env.AUTH_URL;
  const previousNext = process.env.NEXTAUTH_URL;
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
  try {
    const headers = new Headers({
      host: 'example.test:4455',
      'x-forwarded-proto': 'https',
    });
    assert.equal(
      mcpResourceUrlFromHeaders(headers),
      mcpResourceUrl('https://example.test:4455/'),
    );
    assert.equal(mcpResourceUrlFromHeaders(headers), 'https://example.test:4455/api/mcp');
    assert.equal(mcpResourceUrlFromHeaders(new Headers()), mcpResourceUrl());
  } finally {
    if (previousAuth === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = previousAuth;
    if (previousNext === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousNext;
  }
});

test('AUTH_URL があるときはヘッダより AUTH_URL の origin を使う', () => {
  const previous = process.env.AUTH_URL;
  process.env.AUTH_URL = 'https://butuyokuoh.example';
  try {
    const headers = new Headers({ host: 'localhost:3000' });
    assert.equal(mcpResourceUrlFromHeaders(headers), 'https://butuyokuoh.example/api/mcp');
  } finally {
    if (previous === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = previous;
  }
});

test('isLoopbackMcpUrl は localhost / 127.0.0.1 だけ真', () => {
  assert.equal(isLoopbackMcpUrl('http://localhost/api/mcp'), true);
  assert.equal(isLoopbackMcpUrl('http://127.0.0.1:3000/api/mcp'), true);
  assert.equal(isLoopbackMcpUrl('http://[::1]/api/mcp'), true);
  assert.equal(isLoopbackMcpUrl('https://butsuyokuoh.exe.xyz/api/mcp'), false);
  assert.equal(isLoopbackMcpUrl('https://butuyokuoh.example/api/mcp'), false);
  assert.equal(isLoopbackMcpUrl('not-a-url'), false);
});

test('McpConnectionCard は URL・コピー・ゲスト案内を出す', () => {
  const html = renderToStaticMarkup(
    createElement(McpConnectionCard, {
      url: 'http://localhost/api/mcp',
      guest: true,
      variant: 'home',
    }),
  );
  assert.match(html, new RegExp(MCP_CARD_TITLE));
  assert.match(html, new RegExp(MCP_CARD_SUBTITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(MCP_URL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /http:\/\/localhost\/api\/mcp/);
  assert.match(html, new RegExp(MCP_GUEST_HINT));
  assert.match(html, new RegExp(MCP_LOCALHOST_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /aria-label="接続用URLをコピー"/);
  assert.match(html, /aria-label="AIエージェント接続の説明を開く"/);
  // コピーは中立セカンダリ（赤 primary クラスを使わない）
  assert.equal(html.includes('bg-[var(--color-primary)]'), false);
  assert.match(html, /bg-slate-100/);
  assert.equal(html.includes('これは何か'), false);
});

test('本番風の https URL では開発用注記を出さない', () => {
  const previous = process.env.AUTH_URL;
  process.env.AUTH_URL = 'https://butsuyokuoh.exe.xyz';
  try {
    const url = mcpResourceUrlFromHeaders(new Headers({ host: 'localhost:3000' }));
    assert.equal(url, 'https://butsuyokuoh.exe.xyz/api/mcp');
    const html = renderToStaticMarkup(
      createElement(McpConnectionCard, { url, variant: 'home' }),
    );
    assert.match(html, /https:\/\/butsuyokuoh\.exe\.xyz\/api\/mcp/);
    assert.equal(html.includes(MCP_LOCALHOST_NOTE), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = previous;
  }
});

test('説明パネルは初心者向けの順で短く出す', () => {
  const html = renderToStaticMarkup(
    createElement(McpConnectionInfoPanel, { url: 'http://localhost:3107/api/mcp' }),
  );
  assert.ok(html.includes(MCP_WHAT_IS), MCP_WHAT_IS);
  assert.match(html, /これは何か/);
  assert.match(html, /AI に頼めること/);
  assert.match(html, /つなぎ方/);
  assert.match(html, /うまくつながらないとき/);
  assert.match(html, /上級者向け/);
  for (const line of MCP_ASK_EXAMPLES) {
    assert.ok(html.includes(line), line);
  }
  for (const line of MCP_CONNECT_STEPS) {
    assert.ok(html.includes(line), line);
  }
  assert.ok(html.includes(MCP_ADVANCED_TOKEN), MCP_ADVANCED_TOKEN);
  assert.ok(
    html.includes(MCP_ADVANCED_CLAUDE.replaceAll('<', '&lt;').replaceAll('>', '&gt;')),
    MCP_ADVANCED_CLAUDE,
  );
  assert.match(html, /href="\/help\/agents"/);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /エージェント連携のヘルプ/);
  assert.match(html, />設定</);
  assert.match(html, /http:\/\/localhost:3107\/api\/mcp/);
});
