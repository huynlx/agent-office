#!/usr/bin/env node
'use strict';
// Hook Claude Code: đọc JSON từ stdin, rút gọn còn tên tool/đường dẫn/từ đầu của lệnh rồi POST /event.
// Luôn im lặng và thoát 0 để không bao giờ làm chậm hay làm hỏng Claude Code.
const http = require('http');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { if (raw.length < 8e6) raw += c; });
process.stdin.on('end', () => {
  let p;
  try { p = JSON.parse(raw); } catch { return; }
  const ti = p.tool_input || {};
  // Không chuyển nội dung file/prompt/lệnh đầy đủ: chỉ những gì mapper cần.
  const body = JSON.stringify({
    hook_event_name: p.hook_event_name,
    tool_name: p.tool_name,
    agent_type: p.agent_type,
    tool_input: {
      file_path: ti.file_path || ti.notebook_path,
      command: typeof ti.command === 'string' ? ti.command.trim().split(/\s+/)[0] : undefined,
    },
  });
  const u = new URL(process.env.AGENT_OFFICE_URL || 'http://127.0.0.1:4747/event');
  const req = http.request(
    { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 500,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (res) => res.resume(),
  );
  req.on('timeout', () => req.destroy());
  req.on('error', () => {});
  req.end(body);
});
setTimeout(() => process.exit(0), 600).unref();
