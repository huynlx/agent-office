'use strict';
const fs = require('fs');
const path = require('path');
const { createApp } = require('./server');

const roster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'roster.json'), 'utf8'));
if (!Array.isArray(roster) || !roster.length || new Set(roster.map((r) => r.id)).size !== roster.length) {
  console.error('config/roster.json phải là mảng không rỗng với id duy nhất');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 4747;
createApp({ roster })
  .listen(PORT)
  .then((p) => console.log(`Virtual Agent Office: http://localhost:${p}  (demo: ?demo=1)`))
  .catch((e) => { console.error(e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang bận (đặt PORT=...)` : e); process.exit(1); });
