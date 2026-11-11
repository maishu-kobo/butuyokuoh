import { expect, test, type Locator, type Page } from '@playwright/test';

// 本番 item 343 のメモ（78字）。保存は足りていて、カードの表示だけが欠ける。
const reportedMemo =
  '11/10、SotaさんがAmazon.co.jpの商品ページ（ASIN 4344410009、ほしいものリスト経由のリンク）を送り、物欲王への登録を依頼。';

const multilineMemo = '一行目のメモです。\n二行目もカードの中で読める。';

const longTail = '末尾まで読める';
const longMemo = `${'あ'.repeat(2000 - longTail.length)}${longTail}`;
const packedTail = 'END';
const packedMemo = `${'W'.repeat(2000 - packedTail.length)}${packedTail}`;

test.beforeAll(() => {
  expect(reportedMemo.length).toBe(78);
  expect(longMemo.length).toBe(2000);
  expect(packedMemo.length).toBe(2000);
  expect(packedMemo.includes(' ')).toBe(false);
});

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      email: `notes-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      password: 'test-password',
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function addManual(page: Page, name: string, notes: string) {
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByRole('button', { name: '手動で追加' }).click();
  await page.getByPlaceholder('商品名を入力').fill(name);
  await page.getByPlaceholder('購入理由や比較ポイントなど').fill(notes);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function notesOnCard(page: Page, name: string, notes: string): Locator {
  return page
    .locator('div.rounded-lg.shadow-md')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .first()
    .locator('p')
    .filter({ hasText: notes.slice(0, 12) });
}

async function expectMemoFullyVisible(notes: Locator, expected: string) {
  await notes.scrollIntoViewIfNeeded();
  await expect(notes).toBeVisible();
  expect(await notes.evaluate((el) => el.textContent)).toBe(expected);

  const painted = await notes.evaluate((el) => {
    const style = getComputedStyle(el);
    const text = el.textContent ?? '';
    const node = [...el.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
    if (!node || node.textContent !== text || text.length === 0) {
      return { ok: false as const };
    }
    const end = document.createRange();
    end.setStart(node, text.length - 1);
    end.setEnd(node, text.length);
    const endRect = end.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    let card: HTMLElement | null = el.parentElement;
    while (card && !card.classList.contains('shadow-md')) card = card.parentElement;
    const cardRect = card?.getBoundingClientRect();
    const newline = text.indexOf('\n');
    let newlineStacks = true;
    if (newline > 0 && newline < text.length - 1) {
      const before = document.createRange();
      before.setStart(node, newline - 1);
      before.setEnd(node, newline);
      const after = document.createRange();
      after.setStart(node, newline + 1);
      after.setEnd(node, newline + 2);
      newlineStacks = after.getBoundingClientRect().top >= before.getBoundingClientRect().bottom - 1;
    }
    return {
      ok: true as const,
      lineClamp: style.getPropertyValue('-webkit-line-clamp'),
      scrollGap: el.scrollHeight - el.clientHeight,
      widthGap: el.scrollWidth - el.clientWidth,
      endWidth: endRect.width,
      endHeight: endRect.height,
      endInside:
        endRect.width > 0 &&
        endRect.height > 0 &&
        endRect.top >= box.top - 1 &&
        endRect.left >= box.left - 1 &&
        endRect.bottom <= box.bottom + 1 &&
        endRect.right <= box.right + 1,
      cardClips: !cardRect || endRect.bottom > cardRect.bottom + 1 || endRect.right > cardRect.right + 1,
      newlineStacks,
    };
  });

  expect(painted.ok).toBe(true);
  if (!painted.ok) return;
  expect(painted.lineClamp).toBe('none');
  expect(painted.scrollGap).toBeLessThanOrEqual(1);
  expect(painted.widthGap).toBeLessThanOrEqual(1);
  expect(painted.endWidth).toBeGreaterThan(0);
  expect(painted.endHeight).toBeGreaterThan(0);
  expect(painted.endInside).toBe(true);
  expect(painted.cardClips).toBe(false);
  expect(painted.newlineStacks).toBe(true);
}

test('item card shows the full memo, including long notes on a narrow screen', async ({ page }) => {
  test.setTimeout(90_000);
  await member(page);
  await addManual(page, '報告どおりのメモ', reportedMemo);
  await addManual(page, '改行のあるメモ', multilineMemo);
  await addManual(page, '長いメモ', longMemo);
  await addManual(page, '区切りのないメモ', packedMemo);

  const cases = [
    ['報告どおりのメモ', reportedMemo],
    ['改行のあるメモ', multilineMemo],
    ['長いメモ', longMemo],
    ['区切りのないメモ', packedMemo],
  ] as const;

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [name, notes] of cases) {
      await expectMemoFullyVisible(notesOnCard(page, name, notes), notes);
    }
  }
});
