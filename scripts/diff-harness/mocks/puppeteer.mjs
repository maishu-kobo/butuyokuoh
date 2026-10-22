const puppeteer = {
  async launch() {
    globalThis.__DIFF_PUPPETEER_LOG.push('launch');
    return {
      async newPage() {
        let url = '';
        return {
          async setUserAgent() {},
          async setExtraHTTPHeaders() {},
          async setRequestInterception() {},
          on() {},
          async goto(next) {
            url = String(next);
            globalThis.__DIFF_PUPPETEER_LOG.push(`goto ${url}`);
          },
          async content() {
            const fixtures = globalThis.__DIFF_FIXTURES || { routes: {}, bodies: {} };
            const route = fixtures.routes[url];
            const key = route && route.body;
            return (key && fixtures.bodies[key]) || '<html><span id="productTitle">missing</span></html>';
          },
          async close() {},
        };
      },
      async close() {},
    };
  },
};

export default puppeteer;
