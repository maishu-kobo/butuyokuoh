import type { Browser } from 'puppeteer';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

type PricePageOptions = {
  onListening?: (port: number) => void;
  registerCleanup?: (close: () => Promise<void>) => void;
};

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

// 起動が例外でも、待ち受けとブラウザを閉じてからその例外を返す。
export async function withPricePage<T>(
  launch: () => Promise<Browser>,
  run: (browser: Browser, port: number) => Promise<T>,
  options?: PricePageOptions,
): Promise<T> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><span id="price">¥1,280</span>');
  });
  let browser: Browser | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const current = browser;
    browser = undefined;
    try {
      if (current) await current.close();
    } finally {
      await closeServer(server);
    }
  };
  options?.registerCleanup?.(close);
  let failure: unknown;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server has no port');
    options?.onListening?.(address.port);
    browser = await launch();
    return await run(browser, address.port);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await close();
    } catch (cleanupError) {
      if (failure === undefined) throw cleanupError;
    }
  }
}

function runDirectly(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (runDirectly()) {
  withPricePage(
    async () => {
      throw new Error('launch failed');
    },
    async () => undefined,
    { onListening: (port) => console.log(`listening ${port}`) },
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
