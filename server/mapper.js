'use strict';

/** Các sự kiện hook được hỗ trợ; mọi thứ khác bị bỏ qua. */
const KNOWN = new Set(['PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop']);

/** id vai trò mà quy tắc tool/đường dẫn nhắm tới (phải khớp config/roster.json). */
const ROLE = { FE: 'dev-fe', BE: 'dev-be', QC: 'qc', DEVOPS: 'devops', BA: 'ba', TL: 'tech-lead' };

// Thứ tự quan trọng: devops trước QC để `.github/workflows/test.yml` thuộc Devops.
const PATH_RULES = [
  [/(^|\/)(dockerfile[^/]*|\.github\/.*|[^/]*\.ya?ml)$/i, ROLE.DEVOPS],
  [/(^|\/)(tests?|__tests__)\/|(^|[._-])(test|spec)s?([._-]|$)[^/]*$/i, ROLE.QC],
  [/\.mdx?$|(^|\/)docs\//i, ROLE.BA],
  [/\.sql$|(^|\/)(server|api)\//i, ROLE.BE],
  [/\.(tsx|jsx|css|scss|html)$/i, ROLE.FE],
];

const compiledCache = new WeakMap();

/** Biên dịch `match` của roster một lần; regex sai cú pháp được coi như chuỗi thường. */
function matchersOf(roster) {
  let list = compiledCache.get(roster);
  if (!list) {
    list = roster.map((r) => ({
      id: r.id,
      res: (r.match || []).map((s) => {
        try { return new RegExp(s, 'i'); } catch { return new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      }),
    }));
    compiledCache.set(roster, list);
  }
  return list;
}

/** Lấy vai trò theo id; không có thì Tech Lead; không có nữa thì người đầu tiên. */
function pickRole(roster, id) {
  return roster.find((r) => r.id === id) || roster.find((r) => r.id === ROLE.TL) || roster[0];
}

/** Làm sạch text hiển thị: bỏ ký tự điều khiển, cắt 40 ký tự. */
function clean(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
}

/** Tên file cuối cùng của một đường dẫn (Windows hoặc POSIX). */
function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

/** Khớp tên subagent với roster: id trùng hẳn trước, rồi tới regex `match`. */
function findBySubagent(p, roster) {
  const name = p.agent_type || p.subagent_type || p.agent_name;
  if (typeof name !== 'string' || !name) return null;
  const exact = roster.find((r) => r.id === name.toLowerCase());
  if (exact) return exact;
  const hit = matchersOf(roster).find((m) => m.res.some((re) => re.test(name)));
  return hit ? roster.find((r) => r.id === hit.id) : null;
}

/**
 * Suy ra id vai trò từ tên tool và tham số.
 * @param {string} tool Tên tool, ví dụ "Edit", "Bash".
 * @param {object} [input] `tool_input` của hook (chỉ đọc file_path và từ đầu của command).
 * @returns {string} id vai trò (ví dụ "dev-fe").
 * @example
 * roleForTool('Edit', { file_path: 'src/App.tsx' }); // 'dev-fe'
 */
function roleForTool(tool, input = {}) {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return ROLE.BA;
  if (tool === 'Bash') {
    const first = String(input.command || '').trim().split(/\s+/)[0];
    if (first === 'git') return ROLE.TL;
    if (/^(docker|docker-compose|kubectl|terraform|helm)$/.test(first)) return ROLE.DEVOPS;
    return ROLE.TL;
  }
  const file = String(input.file_path || input.notebook_path || '').replace(/\\/g, '/');
  if (file) for (const [re, id] of PATH_RULES) if (re.test(file)) return id;
  return ROLE.TL;
}

/** Text ngắn hiển thị: chỉ tên tool + tên file (hoặc lệnh đầu của Bash), không bao giờ nội dung. */
function toolText(tool, input = {}) {
  if (tool === 'Bash') return clean(`Bash ${String(input.command || '').trim().split(/\s+/)[0]}`);
  const f = input.file_path || input.notebook_path;
  return clean(f ? `${tool} ${baseName(f)}` : tool);
}

/**
 * Ánh xạ một payload hook thành thay đổi trạng thái của agent.
 * @param {object} payload JSON thô từ hook Claude Code.
 * @param {Array<object>} roster Danh sách vai trò từ config/roster.json.
 * @param {{lastId?: string}} [ctx] Ngữ cảnh: agent hoạt động gần nhất (dùng cho Notification).
 * @returns {null|{all?: true, id?: string, status: string, text: string, settle?: true}}
 *   null nếu sự kiện lạ; `all` nghĩa là áp cho mọi agent; `settle` nghĩa là tự về idle sau một lúc.
 * @example
 * mapEvent({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a/App.tsx' } }, roster);
 * // { id: 'dev-fe', status: 'working', text: 'Edit App.tsx' }
 */
function mapEvent(payload, roster, ctx = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(roster) || !roster.length) return null;
  const ev = payload.hook_event_name;
  if (!KNOWN.has(ev)) return null;

  if (ev === 'Stop') return { all: true, status: 'idle', text: '' };

  if (ev === 'Notification') {
    const last = roster.find((r) => r.id === ctx.lastId);
    return { id: (last || pickRole(roster, ROLE.TL)).id, status: 'waiting', text: 'Waiting for you' };
  }

  const sub = findBySubagent(payload, roster);

  if (ev === 'SubagentStart' || ev === 'SubagentStop') {
    const id = (sub || pickRole(roster, ROLE.TL)).id;
    if (ev === 'SubagentStop') return { id, status: 'idle', text: '' };
    const label = typeof payload.agent_type === 'string' ? clean(payload.agent_type) : '';
    return { id, status: 'working', text: clean(`Subagent ${label}`) };
  }

  const tool = payload.tool_name;
  if (typeof tool !== 'string' || !tool) return null;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  // Tool chạy trong subagent thì tính cho vai trò của subagent đó.
  const id = (sub || pickRole(roster, roleForTool(tool, input))).id;
  const out = { id, status: 'working', text: toolText(tool, input) };
  if (ev === 'PostToolUse') out.settle = true;
  return out;
}

/**
 * Tạo bộ theo dõi trạng thái: áp sự kiện đã ánh xạ, hẹn giờ về idle, giữ lịch sử 10 sự kiện/agent.
 * @param {Array<object>} roster Danh sách vai trò.
 * @param {(e: {id: string, status: string, text: string, ts: number}) => void} emit Callback khi một agent đổi trạng thái.
 * @param {number} [idleMs=8000] Số ms sau PostToolUse không có sự kiện thì về idle.
 * @returns {{handle: (payload: object) => (object|null), snapshot: () => object}}
 * @example
 * const t = createTracker(roster, (e) => console.log(e));
 * t.handle({ hook_event_name: 'Stop' });
 */
function createTracker(roster, emit, idleMs = 8000) {
  const states = new Map(roster.map((r) => [r.id, { status: 'idle', text: '', ts: Date.now() }]));
  const history = new Map(roster.map((r) => [r.id, []]));
  const timers = new Map();
  let lastId = null;

  function set(id, status, text) {
    clearTimeout(timers.get(id));
    const prev = states.get(id);
    const e = { id, status, text, ts: Date.now() };
    states.set(id, { status, text, ts: e.ts });
    // Pre + Post của cùng tool sinh 2 sự kiện giống nhau; chỉ ghi lịch sử một lần.
    if (!prev || prev.status !== status || prev.text !== text) {
      const h = history.get(id);
      h.push(e);
      if (h.length > 10) h.shift();
    }
    emit(e);
  }

  return {
    handle(payload) {
      const ev = mapEvent(payload, roster, { lastId });
      if (!ev) return null;
      if (ev.all) {
        for (const r of roster) if (states.get(r.id).status !== 'idle') set(r.id, 'idle', '');
        return ev;
      }
      lastId = ev.id;
      set(ev.id, ev.status, ev.text);
      if (ev.settle) {
        const t = setTimeout(() => set(ev.id, 'idle', ''), idleMs);
        if (t.unref) t.unref();
        timers.set(ev.id, t);
      }
      return ev;
    },
    snapshot() {
      return { states: Object.fromEntries(states), history: Object.fromEntries(history) };
    },
  };
}

module.exports = { mapEvent, createTracker, roleForTool };
