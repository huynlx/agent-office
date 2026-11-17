'use strict';
(function () {
  const THREE = window.THREE;
  const $ = (id) => document.getElementById(id);
  if (!THREE) { $('conn').textContent = 'Không tải được Three.js'; return; }

  const DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const STATUS_COLOR = { working: '#2fbf71', waiting: '#f5b82e', idle: '#9aa3ad' };
  const KIND = { working: 'desk', waiting: 'meet', idle: 'pantry' };
  const PASTELS = ['#ffd6e0', '#d6ecff', '#d9f5d3', '#fff0c2', '#e5dbff', '#ffe0cc', '#cdf3ee', '#f6d5f7'];
  const PI = Math.PI;

  // ---------- Cache geometry/material: mọi mesh dùng chung, chỉ scale khác nhau ----------
  const matCache = new Map();
  const mat = (color, o) => {
    const key = color + (o ? JSON.stringify(o) : '');
    let m = matCache.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0 }, o)); matCache.set(key, m); }
    return m;
  };
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    cone: new THREE.CylinderGeometry(0.45, 1, 1, 12),
    sph: new THREE.SphereGeometry(1, 10, 8),
    ico: new THREE.IcosahedronGeometry(1, 0),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  const basic = (color) => mat(color, { emissive: color, emissiveIntensity: 0.9 });
  const SCREEN_ON = new THREE.MeshBasicMaterial({ color: 0x5ff3ff });
  const SCREEN_OFF = new THREE.MeshBasicMaterial({ color: 0x2b3340 });

  function put(geo, color, sx, sy, sz, x, y, z, parent, o) {
    const m = new THREE.Mesh(geo, typeof color === 'string' || typeof color === 'number' ? mat(color, o) : color);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  const box = (w, h, d, c, x, y, z, p, o) => put(G.box, c, w, h, d, x, y, z, p, o);
  const cyl = (r, h, c, x, y, z, p, o) => put(G.cyl, c, r, h, r, x, y, z, p, o);

  // ---------- Layout tự sinh theo số agent ----------
  function computeLayout(n) {
    const COLS = Math.min(3, n), ROWS = Math.ceil(n / 3), DX = 4.4, DZ = 4.6;
    const workW = COLS * DX + 0.4, xCorr = workW + 0.5;
    const desk = [], pantry = [];
    for (let i = 0; i < n; i++) {
      desk.push({ cx: 0.2 + DX / 2 + (i % 3) * DX, cz: 3 + Math.floor(i / 3) * DZ });
      pantry.push({ x: xCorr + 1.4 + (i % 4) * 1.1, z: 2.5 + Math.floor(i / 4) * 0.95 });
    }
    const lastCz = 3 + (ROWS - 1) * DZ, workD = lastCz + 3.9;
    const pantryEnd = 2.5 + (Math.ceil(n / 4) - 1) * 0.95 + 0.9;
    const tableR = Math.max(1.2, n * 0.17), ring = tableR + 0.6, Ro = ring + 0.9;
    const rightW = Math.max(6.4, 2 * Ro + 0.6);
    const W = xCorr + rightW;
    const D = Math.max(workD, pantryEnd + 2 * Ro + 1.0);
    const meet = { x: xCorr + rightW / 2, z: D - Ro - 0.5, tableR, ring, Ro };
    const seatAng = (i) => PI + (i / n) * 2 * PI;
    const polar = (R, a) => ({ x: meet.x + R * Math.cos(a), z: meet.z + R * Math.sin(a) });

    /** Đường đi từ vị trí (kind,i) tới "hub" trên hành lang dọc x = xCorr. */
    function route(kind, i) {
      const hx = xCorr + ((i % 5) - 2) * 0.18; // mỗi agent một làn riêng trên hành lang để ít chồng nhau khi đi
      if (kind === 'desk') {
        const { cx, cz } = desk[i], aisle = cz + 2.9;
        // Bước sang bên (cx+1.25) trước để không xuyên bàn/ghế khi đứng dậy.
        return [{ x: cx, z: cz + 0.95 }, { x: cx + 1.25, z: cz + 1.0 }, { x: cx + 1.25, z: aisle }, { x: hx, z: aisle }];
      }
      if (kind === 'pantry') return [pantry[i], { x: hx, z: pantry[i].z }];
      const a = seatAng(i);
      let d = (i / n) * 2 * PI; if (d > PI) d -= 2 * PI;
      const pts = [polar(ring, a), polar(Ro, a)];
      const steps = Math.ceil(Math.abs(d) / (PI / 8));
      for (let k = 1; k <= steps; k++) pts.push(polar(Ro, a - (d * k) / steps)); // đi vòng ngoài ghế
      pts.push({ x: hx, z: meet.z });
      return pts;
    }
    function face(kind, i) {
      if (kind === 'meet') { const p = polar(ring, seatAng(i)); return Math.atan2(meet.x - p.x, meet.z - p.z); }
      return PI;
    }
    return { n, COLS, ROWS, W, D, xCorr, workW, desk, pantry, pantryEnd, meet, route, face, polar, seatAng };
  }

  // ---------- Dựng phòng ----------
  function floorTexture(W, D) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d'); let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    x.fillStyle = '#e8c898'; x.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 8; r++) {
      const off = rnd() * 512;
      for (let k = 0; k < 3; k++) {
        const w = 171, px = (off + k * 171) % 512, l = 218 + rnd() * 14;
        x.fillStyle = `rgb(${l + 18},${l - 18},${l - 62})`;
        x.strokeStyle = 'rgba(120,80,40,.35)'; x.lineWidth = 2;
        // Vẽ cả bản dịch -512 để ván nào tràn mép texture vẫn nối liền khi lặp.
        for (const dx of [0, -512]) { x.fillRect(px + dx, r * 64, w, 64); x.strokeRect(px + dx, r * 64, w, 64); }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 4, D / 4);
    return t;
  }

  function chair(parent, x, z, rotY, color) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; parent.add(g);
    cyl(0.05, 0.3, 0x555b66, 0, 0.17, 0, g);
    cyl(0.28, 0.04, 0x555b66, 0, 0.02, 0, g);
    box(0.55, 0.1, 0.55, color, 0, 0.34, 0, g);
    box(0.55, 0.5, 0.08, color, 0, 0.64, -0.27, g); // lưng ghế nằm sau lưng người ngồi (local -z)
  }

  function plant(parent, x, z, s = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent.add(g);
    cyl(0.28, 0.4, 0xd98e6c, 0, 0.2, 0, g);
    [[0, 0.8, 0, 0.42], [0.2, 0.6, 0.1, 0.3], [-0.2, 0.65, -0.1, 0.32], [0, 1.1, 0.05, 0.26]].forEach(([px, py, pz, r], k) =>
      put(G.ico, k % 2 ? 0x6fcf97 : 0x8bdc9e, r, r, r, px, py, pz, g));
  }

  // Ban đêm: không dùng PointLight (17+ đèn sẽ rất nặng); giả ánh sáng bằng quầng sáng cộng màu + vệt sáng trên sàn.
  let glowTex = null, glowSpriteMat = null, poolMat = null;
  function glowAssets() {
    if (glowTex) return;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,236,170,1)'); g.addColorStop(0.35, 'rgba(255,200,110,.45)'); g.addColorStop(1, 'rgba(255,180,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
    glowSpriteMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    poolMat = new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 });
  }

  function lamp(parent, x, z, y = 3.1) {
    glowAssets();
    cyl(0.01, 0.8, 0x888888, x, y + 0.4 + 0.1, z, parent);
    put(G.cone, 0xfff4d6, 0.5, 0.25, 0.5, x, y, z, parent);
    put(G.sph, basic(0xfff3b0), 0.14, 0.14, 0.14, x, y - 0.12, z, parent).castShadow = false;
    const halo = new THREE.Sprite(glowSpriteMat); halo.scale.set(1.6, 1.6, 1); halo.position.set(x, y - 0.15, z); parent.add(halo);
    const pool = new THREE.Mesh(G.plane, poolMat); pool.scale.set(5, 5, 1); pool.rotation.x = -PI / 2; pool.position.set(x, 0.03, z); parent.add(pool);
  }

  function buildRoom(scene, L, defs) {
    const { W, D } = L, WALL_H = 3.4, root = new THREE.Group(); scene.add(root);

    const floor = new THREE.Mesh(G.plane, new THREE.MeshStandardMaterial({ map: floorTexture(W, D), roughness: 0.9 }));
    floor.scale.set(W, D, 1); floor.rotation.x = -PI / 2; floor.position.set(W / 2, 0, D / 2); floor.receiveShadow = true; root.add(floor);
    box(W + 6, 0.2, D + 6, 0x151b2c, W / 2, -0.12, D / 2, root); // nền ngoài phòng

    // Tường sau + tường trái
    box(W + 0.4, WALL_H, 0.2, 0xfaf3e8, W / 2, WALL_H / 2, -0.1, root);
    box(0.2, WALL_H, D + 0.2, 0xf3ece6, -0.1, WALL_H / 2, D / 2 - 0.1, root);
    box(W, 0.18, 0.06, 0xffffff, W / 2, 0.09, 0.03, root);
    box(0.06, 0.18, D, 0xffffff, 0.03, 0.09, D / 2, root);

    const windowAt = (x, z, onBack) => {
      const g = new THREE.Group(); g.position.set(x, 1.9, z); if (!onBack) g.rotation.y = PI / 2; root.add(g);
      box(2.0, 1.5, 0.1, 0xffffff, 0, 0, 0.04, g);
      const glass = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ color: 0x24407a })); glass.scale.set(1.8, 1.3, 1); glass.position.z = 0.1; g.add(glass);
      box(0.06, 1.3, 0.04, 0xffffff, 0, 0, 0.12, g); box(1.8, 0.06, 0.04, 0xffffff, 0, 0, 0.12, g);
    };
    for (let x = 5.2; x + 1 < L.xCorr; x += 4.6) windowAt(x, 0.02, true);
    for (let z = 3.5; z < D - 2; z += 5) windowAt(0.02, z, false);

    // Bảng ghim
    box(2.2, 1.3, 0.06, 0x8a5a33, 2.4, 1.95, 0.03, root);
    box(2.0, 1.1, 0.04, 0xd9a86c, 2.4, 1.95, 0.07, root);
    ['#ff8fa3', '#8fd3ff', '#ffe08f', '#b6f09c', '#d8b4ff'].forEach((c, k) => box(0.38, 0.38, 0.02, c, 1.7 + k * 0.35, 1.95 + (k % 2 ? 0.2 : -0.18), 0.1, root));

    // Khu làm việc
    defs.forEach((d, i) => {
      const { cx, cz } = L.desk[i];
      const rug = new THREE.Mesh(G.plane, mat(PASTELS[i % PASTELS.length])); rug.scale.set(3.5, 3.1, 1); rug.rotation.x = -PI / 2; rug.position.set(cx, 0.012, cz + 0.5); rug.receiveShadow = true; root.add(rug);
      box(2.0, 0.06, 1.0, 0xffffff, cx, 0.69, cz, root);
      [[-0.92, -0.42], [0.92, -0.42], [-0.92, 0.42], [0.92, 0.42]].forEach(([dx, dz]) => box(0.06, 0.66, 0.06, 0xd7dce3, cx + dx, 0.33, cz + dz, root));
      box(0.3, 0.02, 0.2, 0x333a46, cx, 0.73, cz - 0.25, root);
      box(0.06, 0.22, 0.06, 0x333a46, cx, 0.84, cz - 0.25, root);
      box(0.92, 0.57, 0.05, 0x333a46, cx, 1.22, cz - 0.28, root);
      const scr = new THREE.Mesh(G.plane, SCREEN_OFF); scr.scale.set(0.84, 0.49, 1); scr.position.set(cx, 1.22, cz - 0.25); root.add(scr);
      L.screens[i] = scr;
      box(0.55, 0.03, 0.18, 0xf1f3f6, cx, 0.735, cz + 0.12, root);
      cyl(0.06, 0.1, PASTELS[(i + 3) % PASTELS.length], cx + 0.75, 0.77, cz + 0.05, root);
      chair(root, cx, cz + 1.07, PI, d.shirt);
      lamp(root, cx, cz + 0.5);
    });

    // Pantry (góc sau phải)
    const px = L.xCorr;
    box(2.2, 0.9, 0.8, 0xf2e6d8, px + 2.0, 0.45, 0.45, root); box(2.3, 0.06, 0.9, 0x7a8896, px + 2.0, 0.93, 0.45, root);
    box(0.5, 0.3, 0.35, 0x444b57, px + 1.4, 1.11, 0.4, root); cyl(0.14, 0.04, 0x8bdcff, px + 2.5, 0.97, 0.45, root);
    box(0.9, 1.9, 0.8, 0xe9eef3, px + 3.7, 0.95, 0.45, root); box(0.05, 0.5, 0.05, 0x9aa3ad, px + 4.08, 1.2, 0.88, root);
    box(0.55, 1.1, 0.5, 0xf5f7fa, px + 4.55, 0.55, 0.35, root); cyl(0.17, 0.4, 0x8bdcff, px + 4.55, 1.3, 0.35, root, { transparent: true, opacity: 0.8 });
    box(1.1, 1.9, 0.9, 0xff8f8f, px + 5.45, 0.95, 0.5, root);
    ['#fff', '#8fd3ff', '#ffe08f', '#b6f09c'].forEach((c, k) => box(0.22, 0.22, 0.02, c, px + 5.2 + (k % 2) * 0.5, 1.5 + Math.floor(k / 2) * 0.3, 0.97, root));
    lamp(root, px + 3, 2.3);

    // Phòng họp (góc trước phải)
    const M = L.meet;
    cyl(M.tableR, 0.06, 0xffffff, M.x, 0.69, M.z, root); cyl(0.12, 0.66, 0xd7dce3, M.x, 0.33, M.z, root);
    box(0.5, 0.03, 0.35, 0x9aa3ad, M.x + 0.4, 0.74, M.z, root); box(0.5, 0.3, 0.03, 0x333a46, M.x + 0.4, 0.88, M.z - 0.17, root).rotation.x = -0.25;
    for (let i = 0; i < L.n; i++) {
      const p = L.polar(M.ring + 0.14, L.seatAng(i));
      chair(root, p.x, p.z, L.face('meet', i), defs[i].shirt);
    }
    lamp(root, M.x, M.z);
    const rug = new THREE.Mesh(G.cyl, mat('#e5dbff')); rug.scale.set(M.Ro, 0.01, M.Ro); rug.position.set(M.x, 0.01, M.z); rug.receiveShadow = true; root.add(rug);

    // Cây xanh
    plant(root, 0.7, 0.8); plant(root, 0.7, D - 0.7, 1.2); plant(root, L.W - 0.6, D - 0.6, 1.2); plant(root, L.W - 0.6, L.pantryEnd + 0.4);
    for (let r = 0; r < L.ROWS; r++) plant(root, L.workW - 0.4, 3 + r * 4.6 - 0.6, 0.9);
  }

  // ---------- Nhân vật ----------
  function pivot(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  function buildCharacter(def) {
    const model = new THREE.Group(); model.scale.setScalar(0.85);
    // Zombie kiểu Plants vs. Zombies: da xám xanh, vest nâu rách, cà vạt theo màu vai trò, mắt trắng lồi, răng hô, tóc vài chỏm.
    const skin = 0xa9b894, jacket = 0x7b5a3c, pants = 0x6b5d4a;
    const p = { model };
    const body = put(G.sph, jacket, 0.42, 0.48, 0.36, 0, 0.98, 0, model);
    box(0.2, 0.34, 0.04, 0xe8e4d8, 0, 1.05, 0.34, model); // áo sơ mi lộ ra giữa vest
    box(0.09, 0.3, 0.03, def.shirt, 0, 0.98, 0.37, model); // cà vạt = màu vai trò
    box(0.14, 0.1, 0.02, 0x4a3524, 0.16, 0.8, 0.33, model).rotation.z = 0.5; // miếng vá rách
    p.head = pivot(model, 0, 1.78, 0);
    put(G.sph, skin, 0.36, 0.36, 0.36, 0, 0, 0, p.head);
    [[-0.12, 0.34, 0.1], [0, 0.38, 0.12], [0.12, 0.33, 0.1]].forEach(([x, y, r]) => put(G.ico, 0x4a3a2a, r, r * 1.6, r, x, y, 0, p.head)); // chỏm tóc
    put(G.sph, 0xffffff, 0.1, 0.1, 0.08, -0.13, 0.06, 0.3, p.head); put(G.sph, 0x111111, 0.035, 0.035, 0.03, -0.13, 0.06, 0.38, p.head);
    put(G.sph, 0xffffff, 0.13, 0.13, 0.1, 0.13, 0.07, 0.3, p.head); put(G.sph, 0x111111, 0.04, 0.04, 0.03, 0.14, 0.06, 0.4, p.head); // mắt phải lồi to
    box(0.2, 0.07, 0.03, 0x3a1010, 0, -0.14, 0.34, p.head);
    box(0.05, 0.05, 0.02, 0xf4f0e0, -0.04, -0.12, 0.36, p.head); box(0.05, 0.05, 0.02, 0xf4f0e0, 0.04, -0.12, 0.36, p.head); // răng hô
    // Mũ: Giám đốc đội xô, Trưởng phòng/Tech Lead đội nón cảnh báo (giống Buckethead/Conehead).
    if (def.id === 'director') { put(G.cyl, 0x9aa3ad, 0.3, 0.34, 0.3, 0, 0.45, 0, p.head); put(G.cyl, 0x7a838d, 0.33, 0.04, 0.33, 0, 0.29, 0, p.head); }
    else if (def.id === 'head' || def.id === 'tech-lead') put(G.cone, 0xff8a2a, 0.22, 0.5, 0.22, 0, 0.55, 0, p.head);
    const limb = (side) => {
      const sh = pivot(model, side * 0.46, 1.2, 0);
      cyl(0.09, 0.35, jacket, 0, -0.175, 0, sh);
      const el = pivot(sh, 0, -0.35, 0);
      cyl(0.075, 0.3, skin, 0, -0.15, 0, el); put(G.sph, skin, 0.09, 0.09, 0.09, 0, -0.32, 0, el);
      const hip = pivot(model, side * 0.17, 0.6, 0);
      cyl(0.11, 0.3, pants, 0, -0.15, 0, hip);
      const kn = pivot(hip, 0, -0.3, 0);
      cyl(0.095, 0.3, pants, 0, -0.15, 0, kn); box(0.17, 0.09, 0.28, 0x2b2420, 0, -0.3, 0.05, kn);
      return { sh, el, hip, kn };
    };
    p.L = limb(-1); p.R = limb(1); p.body = body;
    return p;
  }

  function makeCanvasSprite(w, h, sw, sh) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(sw, sh, 1); s.renderOrder = 10;
    return { s, ctx: canvas.getContext('2d'), tex, w, h };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  const angDiff = (a, b) => { let d = (b - a) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; };
  const lerp = (a, b, t) => a + (b - a) * t;

  class Agent {
    constructor(def, i, L, scene) {
      this.def = def; this.i = i; this.L = L;
      this.status = 'idle'; this.text = '';
      this.group = new THREE.Group(); scene.add(this.group);
      this.parts = buildCharacter(def);
      this.model = this.parts.model; this.model.userData.agent = this;
      this.group.add(this.model);
      this.label = makeCanvasSprite(384, 96, 1.6, 0.4); this.label.s.position.y = 2.3; this.group.add(this.label.s);
      this.bubble = makeCanvasSprite(512, 128, 2.4, 0.6); this.bubble.s.position.y = 2.85; this.bubble.s.visible = false; this.group.add(this.bubble.s);
      this.sit = 0; this.walk = 0; this.type = 0; this.phase = 0; this.rot = PI; this.facing = PI;
      this.moving = false; this.arrivedAt = 0; this.from = 'pantry'; this.to = 'pantry'; this.pts = []; this.idx = 0; this.loc = 'pantry'; this.heading = PI;
      this.snap('pantry');
      this.drawLabel(); this.drawBubble();
    }
    snap(kind) {
      this.loc = this.from = this.to = kind; this.moving = false;
      const p = this.L.route(kind, this.i)[0];
      this.group.position.set(p.x, 0, p.z);
      this.rot = this.facing = this.L.face(kind, this.i);
      this.sit = kind === 'pantry' ? 0 : 1;
    }
    setStatus(status, text) {
      const changed = status !== this.status, textChanged = (text || '') !== this.text;
      this.status = status; this.text = text || '';
      if (changed) this.drawLabel();
      if (textChanged || changed) this.drawBubble();
      L_screenUpdate(this);
    }
    drawLabel() {
      const { ctx, w, h, tex } = this.label;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(31,36,48,.94)'; roundRect(ctx, 4, 8, w - 8, h - 16, 36); ctx.fill();
      ctx.fillStyle = STATUS_COLOR[this.status]; ctx.beginPath(); ctx.arc(50, h / 2, 16, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(this.def.role, 82, h / 2 + 2, w - 100);
      tex.needsUpdate = true;
    }
    drawBubble() {
      const { ctx, w, h, tex, s } = this.bubble;
      s.visible = !!this.text;
      if (!this.text) return;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '600 34px system-ui, sans-serif';
      const tw = Math.min(w - 40, ctx.measureText(this.text).width + 44), x = (w - tw) / 2;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1f2430'; ctx.lineWidth = 5;
      roundRect(ctx, x, 8, tw, 74, 26); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2 - 14, 82); ctx.lineTo(w / 2, 106); ctx.lineTo(w / 2 + 14, 82); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1f2430'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(this.text, w / 2, 46, tw - 30);
      tex.needsUpdate = true;
    }
    startPath(to) {
      const a = this.L.route(this.loc, this.i), b = this.L.route(to, this.i).slice().reverse();
      this.pts = a.concat(b); this.idx = 1; this.from = this.loc; this.to = to; this.moving = true;
    }
    update(dt, t) {
      const want = KIND[this.status];
      // Việc ngắn (vài giây) vẫn phải ngồi bàn đủ lâu để người xem thấy; rời bàn sau tối thiểu 3s.
      const held = this.loc === 'desk' && t - this.arrivedAt < 3;
      if (!this.moving && want !== this.loc && !held) this.startPath(want);
      else if (this.moving && want === this.from && want !== this.to) {
        // Đổi ý giữa đường: quay lại theo chính những điểm đã đi qua để không xuyên đồ đạc.
        const cur = this.group.position;
        this.pts = [{ x: cur.x, z: cur.z }].concat(this.pts.slice(0, this.idx).reverse());
        this.idx = 1; [this.from, this.to] = [this.to, this.from];
      }

      if (this.moving) {
        let step = 6 * dt; const pos = this.group.position;
        while (step > 0 && this.idx < this.pts.length) {
          const tp = this.pts[this.idx], dx = tp.x - pos.x, dz = tp.z - pos.z, d = Math.hypot(dx, dz);
          if (d > 1e-4) this.heading = Math.atan2(dx, dz);
          if (d <= step) { pos.x = tp.x; pos.z = tp.z; step -= d; this.idx++; } else { pos.x += (dx / d) * step; pos.z += (dz / d) * step; step = 0; }
        }
        if (this.idx >= this.pts.length) { this.moving = false; this.loc = this.to; this.arrivedAt = t; this.facing = this.L.face(this.loc, this.i); }
      }

      const k = 1 - Math.exp(-dt * 8);
      const seated = !this.moving && this.loc !== 'pantry';
      this.walk = lerp(this.walk, this.moving ? 1 : 0, k);
      this.sit = lerp(this.sit, seated ? 1 : 0, k);
      this.type = lerp(this.type, seated && this.loc === 'desk' && this.status === 'working' ? 1 : 0, k);
      this.rot += angDiff(this.rot, this.moving ? this.heading : this.facing) * (1 - Math.exp(-dt * 9));
      this.phase += dt * 5.5 * this.walk; // bước chậm, lê lết

      const { L: l, R: r, head, body } = this.parts, s = this.sit, w = this.walk, ty = this.type;
      const sw = Math.sin(this.phase) * 0.8 * w, br = Math.sin(t * 1.6 + this.i) * 0.03;
      const jitter = Math.sin(t * 24 + this.i * 3) * 0.07 * ty;
      l.hip.rotation.x = lerp(sw, -PI / 2, s); r.hip.rotation.x = lerp(-sw, -PI / 2, s);
      l.kn.rotation.x = lerp(Math.max(0, -Math.sin(this.phase)) * 0.9 * w, PI / 2, s);
      r.kn.rotation.x = lerp(Math.max(0, Math.sin(this.phase)) * 0.9 * w, PI / 2, s);
      // Dáng xác sống: tay đưa thẳng ra trước khi đứng/đi, chỉ khi ngồi gõ phím mới hạ xuống.
      l.sh.rotation.x = lerp(-1.4 + br - sw * 0.2, -1.1, s) + jitter * 0.5 * s;
      r.sh.rotation.x = lerp(-1.4 + br + sw * 0.2, -1.1, s) - jitter * 0.5 * s;
      l.el.rotation.x = lerp(-0.1, -0.6 * (0.4 + 0.6 * ty), s) + jitter;
      r.el.rotation.x = lerp(-0.1, -0.6 * (0.4 + 0.6 * ty), s) - jitter;
      body.position.x = jitter * 0.3;
      head.rotation.y = this.loc === 'meet' && !this.moving ? Math.sin(t * 1.3 + this.i) * 0.35 : 0;
      // Lê bước: nghiêng người lắc lư, đầu lệch một bên (không dùng khi ngồi để không méo tư thế gõ phím).
      this.model.rotation.z = Math.sin(this.phase) * 0.1 * w * (1 - s);
      head.rotation.z = 0.3 + Math.sin(t * 0.9 + this.i) * 0.08;
      this.model.rotation.y = this.rot;
      this.model.position.y = -0.09 * s + Math.abs(Math.sin(this.phase)) * 0.06 * w;
    }
  }

  // Màn hình bàn sáng khi agent tương ứng đang làm việc.
  function L_screenUpdate(a) { if (a.L.screens[a.i]) a.L.screens[a.i].material = a.status === 'working' ? SCREEN_ON : SCREEN_OFF; }

  // ---------- Camera orbit tự viết ----------
  class Orbit {
    constructor(camera, dom, L) {
      this.camera = camera; this.dom = dom;
      this.home = { tx: L.W / 2, ty: 0.5, tz: L.D / 2, r: Math.max(L.W, L.D) * 1.3, th: PI / 4, ph: 0.85 };
      this.goal = Object.assign({}, this.home); this.cur = Object.assign({}, this.home);
      this.follow = null; this.drag = null; this.moved = 0;
      dom.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; this.moved = 0; dom.setPointerCapture(e.pointerId); });
      dom.addEventListener('pointermove', (e) => {
        if (!this.drag) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag = { x: e.clientX, y: e.clientY }; this.moved += Math.abs(dx) + Math.abs(dy);
        this.goal.th = Math.min(PI / 2 + 0.2, Math.max(-0.2, this.goal.th - dx * 0.006));
        this.goal.ph = Math.min(1.4, Math.max(0.3, this.goal.ph - dy * 0.006));
      });
      dom.addEventListener('pointerup', () => { this.drag = null; });
      dom.addEventListener('wheel', (e) => { e.preventDefault(); this.goal.r = Math.min(45, Math.max(4, this.goal.r * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    }
    focus(agent) { this.follow = agent; this.goal.r = 7; this.goal.ph = 1.0; }
    reset() { this.follow = null; Object.assign(this.goal, this.home); }
    update(dt) {
      if (this.follow) { const p = this.follow.group.position; this.goal.tx = p.x; this.goal.ty = 1; this.goal.tz = p.z; }
      const k = 1 - Math.exp(-dt * 6), c = this.cur, g = this.goal;
      for (const key in c) c[key] = lerp(c[key], g[key], k);
      const sp = Math.sin(c.ph);
      this.camera.position.set(c.tx + c.r * sp * Math.sin(c.th), c.ty + c.r * Math.cos(c.ph), c.tz + c.r * sp * Math.cos(c.th));
      this.camera.lookAt(c.tx, c.ty, c.tz);
    }
  }

  // ---------- Khởi tạo ----------
  let agents = [], histories = {}, orbit, focusId = null;

  function addHistory(id, e) {
    const h = (histories[id] = histories[id] || []), last = h[h.length - 1];
    if (!last || last.status !== e.status || last.text !== e.text) { h.push({ ts: e.ts, status: e.status, text: e.text }); if (h.length > 10) h.shift(); }
  }

  function applyEvent(e) {
    const a = agents.find((x) => x.def.id === e.id);
    if (!a) return;
    addHistory(e.id, e);
    a.setStatus(e.status, e.text);
    renderList(); if (focusId === e.id) renderDetail();
  }

  const fmt = (ts) => new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });

  function renderList() {
    const ul = $('list'); ul.textContent = '';
    agents.forEach((a) => {
      const li = document.createElement('li'); li.className = a.status;
      const dot = document.createElement('span'); dot.className = 'dot';
      const role = document.createElement('span'); role.className = 'role'; role.textContent = a.def.role;
      const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = a.status;
      const task = document.createElement('span'); task.className = 'task'; task.textContent = a.text || '—';
      li.append(dot, role, pill, task);
      li.onclick = () => focusAgent(a);
      ul.append(li);
    });
    $('count').textContent = `(${agents.length})`;
  }

  function renderDetail() {
    const a = agents.find((x) => x.def.id === focusId);
    $('detail').hidden = !a;
    if (!a) return;
    $('dname').textContent = `${a.def.role} · ${a.status}`;
    const ul = $('events'); ul.textContent = '';
    (histories[focusId] || []).slice().reverse().forEach((e) => {
      const li = document.createElement('li'), t = document.createElement('time'); t.textContent = fmt(e.ts);
      li.append(t, document.createTextNode(`${e.status}${e.text ? ' · ' + e.text : ''}`)); ul.append(li);
    });
    if (!ul.children.length) ul.innerHTML = '<li>Chưa có sự kiện</li>';
  }

  function focusAgent(a) { focusId = a.def.id; orbit.focus(a); renderDetail(); }
  function unfocus() { focusId = null; orbit.reset(); renderDetail(); }

  function setConn(on) { $('connbox').classList.toggle('on', on); $('conn').textContent = DEMO ? 'Chế độ demo' : on ? 'Đã kết nối' : 'Mất kết nối — đang thử lại…'; }

  function showResult(d) {
    $('rtitle').textContent = d.code === 0 ? 'Kết quả' : 'Lỗi (mã ' + d.code + ')';
    $('rtext').textContent = d.output || '(không có đầu ra)';
    $('result').hidden = false;
  }
  $('rclose').onclick = () => { $('result').hidden = true; };

  function setRunning(on) {
    $('psend').disabled = on; $('ptext').placeholder = on ? 'Claude Code đang chạy…' : 'Giao việc cho Claude Code… (Enter để gửi)';
  }

  // File đính kèm được đọc ngay trong trình duyệt và ghép vào prompt: không ghi đĩa, không phụ thuộc đường dẫn.
  const attached = [];
  const MAX_FILE = 400 * 1024;
  function renderChips() {
    const box = $('chips'); box.textContent = '';
    attached.forEach((f, i) => {
      const c = document.createElement('span'); c.className = 'chip'; c.textContent = f.name + ' ';
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.onclick = () => { attached.splice(i, 1); renderChips(); };
      c.append(x); box.append(c);
    });
  }
  async function addFiles(files) {
    for (const f of files) {
      if (f.size > MAX_FILE) { $('ptext').placeholder = f.name + ' quá lớn (tối đa 400KB)'; continue; }
      const text = await f.text();
      if (text.includes('\u0000')) { $('ptext').placeholder = f.name + ' không phải file văn bản'; continue; }
      attached.push({ name: f.name, text });
    }
    renderChips();
  }
  $('pattach').onclick = () => $('pfile').click();
  $('pfile').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  const form = $('prompt');
  form.addEventListener('dragover', (e) => { e.preventDefault(); form.classList.add('drag'); });
  form.addEventListener('dragleave', () => form.classList.remove('drag'));
  form.addEventListener('drop', (e) => { e.preventDefault(); form.classList.remove('drag'); addFiles([...e.dataTransfer.files]); });

  $('prompt').onsubmit = async (e) => {
    e.preventDefault();
    const typed = $('ptext').value.trim();
    const text = attached.map((f) => '[File đính kèm: ' + f.name + ']\n```\n' + f.text + '\n```\n\n').join('') + typed;
    if (!typed || DEMO) { if (DEMO) $('ptext').placeholder = 'Demo: không gửi tới Claude Code'; return; }
    const r = await fetch('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Office': '1' }, body: JSON.stringify({ text }) }).catch(() => null);
    if (r && r.ok) { $('ptext').value = ''; attached.length = 0; renderChips(); $('result').hidden = true; }
    else $('ptext').placeholder = r && r.status === 409 ? 'Đang bận, đợi chạy xong' : 'Gửi thất bại';
  };

  function connect(first) {
    const es = new EventSource('/stream');
    es.onopen = () => setConn(true);
    es.onerror = () => { setConn(false); if (es.readyState === 2) { es.close(); setTimeout(() => connect(false), 2000); } };
    es.addEventListener('init', (ev) => {
      const d = JSON.parse(ev.data); histories = d.history || {}; setRunning(!!d.running);
      agents.forEach((a) => {
        const s = d.states[a.def.id]; if (!s) return;
        a.setStatus(s.status, s.text);
        if (first) a.snap(KIND[s.status]);
      });
      renderList(); renderDetail();
    });
    es.addEventListener('run', (ev) => {
      const d = JSON.parse(ev.data); setRunning(d.running);
      if (!d.running) showResult(d);
    });
    es.addEventListener('state', (ev) => applyEvent(JSON.parse(ev.data)));
  }

  function startDemo() {
    const texts = ['Edit App.tsx', 'Write schema.sql', 'Read README.md', 'Bash git', 'Grep', 'Edit Dockerfile', 'Edit login.test.ts', 'Write style.css'];
    const ev = (i, status, text) => agents[i % agents.length] && applyEvent({ id: agents[i % agents.length].def.id, status, text, ts: Date.now() });
    const script = [[600, 0, 'working', 'Edit App.tsx'], [1500, 3, 'working', 'Write schema.sql'], [2400, 1, 'waiting', 'Waiting for you'], [3300, 5, 'working', 'Edit login.test.ts']];
    script.forEach(([ms, i, s, t]) => setTimeout(() => ev(i, s, t), ms));
    setInterval(() => {
      const a = agents[Math.floor(Math.random() * agents.length)];
      if (a.status === 'idle') ev(a.i, Math.random() < 0.8 ? 'working' : 'waiting', Math.random() < 0.8 ? texts[Math.floor(Math.random() * texts.length)] : 'Waiting for you');
      else ev(a.i, 'idle', '');
    }, 2200);
  }

  async function main() {
    const roster = await (await fetch('/roster')).json();
    const L = computeLayout(roster.length); L.screens = [];

    const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1020);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

    scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x20263a, 0.4));
    const sun = new THREE.DirectionalLight(0xaabbff, 0.3); // ánh trăng
    const span = Math.max(L.W, L.D) * 0.75;
    sun.position.set(L.W * 0.9, 20, L.D * 1.1); sun.target.position.set(L.W / 2, 0, L.D / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 70 });
    scene.add(sun, sun.target);

    buildRoom(scene, L, roster);
    agents = roster.map((d, i) => new Agent(d, i, L, scene));
    orbit = new Orbit(camera, renderer.domElement, L);
    renderList();

    function resize() {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      // Dịch khung hình sang trái để bảng WORKERS không che pantry.
      if (window.innerWidth > 900) camera.setViewOffset(window.innerWidth, window.innerHeight, 150, 0, window.innerWidth, window.innerHeight); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();

    // Click vs kéo: chỉ coi là click khi chuột gần như không di chuyển.
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    renderer.domElement.addEventListener('click', (e) => {
      if (orbit.moved > 5) return;
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(agents.map((a) => a.model), true)[0];
      if (!hit) return;
      let o = hit.object; while (o && !o.userData.agent) o = o.parent;
      if (o) focusAgent(o.userData.agent);
    });
    $('dclose').onclick = unfocus;

    let raf = 0, last = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      agents.forEach((a) => a.update(dt, now / 1000));
      orbit.update(dt);
      renderer.render(scene, camera);
    }
    // Tab ẩn thì dừng render để khỏi tốn pin.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    });
    raf = requestAnimationFrame(frame);

    if (DEMO) { setConn(true); startDemo(); } else connect(true);
    window.__office = { agents, scene, orbit }; // phục vụ debug
  }

  main().catch((e) => { $('conn').textContent = 'Lỗi: ' + e.message; console.error(e); });
})();
