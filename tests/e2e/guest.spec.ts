import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { encode } from 'next-auth/jwt';
const origin = 'http://localhost:3107';
const context = () => playwrightRequest.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
const db = () => new Database(process.env.E2E_DB_PATH!);
async function guest(c: APIRequestContext) {
  const response = await c.post('/api/auth/guest');
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}

test('guest API lifecycle, isolation, capabilities, validation and quotas', async () => {
  const a = await context(), b = await context(), anon = await context();
  try {
    expect((await anon.get('/api/items')).status()).toBe(401);
    expect((await anon.post('/api/auth/guest', { headers: { Origin: 'https://attacker.test' } })).status()).toBe(403);
    const ga = await guest(a), gb = await guest(b);
    expect(ga.email).toBeNull(); expect(ga.id).not.toBe(gb.id);
    const cookies = (await a.storageState()).cookies;
    expect(cookies.find(c => c.name === 'butuyokuoh_guest')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const resume = await a.post('/api/auth/guest');
    expect(resume.status()).toBe(200);
    expect((await resume.json()).user.expiresAt).toBe(ga.expiresAt);
    const items = await (await a.get('/api/items')).json();
    const foreign = (await (await b.get('/api/items')).json())[0];
    expect(items).toHaveLength(4);
    expect((await a.get('/api/purchased')).status()).toBe(200);
    expect((await a.get('/api/trash')).status()).toBe(200);
    for (const path of ['/api/stats','/api/budget','/api/export',`/api/items/${items[0].id}/price-history`]) expect((await a.get(path)).status(), path).toBe(200);
    for (const method of ['get','patch','delete'] as const) expect((await a[method](`/api/items/${foreign.id}`, method === 'patch' ? { data: { name: 'steal' } } : undefined)).status()).toBe(404);
    expect((await a.get(`/api/items/${foreign.id}/price-history`)).status()).toBe(404);
    const foreignCategory = (await (await b.get('/api/categories')).json())[0];
    const foreignGroup = (await (await b.get('/api/comparison-groups')).json())[0];
    for (const relation of [{category_id: foreignCategory.id},{comparison_group_id: foreignGroup.id}]) {
      expect((await a.post('/api/items', { data: { manual:true,name:'cross-account',...relation } })).status()).toBe(400);
      expect((await a.patch(`/api/items/${items[0].id}`, { data: relation })).status()).toBe(400);
    }
    for (const path of ['/api/auth/token','/api/notification-settings']) expect((await a.get(path)).status()).toBe(403);
    for (const path of ['/api/items/preview',`/api/items/${items[0].id}/refresh`,'/api/import-wishlist','/api/upload']) expect((await a.post(path, { data: {url:'https://example.test'} })).status(), path).toBe(403);
    expect((await a.put('/api/notification-settings', { data: {} })).status()).toBe(403);
    expect((await a.post('/api/items', {data:{url:'https://example.test'}})).status()).toBe(403);
    expect((await a.post('/api/items', {headers:{Origin:'https://attacker.test'},data:{manual:true,name:'csrf'}})).status()).toBe(403);
    for (const body of [{name:'x'.repeat(201)}, {price:-1}, {priority:0}, {quantity:{}}, {url:'javascript:alert(1)'}]) expect((await a.post('/api/items', {data:{manual:true,name:'invalid',...body}})).status()).toBe(400);
    expect((await a.post('/api/items', {data:{manual:true,name:'image',image_url:'https://example.test/a.png'}})).status()).toBe(403);
    expect((await a.post('/api/items', {data:{manual:true,name:'large',notes:'x'.repeat(17000)}})).status()).toBe(413);
    // Two parallel inserts compete for the final slot under one SQLite write lock.
    expect((await a.post('/api/items', {data:{manual:true,name:'first',url:'manual://first',price:100}})).status()).toBe(201);
    const results = await Promise.all(['last-a','last-b'].map(name => a.post('/api/items', {data:{manual:true,name,url:`manual://${name}`,price:100}})));
    expect(results.map(r=>r.status()).sort()).toEqual([201,409]);
    // A full history quota must roll back the price change.
    const prior = await (await a.get(`/api/items/${items[0].id}`)).json();
    expect((await a.patch(`/api/items/${items[0].id}`, {data:{current_price:123}})).status()).toBe(409);
    expect((await (await a.get(`/api/items/${items[0].id}`)).json()).current_price).toBe(prior.current_price);
    expect((await a.patch(`/api/items/${items[0].id}`, {data:{name:'edited',is_purchased:true}})).status()).toBe(200);
    expect((await a.delete(`/api/items/${items[0].id}`)).status()).toBe(200);
    expect((await a.post(`/api/trash/${items[0].id}`)).status()).toBe(200);
    expect((await a.delete(`/api/items/${items[0].id}`)).status()).toBe(200);
    expect((await a.delete(`/api/trash/${items[0].id}`)).status()).toBe(200);
    const connection = db();
    expect(connection.prepare('SELECT id FROM price_history WHERE item_id = ?').all(items[0].id)).toHaveLength(0);
    connection.close();
    expect((await a.delete('/api/auth/guest')).status()).toBe(204);
    expect((await a.delete('/api/auth/guest')).status()).toBe(204);
    expect((await a.get('/api/items')).status()).toBe(401);
    expect((await b.get('/api/items')).status()).toBe(200);
  } finally { await a.dispose(); await b.dispose(); await anon.dispose(); }
});

test('expiry and persistent write rate are enforced without running cleanup', async () => {
  const c = await context();
  try {
    const g = await guest(c);
    let connection = db();
    connection.prepare('INSERT INTO guest_rate_limits VALUES (?,60,?)').run(`write:${g.id}`,Date.now()+60_000); connection.close();
    const rate = await c.post('/api/categories', {data:{name:'blocked'}});
    expect(rate.status()).toBe(429); expect(Number(rate.headers()['retry-after'])).toBeGreaterThan(0);
    connection = db(); connection.prepare('UPDATE guest_sessions SET expires_at = ? WHERE user_id = ?').run(Date.now()-1,g.id); connection.close();
    expect((await c.get('/api/auth/me')).status()).toBe(401);
    expect((await c.get('/api/items')).status()).toBe(401);
    expect((await c.delete('/api/auth/guest')).status()).toBe(204);
  } finally { await c.dispose(); }
});

test('member precedence, reserved email and extension bearer cannot impersonate guests', async () => {
  const c = await context();
  try {
    const g = await guest(c);
    const forged = jwt.sign({userId:g.id,email:'guest@guest.invalid'},'guest-e2e-only-jwt-secret-not-for-production');
    for (const [method,path] of [['get','/api/extension-categories'],['post','/api/extension-add'],['post','/api/extension-import']] as const) {
      expect((await c[method](path,{headers:{Authorization:`Bearer ${forged}`},data:{token:forged}})).status()).toBe(401);
    }
    expect((await c.post('/api/auth/register',{data:{email:'guest@guest.invalid',password:'password'}})).status()).toBe(400);
    const memberResponse = await c.post('/api/auth/register',{data:{email:`member-${Date.now()}@example.test`,password:'test-password'}});
    expect(memberResponse.ok()).toBe(true);
    const member = (await memberResponse.json()).user;
    expect((await (await c.get('/api/auth/me')).json()).user.account_type).toBe('member');
    expect((await c.post('/api/auth/guest')).status()).toBe(409);
    expect((await c.get('/api/auth/token')).status()).toBe(200);
    expect((await c.get('/api/items')).ok()).toBe(true);
    expect(await (await c.get('/api/items')).json()).toHaveLength(0);
    expect((await c.delete('/api/auth/guest')).status()).toBe(204);
    expect((await (await c.get('/api/auth/me')).json()).user.id).toBe(member.id);
    const connection = db(); expect(connection.prepare('SELECT id FROM users WHERE id = ?').get(g.id)).toBeUndefined(); connection.close();
    // A valid NextAuth JWT also resolves through the member-only server lookup.
    // NextAuth chooses its cookie prefix from AUTH_URL (HTTP in this local test), not NODE_ENV.
    const sessionCookie = 'authjs.session-token';
    const sessionToken = await encode({token:{userId:String(member.id)},secret:'guest-e2e-only-auth-secret-not-for-production',salt:sessionCookie});
    const oauth = await playwrightRequest.newContext({baseURL:origin,extraHTTPHeaders:{Cookie:`${sessionCookie}=${sessionToken}`}});
    expect((await (await oauth.get('/api/auth/me')).json()).user.id).toBe(member.id);
    await oauth.dispose();
  } finally { await c.dispose(); }
});

test('browser demo flow, manual add, restricted controls, tabs and member transition', async ({page,context:browser}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'ゲストで試す',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toBeVisible();
  await expect(page.getByRole('button',{name:'全て更新'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'インポート',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'新しいアイテムを追加'}).click();
  await page.getByPlaceholder('商品名を入力').fill('自分で追加した商品');
  await page.getByPlaceholder('例: 3990').fill('1200');
  await page.getByRole('button',{name:'追加',exact:true}).click();
  await expect(page.getByText('自分で追加した商品',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/guest-desktop.png',fullPage:true});
  const tab = await browser.newPage(); await tab.goto('/settings');
  await expect(tab.getByText('通知設定と拡張機能はログイン後に利用できます。')).toBeVisible();
  await tab.goto('/add?url=https://example.test/product');
  await expect(tab.getByText('ゲスト体験では商品を手動で追加できます。URLからの取得はログイン後に利用できます。')).toBeVisible();
  // Canceling login/end must preserve the guest session.
  page.once('dialog',d=>d.dismiss());
  await page.getByRole('button',{name:'Googleでログイン',exact:true}).click();
  await expect(page.getByText('自分で追加した商品',{exact:true})).toBeVisible();
  // Simulate successful provider return with a real member session, then refocus.
  const email = `ui-${Date.now()}@example.test`;
  const response = await browser.request.post('/api/auth/register',{data:{email,password:'test-password'}});
  expect(response.ok()).toBe(true);
  await page.bringToFront(); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toHaveCount(0);
  await expect(page.getByText('自分で追加した商品',{exact:true})).toHaveCount(0);
  await expect.poll(async()=> (await browser.cookies()).some(c=>c.name==='butuyokuoh_guest')).toBe(false);
  // The same member can log out, start another demo, and log in again.
  await browser.request.post('/api/auth/logout');
  await page.reload(); await page.getByRole('button',{name:'ゲストで試す',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toBeVisible();
  await browser.request.post('/api/auth/login',{data:{email,password:'test-password'}});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toHaveCount(0);
  await expect.poll(async()=> (await browser.cookies()).some(c=>c.name==='butuyokuoh_guest')).toBe(false);
  await tab.close();
});

test('mobile guest end synchronizes another tab and does not automatically restart', async ({page,context:browser}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/'); await page.getByRole('button',{name:'ゲストで試す',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toBeVisible();
  await page.screenshot({path:'test-results/guest-mobile.png',fullPage:true});
  const other = await browser.newPage(); await other.goto('/');
  page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'体験を終了',exact:true}).click();
  await expect(page.getByRole('button',{name:'ゲストで試す',exact:true})).toBeVisible();
  await other.bringToFront(); await other.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(other.getByRole('button',{name:'ゲストで試す',exact:true})).toBeVisible();
  expect((await browser.request.get('/api/auth/me')).status()).toBe(401);
  await other.close();
});

test('category and comparison-group mutations keep ownership and quotas', async () => {
  const a = await context(), b = await context();
  try {
    await guest(a); await guest(b);
    for (const path of ['/api/categories','/api/comparison-groups']) {
      const foreign = (await (await b.get(path)).json())[0];
      expect((await a.put(`${path}/${foreign.id}`,{data:{name:'steal'}})).status()).toBe(404);
      expect((await a.delete(`${path}/${foreign.id}`)).status()).toBe(404);
      const created = await a.post(path,{data:{name:'new'}});
      expect(created.status()).toBe(201);
      const row = await created.json();
      expect((await a.put(`${path}/${row.id}`,{data:{name:'renamed'}})).status()).toBe(200);
      expect((await a.post(path,{data:{name:'last'}})).status()).toBe(201);
      expect((await a.post(path,{data:{name:'over-cap'}})).status()).toBe(409);
      expect((await a.delete(`${path}/${row.id}`)).status()).toBe(200);
      expect((await a.post(path,{data:{name:'after-delete'}})).status()).toBe(201);
    }
    const g = await (await a.get('/api/auth/me')).json();
    const connection = db();
    // Member extension input must also reject a relation belonging to a guest.
    const category = connection.prepare('SELECT id FROM categories WHERE user_id = ? LIMIT 1').get(g.user.id) as {id:number};
    connection.close();
    const member = await b.post('/api/auth/register',{data:{email:`ext-${Date.now()}@example.test`,password:'test-password'}});
    const {token} = await member.json();
    expect((await b.post('/api/extension-add',{data:{token,item:{name:'cross',url:'https://example.test',price:100,imageUrl:null,priority:3,categoryId:String(category.id)}}})).status()).toBe(400);
  } finally { await a.dispose(); await b.dispose(); }
});

test('an expired browser session returns to login without reseeding', async ({page,context}) => {
  await page.goto('/'); await page.getByRole('button',{name:'ゲストで試す',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'ゲスト体験'})).toBeVisible();
  const {user} = await (await context.request.get('/api/auth/me')).json();
  const connection = db();
  connection.prepare('UPDATE guest_sessions SET expires_at = ? WHERE user_id = ?').run(Date.now()-1,user.id);
  const before = connection.prepare('SELECT COUNT(*) n FROM users').get();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'ゲストで試す',exact:true})).toBeVisible();
  expect(connection.prepare('SELECT COUNT(*) n FROM users').get()).toEqual(before);
  connection.close();
});
