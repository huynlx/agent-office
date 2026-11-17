'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../server/server');
const roster = require('../config/roster.json');

function post(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/event', method: 'POST' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('POST /event -> nhận qua /stream', async () => {
  const app = createApp({ roster, idleMs: 50 });
  const port = await app.listen(0);
  const received = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('timeout')), 3000).unref();
    http.get({ host: '127.0.0.1', port, path: '/stream' }, (res) => {
      let buf = '';
      let posted = false;
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        if (!posted && buf.includes('event: init')) {
          posted = true;
          post(port, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/App.tsx' } }));
        }
        if (buf.includes('event: state') && buf.includes('Edit App.tsx')) { res.destroy(); resolve(buf); }
      });
    });
  });
  const buf = await received;
  assert.match(buf, /"id":"dev-fe","status":"working"/);
  await app.close();
});

test('body > 64KB bị từ chối, JSON hỏng -> 400, host lạ -> 403', async () => {
  const app = createApp({ roster });
  const port = await app.listen(0);
  assert.strictEqual(await post(port, 'x'.repeat(70 * 1024)), 413);
  assert.strictEqual(await post(port, '{oops'), 400);
  const code = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/roster', headers: { Host: 'evil.com' } }, (r) => { r.resume(); resolve(r.statusCode); });
  });
  assert.strictEqual(code, 403);
  await app.close();
});

test('POST /prompt: cần header + JSON; chạy runner; bận thì 409', async () => {
  let finish;
  const app = createApp({ roster, runner: (t, done) => { finish = () => done(0); app.got = t; } });
  const port = await app.listen(0);
  const req = (headers, body) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/prompt', method: 'POST', headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.end(body);
  });
  const ok = { 'Content-Type': 'application/json', 'X-Agent-Office': '1' };
  assert.strictEqual(await req({ 'Content-Type': 'text/plain' }, '{"text":"x"}'), 403);
  assert.strictEqual(await req(ok, '{"text":""}'), 400);
  assert.strictEqual(await req(ok, '{"text":"làm đi"}'), 202);
  assert.strictEqual(app.got, 'làm đi');
  assert.strictEqual(await req(ok, '{"text":"nữa"}'), 409);
  finish();
  await app.close();
});
