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
  assert.strictEqual(pre('Write', { file_path: 'db/schema.sql' }).id, 'dba');
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

test('.md, docs/ -> Tech Writer; Read/Grep/Glob -> BA', () => {
  assert.strictEqual(pre('Edit', { file_path: 'README.md' }).id, 'tech-writer');
  assert.strictEqual(pre('Write', { file_path: 'docs/x.txt' }).id, 'tech-writer');
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
  const r2 = [...roster, { id: 'legal', role: 'Legal', match: ['legal'] }];
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'legal-advisor' }, r2).id, 'legal');
});

test('tài liệu yêu cầu (SRS/spec/requirements/) -> BA; README/docs -> Tech Writer', () => {
  for (const f of ['docs/SRS-login.md', 'requirements/login.md', 'specs/a.md', 'BRD_v2.md', 'user-story-12.md']) {
    assert.strictEqual(pre('Write', { file_path: f }).id, 'ba', f);
  }
  assert.strictEqual(pre('Write', { file_path: 'docs/guide.md' }).id, 'tech-writer');
  assert.strictEqual(pre('Edit', { file_path: 'README.md' }).id, 'tech-writer');
  assert.strictEqual(pre('Edit', { file_path: 'App.spec.js' }).id, 'qc');
  for (const f of ['user-guide.md', 'huong-dan-su-dung.md', 'spec-guide.md', 'requirements/manual.md']) {
    assert.strictEqual(pre('Write', { file_path: f }).id, 'tech-writer', f);
  }
});

test('Trưởng phòng nhận Task/TodoWrite, Giám đốc nhận ExitPlanMode; subagent theo tên', () => {
  assert.strictEqual(pre('Task', {}).id, 'head');
  assert.strictEqual(pre('TodoWrite', {}).id, 'head');
  assert.strictEqual(pre('ExitPlanMode', {}).id, 'director');
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'engineering-manager' }, roster).id, 'head');
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'cto' }, roster).id, 'director');
});

test('Solution Architect: tài liệu kiến trúc/ADR và subagent solution-architect', () => {
  for (const f of ['docs/architecture/overview.md', 'adr/0001-use-sse.md', 'system-architecture.md']) {
    assert.strictEqual(pre('Write', { file_path: f }).id, 'sa', f);
  }
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'solution-architect' }, roster).id, 'sa');
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'tech-lead' }, roster).id, 'tech-lead');
});

test('review code -> Tech Lead (trừ security-review -> Security); gh -> Tech Lead', () => {
  for (const n of ['code-reviewer', 'pr-review', 'reviewer']) {
    assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: n }, roster).id, 'tech-lead', n);
  }
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'security-review' }, roster).id, 'security');
  assert.strictEqual(pre('Bash', { command: 'gh pr view 12' }).id, 'tech-lead');
});

test('vai mới: Security, Mobile, SRE theo đường dẫn; subagent security-reviewer -> Security', () => {
  assert.strictEqual(pre('Edit', { file_path: 'src/auth/login.ts' }).id, 'security');
  assert.strictEqual(pre('Edit', { file_path: 'app/Home.swift' }).id, 'mobile');
  assert.strictEqual(pre('Edit', { file_path: 'monitoring/alerts.json' }).id, 'sre');
  assert.strictEqual(mapEvent({ hook_event_name: 'SubagentStart', agent_type: 'security-reviewer' }, roster).id, 'security');
});

test('roster cũ (không có vai mới) vẫn nhường việc cho vai gần nhất', () => {
  const old = roster.filter((r) => !['security', 'dba', 'mobile', 'tech-writer', 'sre'].includes(r.id));
  const m = (f) => mapEvent({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: f } }, old).id;
  assert.strictEqual(m('a.sql'), 'dev-be');
  assert.strictEqual(m('README.md'), 'ba');
  assert.strictEqual(m('app/Home.swift'), 'dev-fe');
});
