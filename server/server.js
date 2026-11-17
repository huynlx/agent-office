'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createTracker } = require('./mapper');

const MAX_BODY = 64 * 1024;
const MAX_PROMPT_BODY = 1024 * 1024; // prompt có thể đính kèm nội dung file
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/**
 * Chạy `claude -p` headless; prompt đi qua stdin (không qua argv) nên không bị shell injection.
 * @param {string} text Prompt của người dùng.
 * @param {(code: number, output: string) => void} done Gọi khi tiến trình kết thúc, kèm câu trả lời (hoặc lỗi).
 * @returns {void}
 * @example
 * defaultRunner('liệt kê file', (code) => console.log(code));
 */
function defaultRunner(text, done) {
  const extra = (process.env.AGENT_OFFICE_CLAUDE_ARGS || '').split(/\s+/).filter(Boolean);
  const p = spawn('claude', ['-p', ...extra], {
    cwd: process.env.AGENT_OFFICE_CWD || process.cwd(),
    shell: process.platform === 'win32', // claude là .cmd trên Windows
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  // Giới hạn 20KB để một câu trả lời quá dài không làm nặng SSE.
  p.stdout.on('data', (d) => { if (out.length < 20000) out += d; });
  p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
  p.on('error', () => done(-1, 'Không chạy được `claude` (đã cài và có trong PATH chưa?)'));
  p.on('close', (c) => done(c === null ? -1 : c, (out || err).trim()));
  p.stdin.on('error', () => {});
  p.stdin.end(text);
}

/**
 * Tạo ứng dụng HTTP của văn phòng (chưa lắng nghe).
 * @param {{roster: Array<object>, publicDir?: string, idleMs?: number, runner?: Function}} opts roster và tuỳ chọn.
 * @returns {{server: http.Server, tracker: object, listen: (port?: number) => Promise<number>, close: () => Promise<void>}}
 *   `listen` luôn bind 127.0.0.1 và trả về cổng thực tế.
 * @example
 * const app = createApp({ roster });
 * const port = await app.listen(4747);
 */
function createApp({ roster, publicDir = path.join(__dirname, '..', 'public'), idleMs = 8000, runner = defaultRunner }) {
  const clients = new Set();
  const send = (res, name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const log = [];   // nhật ký hoạt động gần nhất (cũ -> mới)
  const tasks = []; // mỗi prompt gửi từ ô nhập là một task trong Command Center
  const tracker = createTracker(roster, (e) => {
    log.push(e); if (log.length > 60) log.shift();
    clients.forEach((c) => send(c, 'state', e));
  }, idleMs);
  const root = path.resolve(publicDir);
  let port = 0;
  let running = false;
  const broadcast = (name, data) => clients.forEach((c) => send(c, name, data));

  const server = http.createServer((req, res) => {
    // Chặn DNS-rebinding: chỉ nhận Host là localhost/127.0.0.1.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/event') return readBody(req, res, (p) => { const m = tracker.handle(p); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, mapped: !!m })); });
    if (req.method === 'POST' && url.pathname === '/prompt') return handlePrompt(req, res);
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }

    if (url.pathname === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      send(res, 'init', { roster, running, tasks, log, ...tracker.snapshot() });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/roster') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(roster));
      return;
    }
    serveStatic(url.pathname, res);
  });

  function readBody(req, res, cb, max = MAX_BODY) {
    let size = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { tooBig = true; return; } // bỏ qua phần dư, vẫn đọc hết để trả lời được
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413).end(); return; }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
      cb(payload);
    });
  }

  function handlePrompt(req, res) {
    // /prompt chạy lệnh trên máy: bắt buộc JSON + header riêng để trang web lạ không POST chéo được (CORS preflight sẽ chặn).
    if (!/^application\/json/.test(req.headers['content-type'] || '') || req.headers['x-agent-office'] !== '1') { res.writeHead(403).end(); return; }
    readBody(req, res, (p) => {
      const text = p && typeof p.text === 'string' ? p.text.trim() : '';
      if (!text || text.length > 600000) { res.writeHead(400).end(); return; }
      if (running) { res.writeHead(409).end(); return; }
      running = true;
      broadcast('run', { running: true });
      // claude khởi động mất vài giây trước khi hook đầu tiên bắn: cho PM nhận việc ngay để người dùng thấy phản hồi.
      tracker.set((roster.find((r) => r.id === 'director') || roster.find((r) => r.id === 'pm') || roster[0]).id, 'working', 'Nhận việc…');
      const task = { id: Date.now().toString(36), title: text.split('\n')[0].slice(0, 80), status: 'doing', ts: Date.now(), output: '' };
      tasks.push(task); if (tasks.length > 30) tasks.shift();
      broadcast('task', task);
      runner(text, (code, output) => {
        running = false;
        Object.assign(task, { status: code === 0 ? 'done' : 'failed', output: (output || '').slice(0, 4000) });
        broadcast('task', task);
        tracker.handle({ hook_event_name: 'Stop' });
        broadcast('run', { running: false, code, output: output || '' });
      });
      res.writeHead(202, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    }, MAX_PROMPT_BODY);
  }

  function serveStatic(pathname, res) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
    const file = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
  }

  const ping = setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 15000);
  ping.unref();

  return {
    server,
    tracker,
    listen: (p = 4747) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => { port = server.address().port; resolve(port); });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(ping);
      clients.forEach((c) => c.end());
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
    }),
  };
}

module.exports = { createApp };
