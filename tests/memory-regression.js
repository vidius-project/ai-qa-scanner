const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkCleanup() {
  const source = fs.readFileSync(path.join(root, 'scan.js'), 'utf8')
    .replace(/run\(\)\.catch[\s\S]*$/, '');
  const sandbox = { require, URL, process: { argv: ['node', 'scan.js', 'https://example.com'], env: {} }, console, __dirname: root };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  let closed = 0;
  let bodyReads = 0;
  const page = {
    on(event, callback) {
      if (event === 'response') callback({
        request: () => ({ resourceType: () => 'image', url: () => 'image.png' }),
        headers: () => ({}),
        body: () => { bodyReads++; throw Error('Image body must not be read'); },
      });
    },
    goto: async () => { throw Error('navigation failed'); },
    close: async () => { closed++; },
  };
  const popup = { close: async () => { closed++; } };
  const result = await sandbox.scanPage({ newPage: async () => page, pages: () => [page, popup] }, 'https://example.com', root, 0);
  assert.equal(bodyReads, 0);
  assert.equal(closed, 2);
  assert.equal(result.findings[0].category, 'Erişim');
  page.goto = async () => ({ headers: () => ({}) });
  page.title = async () => { throw Error('unexpected page failure'); };
  await assert.rejects(sandbox.scanPage({ newPage: async () => page, pages: () => [page] }, 'https://example.com', root, 0), /unexpected page failure/);
  assert.equal(closed, 3);

  let disposed = 0;
  const response = status => ({ status: () => status, dispose: async () => { disposed++; } });
  const context = { request: { head: async () => response(405), get: async () => response(404) } };
  assert.equal((await sandbox.checkBrokenLinks(context, ['https://example.com'])).length, 1);
  assert.equal(disposed, 2);
  await sandbox.checkRobotsAndSitemap(context, 'https://example.com');
  assert.equal(disposed, 4);

  let contextClosed = false;
  let browserClosed = false;
  sandbox.require = name => name === 'playwright' ? { chromium: { launch: async () => ({
    newContext: async () => ({
      newPage: async () => { throw Error('newPage failed'); },
      close: async () => { contextClosed = true; },
    }),
    close: async () => { browserClosed = true; },
  }) } } : require(name);
  sandbox.process.env.SCAN_REPORT_DIR = path.join(root, 'reports', 'memory-test-cleanup');
  // Separate scope: exercise run's finally after a browser has been launched.
  const runSandbox = { URL, require: sandbox.require, process: sandbox.process, console, __dirname: root };
  vm.createContext(runSandbox);
  vm.runInContext(source, runSandbox);
  await assert.rejects(runSandbox.run(), /newPage failed/);
  assert.ok(contextClosed && browserClosed);
}

function checkServerFailureUnlock() {
  const handlers = {};
  const app = { disable() {}, use() {}, post(route, fn) { handlers[route] = fn; }, get() {}, listen() {} };
  const express = () => app;
  express.json = express.static = () => () => {};
  let child;
  let shouldThrow = false;
  const sandbox = {
    require: name => name === 'express' ? express : name === 'node:child_process' ? {
      spawn: () => { if (shouldThrow) throw Error('spawn failed'); child = new EventEmitter(); return child; },
    } : require(name),
    __dirname: root, process, URL, console: { error() {} }, setTimeout: () => ({ unref() {} }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), sandbox);
  const post = () => {
    const res = { code: 200, status(code) { this.code = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
    handlers['/api/scans']({ body: { url: 'https://example.com' } }, res);
    return res;
  };
  assert.equal(post().code, 202);
  assert.equal(post().code, 429);
  child.emit('error', Error('failed'));
  assert.equal(post().code, 429);
  child.emit('close', -1);
  shouldThrow = true;
  assert.equal(post().code, 500);
  shouldThrow = false;
  assert.equal(post().code, 202);
  child.emit('close', 1);
  assert.equal(post().code, 202);
  child.emit('close', 0);
}

async function integration() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' + ' '.repeat(350000);
  const fixture = http.createServer((req, res) => {
    if (req.url === '/image.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Length', Buffer.byteLength(svg));
      return res.end(svg);
    }
    if (req.url === '/chunked.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.write(svg.slice(0, 100));
      return res.end(svg.slice(100));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Fixture</title><h1>QA fixture</h1><img src="/image.svg"><img src="/chunked.svg"><a href="/second">Next</a><form><input required><button>Submit</button></form><div data-lov-id="test"></div>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const portProbe = http.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'pipe', windowsHide: true });
  let logs = '';
  server.stdout.on('data', d => { logs += d; });
  server.stderr.on('data', d => { logs += d; });
  const base = 'http://127.0.0.1:' + port;
  const url = 'http://127.0.0.1:' + fixture.address().port;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(ready, logs);
    const post = () => fetch(base + '/api/scans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const requests = await Promise.all([post(), post()]);
    assert.deepEqual(requests.map(r => r.status).sort(), [202, 429]);
    const busy = requests.find(r => r.status === 429);
    assert.equal(busy.headers.get('retry-after'), '10');
    assert.match((await busy.json()).error, /başka bir site/);
    const { id } = await requests.find(r => r.status === 202).json();
    let earlyShot = false;
    let job;
    for (let i = 0; i < 240; i++) {
      job = await (await fetch(base + '/api/scans/' + id)).json();
      if (job.status !== 'running') break;
      if (fs.existsSync(path.join(root, 'reports', id, 'p0_mobile.png'))) earlyShot = true;
      await sleep(100);
    }
    assert.equal(job.status, 'completed', logs);
    assert.ok(earlyShot, 'Screenshot must exist before scan finishes');
    const html = await (await fetch(base + job.reportUrl)).text();
    assert.match(html, /2 sayfa tarandı/);
    assert.match(html, /1 görsel 300KB-1MB/); // chunked image is deliberately skipped
    assert.match(html, /Lovable/);
    for (let i = 0; i < 2; i++) for (const kind of ['desktop', 'mobile']) {
      const image = await fetch(base + job.reportUrl.replace('rapor.html', 'p' + i + '_' + kind + '.png'));
      assert.equal(image.status, 200);
      assert.match(image.headers.get('content-type'), /image\/png/);
    }
    const again = await post();
    assert.equal(again.status, 202);
    const nextId = (await again.json()).id;
    for (let i = 0; i < 240; i++) {
      job = await (await fetch(base + '/api/scans/' + nextId)).json();
      if (job.status !== 'running') break;
      await sleep(100);
    }
    assert.equal(job.status, 'completed', logs);
    const cli = spawn(process.execPath, ['scan.js', url, '--pages=1'], { cwd: root, stdio: 'pipe', windowsHide: true });
    let output = '';
    cli.stdout.on('data', d => { output += d; });
    cli.stderr.on('data', d => { output += d; });
    assert.equal(await new Promise(resolve => cli.on('close', resolve)), 0, output);
    assert.match(output, /en fazla 1 sayfa/);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('close', resolve));
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
  }
}
(async () => {
  await checkCleanup();
  checkServerFailureUnlock();
  await integration();
  console.log('PASS: cleanup, response disposal, no image body reads, failure unlock, 429, early screenshots, 2-page reports, images and CLI.');
})().catch(error => { console.error(error); process.exitCode = 1; });
