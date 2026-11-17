'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapEvent, createTracker } = require('../server/mapper');
const roster = require('../config/roster.json');

const pre = (tool_name, tool_input) => mapEvent({ hook_event_name: 'PreToolUse', tool_name, tool_input }, roster);

test('Edit .tsx/.css -> DEV FE, text là tool + tên file', () => {
  assert.deepStrictEqual(pre('Edit', { file_path: '/p/src/App.tsx' }), { id: 'dev-fe', status: 'working', text: 'Edit App.tsx' });
  assert.strictEqual(pre('Write', { file_path: 'C:\\p\\style.css' }).id, 'dev-fe');
});

test('.sql, server/, api/ -> DEV BE', () => {
  assert.strictEqual(pre('Write', { file_path: 'db/schema.sql' }).id, 'dev-be');
  assert.strictEqual(pre('Edit', { file_path: '/p/server/index.js' }).id, 'dev-be');
  assert.strictEqual(pre('Edit', { file_path: '/p/api/users.js' }).id, 'dev-be');
});

test('test/spec -> QC (ưu tiên hơn đuôi .tsx), "latest" không bị nhầm', () => {
  assert.strictEqual(pre('Edit', { file_path: 'App.test.tsx' }).id, 'qc');
  assert.strictEqual(pre('Edit', { file_path: 'a.spec.js' }).id, 'qc');
  assert.strictEqual(pre('Edit', { file_path: '/latest/App.tsx' }).id, 'dev-fe');
});

test('Dockerfile, .github/, .yml -> Devops', () => {
  assert.strictEqual(pre('Edit', { file_path: 'Dockerfile' }).id, 'devops');
  assert.strictEqual(pre('Edit', { file_path: '.github/workflows/test.yml' }).id, 'devops');
  assert.strictEqual(pre('Write', { file_path: 'ci.yml' }).id, 'devops');
});

test('.md, docs/, Read/Grep/Glob -> BA', () => {
  assert.strictEqual(pre('Edit', { file_path: 'README.md' }).id, 'ba');
  assert.strictEqual(pre('Write', { file_path: 'docs/x.txt' }).id, 'ba');
  for (const t of ['Read', 'Grep', 'Glob']) assert.strictEqual(pre(t, {}).id, 'ba');
});

test('Bash git -> Tech Lead; text chỉ có từ đầu của lệnh (không lộ bí mật)', () => {
  const r = pre('Bash', { command: 'git push https://user:SECRET@x.com' });
  assert.strictEqual(r.id, 'tech-lead');
  assert.strictEqual(r.text, 'Bash git');
});

test('tool/đường dẫn không khớp -> Tech Lead; không lộ nội dung file', () => {
  const r = pre('Edit', { file_path: 'x.bin', content: 'TOP-SECRET', new_string: 'TOP-SECRET' });
  assert.strictEqual(r.id, 'tech-lead');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  assert.strictEqual(pre('WeirdTool', {}).id, 'tech-lead');
});

test('subagent khớp theo agent_type, kể cả tool chạy trong subagent', () => {
  const s = mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'frontend-developer' }, roster);
  assert.strictEqual(s.id, 'dev-fe');
  const t = mapEvent({ hook_event_name: 'PreToolUse', tool_name: 'Read', agent_type: 'qa-tester' }, roster);
  assert.strictEqual(t.id, 'qc');
  assert.deepStrictEqual(mapEvent({ hook_event_name: 'SubagentStop', agent_type: 'dev-be' }, roster), { id: 'dev-be', status: 'idle', text: '' });
});

test('sự kiện lạ/hỏng bị bỏ qua', () => {
  for (const p of [null, 'x', {}, { hook_event_name: 'Bogus' }, { hook_event_name: 'PreToolUse' }, { hook_event_name: 'PreToolUse', tool_name: 5 }]) {
    assert.strictEqual(mapEvent(p, roster), null);
  }
});

test('Notification -> waiting cho agent gần nhất; Stop -> all idle', () => {
  assert.strictEqual(mapEvent({ hook_event_name: 'Notification' }, roster, { lastId: 'qc' }).id, 'qc');
  assert.strictEqual(mapEvent({ hook_event_name: 'Notification' }, roster, {}).id, 'tech-lead');
  assert.strictEqual(mapEvent({ hook_event_name: 'Notification' }, roster, {}).status, 'waiting');
  assert.deepStrictEqual(mapEvent({ hook_event_name: 'Stop' }, roster), { all: true, status: 'idle', text: '' });
});

test('tracker: PostToolUse + idleMs không sự kiện -> idle; Stop -> idle ngay', async () => {
  const seen = [];
  const t = createTracker(roster, (e) => seen.push(e), 30);
  t.handle({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'App.tsx' } });
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'App.tsx' } });
  assert.strictEqual(t.snapshot().states['dev-fe'].status, 'working');
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(t.snapshot().states['dev-fe'].status, 'idle');
  t.handle({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.css' } });
  t.handle({ hook_event_name: 'Stop' });
  assert.strictEqual(t.snapshot().states['dev-fe'].status, 'idle');
  assert.ok(t.snapshot().history['dev-fe'].length <= 10);
});

test('roster thêm người mới chỉ cần match, không sửa code', () => {
  const r2 = [...roster, { id: 'sec', role: 'Security', match: ['security'] }];
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'security-auditor' }, r2).id, 'sec');
});
