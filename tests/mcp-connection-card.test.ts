import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import McpConnectionCard, { McpConnectionInfoPanel } from '../src/components/mcp/McpConnectionCard';
import {
  MCP_CAPABILITY_BULLETS,
  MCP_CARD_TITLE,
  MCP_CONNECT_BULLETS,
  MCP_GUEST_HINT,
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

test('McpConnectionCard は URL・コピー・ゲスト案内を出す', () => {
  const html = renderToStaticMarkup(
    createElement(McpConnectionCard, {
      url: 'http://localhost/api/mcp',
      guest: true,
      variant: 'home',
    }),
  );
  assert.match(html, new RegExp(MCP_CARD_TITLE));
  assert.match(html, /http:\/\/localhost\/api\/mcp/);
  assert.match(html, new RegExp(MCP_GUEST_HINT));
  assert.match(html, /aria-label="MCP接続URLをコピー"/);
  assert.match(html, /aria-label="MCP接続の説明を開く"/);
  assert.equal(html.includes('できること'), false);
});

test('説明パネルはできること・つなぎ方を短い箇条書きで出す', () => {
  const html = renderToStaticMarkup(
    createElement(McpConnectionInfoPanel, { url: 'http://localhost:3107/api/mcp' }),
  );
  for (const line of MCP_CAPABILITY_BULLETS) {
    assert.ok(html.includes(line), line);
  }
  for (const line of MCP_CONNECT_BULLETS) {
    // JSX は <URL> を &lt;URL&gt; にエスケープする
    assert.ok(html.includes(line.replaceAll('<', '&lt;').replaceAll('>', '&gt;')), line);
  }
  assert.match(html, /href="\/help\/agents"/);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /http:\/\/localhost:3107\/api\/mcp/);
});
