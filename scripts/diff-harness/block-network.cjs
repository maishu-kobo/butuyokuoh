// ルートを読む前に差し込む。外部の名前解決・TCP・ブラウザ起動をここで止める。
// Node の組み込みは、ESM が読む前に CJS から差し替える。
/* eslint-disable @typescript-eslint/no-require-imports */
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const PUBLIC_ADDRESS = '93.184.216.34';

globalThis.__DIFF_FIXTURES = globalThis.__DIFF_FIXTURES || { routes: {}, bodies: {} };
globalThis.__DIFF_NETWORK_LOG = [];
globalThis.__DIFF_PUPPETEER_LOG = [];
globalThis.__DIFF_SOCKETS = 0;
globalThis.__DIFF_SPAWNS = [];

function record(line) {
  globalThis.__DIFF_NETWORK_LOG.push(line);
}

function hrefOf(value) {
  if (value instanceof URL) return value.href;
  if (typeof value === 'string') return new URL(value).href;
  if (value && typeof value === 'object' && typeof value.url === 'string') return new URL(value.url).href;
  return '';
}

function routeFor(href) {
  const fixtures = globalThis.__DIFF_FIXTURES;
  return fixtures.routes[href] || null;
}

function bodyFor(route) {
  if (!route || !route.body) return '';
  const bodies = globalThis.__DIFF_FIXTURES.bodies || {};
  return bodies[route.body] || '';
}

function lookupResult(options) {
  const all = Boolean(options && typeof options === 'object' && options.all);
  const record = { address: PUBLIC_ADDRESS, family: 4 };
  return all ? [record] : record;
}

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const all = Boolean(options && options.all);
  const result = lookupResult(options);
  process.nextTick(() => {
    if (all) callback(null, result);
    else callback(null, result.address, result.family);
  });
};
dns.promises.lookup = async function lookup(hostname, options) {
  return lookupResult(options);
};
dns.resolve4 = function resolve4(hostname, callback) {
  process.nextTick(() => callback(null, [PUBLIC_ADDRESS]));
};
dns.promises.resolve4 = async function resolve4() {
  return [PUBLIC_ADDRESS];
};
dns.promises.resolve6 = async function resolve6() {
  return [];
};

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const first = args[0];
  const ipc = typeof first === 'string' || (first && typeof first === 'object' && first.path && !first.port);
  // tsx talks to its local compiler over this socket. It is not an external API.
  const tsxCompiler = (new Error().stack || '').includes(`${path.sep}node_modules${path.sep}tsx${path.sep}`);
  if (ipc || tsxCompiler) return originalConnect.apply(this, args);
  globalThis.__DIFF_SOCKETS += 1;
  const error = new Error('diff harness blocked a socket connect');
  const callback = args.find((argument) => typeof argument === 'function');
  if (callback) process.nextTick(() => callback(error));
  else process.nextTick(() => this.emit('error', error));
  return this;
};

function fakeRequest(url, options, callback) {
  let href = '';
  let cb = callback;
  if (typeof url === 'string' || url instanceof URL) {
    href = hrefOf(url);
    if (typeof options === 'function') cb = options;
  } else {
    const opts = url || {};
    cb = typeof options === 'function' ? options : callback;
    if (opts instanceof URL || typeof opts === 'string') href = hrefOf(opts);
    else if (opts.href) href = hrefOf(opts.href);
    else if (opts.hostname || opts.host) {
      const protocol = opts.protocol || 'https:';
      const host = opts.host || opts.hostname;
      href = hrefOf(`${protocol}//${host}${opts.path || '/'}`);
    }
  }

  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.setHeader = () => {};
  req.getHeader = () => undefined;
  req.write = () => true;
  req.destroy = () => req;
  req.end = () => {
    process.nextTick(() => {
      const route = href ? routeFor(href) : null;
      const res = new EventEmitter();
      res.resume = () => {};
      if (!route) {
        record(`GET ${href || '(empty)'} -> 404 unfixtured`);
        res.statusCode = 404;
        res.headers = { 'content-type': 'text/plain; charset=utf-8' };
        if (typeof cb === 'function') cb(res);
        res.emit('data', Buffer.from('unfixtured'));
        res.emit('end');
        return;
      }
      record(`GET ${href} -> ${route.status}`);
      res.statusCode = route.status;
      res.headers = {
        'content-type': route.contentType || 'text/html; charset=utf-8',
        location: route.location,
      };
      const body = Buffer.from(bodyFor(route), 'utf8');
      if (typeof cb === 'function') cb(res);
      res.emit('data', body);
      res.emit('end');
    });
    return req;
  };
  return req;
}

function install(module) {
  module.request = fakeRequest;
  module.get = function get(...args) {
    const req = fakeRequest(...args);
    req.end();
    return req;
  };
}
install(http);
install(https);

globalThis.fetch = async function fetch(input, init) {
  const method = (init && init.method) || 'GET';
  let current = hrefOf(input);
  const seen = new Set();
  for (let hop = 0; hop < 5; hop += 1) {
    if (!current || seen.has(current)) break;
    seen.add(current);
    const route = routeFor(current);
    if (!route) {
      record(`${method} ${current} -> 404 unfixtured`);
      return new Response('unfixtured', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    record(`${method} ${current} -> ${route.status}`);
    if (route.status >= 300 && route.status < 400 && route.location) {
      current = new URL(route.location, current).href;
      continue;
    }
    const response = new Response(bodyFor(route), {
      status: route.status,
      headers: { 'content-type': route.contentType || 'text/html; charset=utf-8' },
    });
    Object.defineProperty(response, 'url', { value: current });
    return response;
  }
  return new Response('redirect loop', { status: 508 });
};

function commandLabel(command, args) {
  const file = typeof command === 'string' ? command : (command && command.toString()) || '';
  const rest = Array.isArray(args) ? args.join(' ') : '';
  return `${file} ${rest}`.trim();
}

function blockBrowser(name, original) {
  return function guarded(command, args, ...rest) {
    const label = commandLabel(command, args);
    if (/chrome|chromium|puppeteer/i.test(label)) {
      globalThis.__DIFF_SPAWNS.push(label);
      throw new Error(`diff harness blocked process: ${label}`);
    }
    return original.call(childProcess, command, args, ...rest);
  };
}

for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
  childProcess[name] = blockBrowser(name, childProcess[name]);
}
