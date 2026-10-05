/* ===== rules.js — 彩虹泡泡砲的共用規則核心（瀏覽器與 Node 伺服器共用，純函式、無 DOM） =====
 *
 * 單機、電腦、線上全部走同一份規則：
 *   - 盤面是六角交錯格：偶數列 cols 格、奇數列 cols-1 格（parity 會在天花板下降時翻轉）
 *   - 一發泡泡的整個結果（飛行路徑、落點、消除、掉落）都由「盤面狀態＋角度」決定，
 *     所以線上只要依相同順序重播「發射／交換／落下」事件，每個人的盤面就會完全一致
 *   - 為了讓不同瀏覽器與 Node 算出完全相同的軌跡，三角函式不用 Math.sin/cos（各引擎末位可能不同），
 *     改用只靠加減乘除的自製表（IEEE 754 四則運算在所有引擎上結果一致）
 *
 * 座標：泡泡半徑 R = 1；格 (r,c) 的圓心 x = 1 + 2c + off，y = 1 + √3·r，其中 off = (r+parity) & 1。
 * 格子內容：0 空；低 4 位是顏色 1～10、15 是雲朵磚（消不掉、永遠算黏在天花板）；高位是標記（1 星星、2 獎勵）。
 */
(function (root) {
  'use strict';

  const SQ3 = Math.sqrt(3);
  const OBST = 15;
  const LINE_ROW = 12;            /* 泡泡落到這一列（含）以下就算碰到底線 */
  const MAX_ROWS = 17;            /* 盤面最多存幾列（超過的一律視為溢出） */
  const MIN_A = 1200, MAX_A = 16800;   /* 發射角度（百分之一度）：12°～168° */
  const STEP = 0.2;               /* 飛行模擬步長 */
  const HIT_D = 1.86;             /* 圓心距離小於這個值就算碰到 */
  const RAIN_ROWS = 3;            /* 觸底時沖掉最底下幾列 */
  const PROTECT_SHOTS = 2;        /* 泡泡雨之後的保護發數 */

  /* ---------- 難度表 ---------- */
  const LEVELS = ['baby', 'easy', 'normal', 'hard'];
  const LEVEL_NAME = { baby: '幼幼班', easy: '簡單', normal: '普通', hard: '困難' };
  const DIFF = {
    baby:   { assist: 0.8, pity: 1, starR: 1, laser: 0.04, cols: 9,  colors: [1, 2, 4, 6],        descend: 0,  rainbow: 0.04, star: 0.04, wild: 0,    mult: 0.5,  warnMs: 2500, rows: [5, 6] },
    easy:   { assist: 0.7, pity: 1, starR: 1, laser: 0.04, cols: 10, colors: [1, 2, 3, 4, 5, 6],  descend: 10, rainbow: 0.04, star: 0.04, wild: 0.1,  mult: 0.75, warnMs: 2000, rows: [7, 9] },
    normal: { assist: 0.15, pity: 1, starR: 1, laser: 0.035, cols: 12, colors: [1, 2, 3, 4, 5, 6, 7, 8],descend: 7, rainbow: 0.035, star: 0.035, wild: 0.25, mult: 1,    warnMs: 1500, rows: [7, 10] },
    hard:   { assist: 0.08, pity: 3, starR: 1, laser: 0.03, cols: 14, colors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], descend: 5, rainbow: 0.03, star: 0.03, wild: 0.4,  mult: 1,    warnMs: 1500, rows: [8, 11] }
  };

  /* ---------- 亂數：mulberry32 與雜湊 ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b) {
    let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }
  const rand01 = (a, b) => hash2(a, b) / 4294967296;

  /* ---------- 只用四則運算的 sin/cos 表（百分之一度） ---------- */
  const DIRX = new Float64Array(MAX_A + 1), DIRY = new Float64Array(MAX_A + 1);
  (function buildTable() {
    const PI = 3.141592653589793;
    for (let a = MIN_A; a <= MAX_A; a++) {
      const x = a * PI / 18000;
      /* 泰勒級數到 x^21，x ∈ [0.2, 2.95]，誤差遠小於 1e-9 */
      let term = x, s = x;
      for (let k = 1; k <= 11; k++) { term = -term * x * x / ((2 * k) * (2 * k + 1)); s += term; }
      let t2 = 1, c = 1;
      for (let k = 1; k <= 11; k++) { t2 = -t2 * x * x / ((2 * k - 1) * (2 * k)); c += t2; }
      DIRX[a] = c; DIRY[a] = s;
    }
  })();
  const clampAngle = a => { a = Math.round(a); return a < MIN_A ? MIN_A : a > MAX_A ? MAX_A : a; };

  /* ---------- 格子工具 ---------- */
  const colorOf = v => v & 15;
  const modOf = v => v >> 4;
  const isBubble = v => v !== 0 && (v & 15) !== OBST;
  const offOf = (b, r) => (r + b.parity) & 1;
  const rowLen = (b, r) => b.cols - offOf(b, r);
  const cx = (b, r, c) => 1 + 2 * c + offOf(b, r);
  const cy = r => 1 + SQ3 * r;
  const inBoard = (b, r, c) => r >= 0 && r < MAX_ROWS && c >= 0 && c < rowLen(b, r);
  function get(b, r, c) { if (r < 0 || r >= b.rows.length) return 0; const row = b.rows[r]; return c >= 0 && c < row.length ? row[c] : 0; }
  function ensureRow(b, r) {
    while (b.rows.length <= r) b.rows.push(new Array(rowLen(b, b.rows.length)).fill(0));
  }
  function set(b, r, c, v) { ensureRow(b, r); b.rows[r][c] = v; }
  function neighbors(b, r, c) {
    const off = offOf(b, r);
    const out = [];
    const cand = off === 0
      ? [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]]
      : [[r, c - 1], [r, c + 1], [r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]];
    for (const p of cand) if (inBoard(b, p[0], p[1])) out.push(p);
    return out;
  }
  const key = (r, c) => r * 64 + c;

  function cloneBoard(b) {
    const o = Object.assign({}, b);
    o.rows = b.rows.map(r => r.slice());
    o.cur = Object.assign({}, b.cur);
    o.nxt = Object.assign({}, b.nxt);
    o.colors = b.colors.slice();
    return o;
  }

  function bubbleCount(b) {
    let n = 0;
    for (const row of b.rows) for (const v of row) if (isBubble(v)) n++;
    return n;
  }
  function lowestRow(b) {
    for (let r = b.rows.length - 1; r >= 0; r--) { for (const v of b.rows[r]) if (v) return r; }
    return -1;
  }
  function presentColors(b) {
    const seen = new Set();
    for (const row of b.rows) for (const v of row) if (isBubble(v)) seen.add(colorOf(v));
    return Array.from(seen).sort((x, y) => x - y);
  }

  /* 現在「打得到、而且能湊成 3 顆」的顏色：有一組同色（≥2 顆）的某顆泡泡露出空位（在盤面下緣或側邊露出來的） */
  function readyColors(b) {
    const seen = new Set(), out = new Set();
    for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) {
      const v = b.rows[r][c];
      if (!isBubble(v) || v === OBST || seen.has(key(r, c))) continue;
      const g = group(b, r, c);
      for (const q of g) seen.add(key(q[0], q[1]));
      if (g.length < 2) continue;
      const open = g.some(q => {
        for (const n of neighbors(b, q[0], q[1])) if (!isBubble(get(b, n[0], n[1])) && n[0] < LINE_ROW) return true;
        return false;
      });
      if (open) out.add(colorOf(v));
    }
    return Array.from(out).sort((x, y) => x - y);
  }

  /* ---------- 發射序列（由 seed 與已發射次數決定） ---------- */
  function genItem(b, idx) {
    const r1 = rand01(b.queueSeed, idx * 3 + 1);
    const r2 = rand01(b.queueSeed, idx * 3 + 2);
    const present = presentColors(b);
    /* wild：難度越高，越常出現盤面上沒有的顏色（要靠交換或繞路消） */
    let wild = b.cfg.wild > 0 && rand01(b.queueSeed, idx * 3 + 3) < b.cfg.wild;
    /* 穩定難度：每一發有固定比例會從「現在打得到、能湊成 3 顆」的顏色裡抽（assist，難度越低越高）；
     * 剛剛才沒消到時（miss）更是必定給一發能消的，不讓運氣把難度拉得忽高忽低 */
    const lucky = b.miss >= (b.cfg.pity || 1);
    let pool = present;
    if (lucky) wild = false;
    if (wild || !present.length) pool = b.colors;
    else {
      const ready = readyColors(b);
      if (ready.length && (lucky || rand01(b.queueSeed + 31337, idx) < (b.cfg.assist || 0))) pool = ready;
      /* 卡關保險：盤面上已經沒有任何成對的同色（只剩落單的），普通泡泡怎麼射都消不掉，這時送一顆星星或閃電泡泡 */
      else if (!ready.length && lucky && bubbleCount(b) > 0) return { k: rand01(b.queueSeed + 4242, idx) < 0.5 ? 'star' : 'laser', c: 0 };
    }
    const color = pool[Math.floor(r2 * pool.length) % pool.length];
    if (r1 < b.cfg.rainbow) return { k: 'rainbow', c: 0 };
    if (r1 < b.cfg.rainbow + b.cfg.star) return { k: 'star', c: 0 };
    if (r1 < b.cfg.rainbow + b.cfg.star + (b.cfg.laser || 0)) return { k: 'laser', c: 0 };
    return { k: 'n', c: color };
  }

  /* ---------- 建立盤面 ---------- */
  function newBoard(opt) {
    const level = DIFF[opt.level] ? opt.level : 'normal';
    const cfg = DIFF[level];
    const cols = opt.cols || cfg.cols;
    const rng = mulberry32(hash2(opt.seed, 17));
    const b = {
      level, cfg, cols, parity: 0, rows: [], colors: cfg.colors.slice(),
      seed: opt.seed >>> 0, queueSeed: hash2(opt.seed, 99), shots: 0, miss: 0, cleared: 0, combo: 0,
      maxCombo: 0, hits: 0, best: 0, dropN: 0, descents: 0, rains: 0, protect: 0, fullClear: false, layoutId: '', layoutName: '', garbageIn: 0, garbageOut: 0,
      cur: { k: 'n', c: 1 }, nxt: { k: 'n', c: 1 }
    };
    const Layouts = root.Layouts || (typeof require === 'function' ? require('./layouts.js') : null);
    const Tiers = root.LayoutTiers || (typeof require === 'function' ? require('./layout-tiers.js') : null);
    const lay = Layouts.resolve(opt.layoutId || 'random', { cols, rng, noObstacles: level === 'baby', allow: Tiers && Tiers[level] ? Tiers[level] : null });
    b.layoutId = lay.id; b.layoutName = lay.name;
    /* 顏色槽 → 本局顏色：用 seed 洗牌，槽數超過顏色數就循環使用 */
    const perm = b.colors.slice();
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    /* 版型只有 6 個顏色槽；顏色比 6 種多時，約 2 成的格子改抽其他顏色，讓每種造型都會出現 */
    const slotColor = k => (perm.length > 6 && rng() < Math.min(0.6, 0.12 * (perm.length - 5)) ? perm[Math.floor(rng() * perm.length)] : perm[k % perm.length]);
    const randColor = () => b.colors[Math.floor(rng() * b.colors.length)];
    lay.rows.slice(0, cfg.rows[1]).forEach((str, r) => {
      const row = [];
      for (let c = 0; c < str.length; c++) {
        const ch = str[c];
        let v = 0;
        if (ch >= 'a' && ch <= 'f') v = slotColor(ch.charCodeAt(0) - 97);
        else if (ch >= 'A' && ch <= 'F') v = slotColor(ch.charCodeAt(0) - 65) | (1 << 4);
        else if (ch === '#') v = randColor();
        else if (ch === '*') v = randColor() | (1 << 4);
        else if (ch === '+') v = randColor() | (2 << 4);
        else if (ch === 'X') v = OBST;
        row.push(v);
      }
      while (row.length < rowLen(b, r)) row.push(0);
      b.rows.push(row);
    });
    /* 保證有星星記號泡泡：很多版型沒有標記，補到約 5% 的泡泡（至少 3 顆，用獨立亂數不影響其他抽籤） */
    {
      const cells = []; let marked = 0;
      b.rows.forEach((row, r) => row.forEach((v, c) => { if (isBubble(v)) { if (modOf(v) === 1) marked++; else if (modOf(v) === 0) cells.push([r, c]); } }));
      const want = Math.max(3, Math.round((cells.length + marked) * 0.05));
      const mr = mulberry32(hash2(opt.seed, 271));
      for (let i = marked; i < want && cells.length; i++) {
        const q = cells.splice(Math.floor(mr() * cells.length), 1)[0];
        b.rows[q[0]][q[1]] |= (1 << 4);
      }
    }
    ensureStartable(b, rng);
    b.cur = genItem(b, 0);
    b.nxt = genItem(b, 1);
    b.qIdx = 2;
    ensureNoOneShot(b, rng);
    return b;
  }

  /* 避免「一發就整盤清光」：開局前兩顆泡泡（含換位）任何角度的消除量都不能超過盤面的一半。
   * 做法：找出讓盤面大量掉落的那一發，把被打掉那一組裡的一顆換成別的顏色，反覆直到安全。 */
  function ensureNoOneShot(b, rng) {
    const total = bubbleCount(b);
    const limit = Math.max(8, Math.floor(total * 0.34));
    for (let guard = 0; guard < 60; guard++) {
      let worst = null;
      for (const which of ['cur', 'nxt']) {
        for (let a = 1200; a <= 16800; a += 200) {
          const t = cloneBoard(b);
          t.cur = Object.assign({}, b[which]);
          const res = applyShot(t, a);
          if (res.gained > limit && (!worst || res.gained > worst.gained)) worst = { gained: res.gained, res, a };
        }
      }
      if (!worst) return;
      /* 被直接打掉的那一組（不含新放上去的那顆）挑一顆換色 */
      const cand = worst.res.popped.filter(q => q.how !== 'fizzle' && isBubble(get(b, q.r, q.c)));
      if (!cand.length) return;
      const q = cand[Math.floor(rng() * cand.length)];
      const old = get(b, q.r, q.c);
      const others = b.colors.filter(c => c !== colorOf(old));
      if (!others.length) return;
      set(b, q.r, q.c, others[Math.floor(rng() * others.length)] | (modOf(old) << 4));
    }
  }

  /* 保證開局至少有一組可以打掉：若整盤找不到三顆相連的同色，就把某格改成鄰居的顏色 */
  function ensureStartable(b, rng) {
    const hasTriple = () => {
      const seen = new Set();
      for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) {
        const v = b.rows[r][c];
        if (!isBubble(v) || seen.has(key(r, c))) continue;
        const g = group(b, r, c);
        g.forEach(p => seen.add(key(p[0], p[1])));
        if (g.length >= 3) return true;
      }
      return false;
    };
    let guard = 0;
    while (!hasTriple() && guard++ < 40) {
      const cells = [];
      for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) if (isBubble(b.rows[r][c])) cells.push([r, c]);
      if (!cells.length) return;
      const p = cells[Math.floor(rng() * cells.length)];
      const nb = neighbors(b, p[0], p[1]).filter(q => isBubble(get(b, q[0], q[1])));
      if (nb.length) { const q = nb[Math.floor(rng() * nb.length)]; set(b, p[0], p[1], colorOf(get(b, q[0], q[1])) | (modOf(get(b, p[0], p[1])) << 4)); }
    }
  }

  /* ---------- 連通與掉落 ---------- */
  function group(b, r0, c0) {
    const col = colorOf(get(b, r0, c0));
    const out = [[r0, c0]];
    const seen = new Set([key(r0, c0)]);
    for (let i = 0; i < out.length; i++) {
      for (const q of neighbors(b, out[i][0], out[i][1])) {
        const k = key(q[0], q[1]);
        if (seen.has(k)) continue;
        const v = get(b, q[0], q[1]);
        if (isBubble(v) && colorOf(v) === col) { seen.add(k); out.push(q); }
      }
    }
    return out;
  }
  /* 沒有連到天花板（第 0 列或雲朵磚）的泡泡 */
  function floating(b) {
    const anchored = new Set();
    const stack = [];
    for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) {
      const v = b.rows[r][c];
      if (v && (r === 0 || colorOf(v) === OBST)) { anchored.add(key(r, c)); stack.push([r, c]); }
    }
    while (stack.length) {
      const p = stack.pop();
      for (const q of neighbors(b, p[0], p[1])) {
        const k = key(q[0], q[1]);
        if (!anchored.has(k) && get(b, q[0], q[1])) { anchored.add(k); stack.push(q); }
      }
    }
    const out = [];
    for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) {
      if (isBubble(b.rows[r][c]) && !anchored.has(key(r, c))) out.push([r, c]);
    }
    return out;
  }

  /* ---------- 飛行追蹤（不改盤面） ---------- */
  function nearestEmpty(b, px, py) {
    const rp = Math.round((py - 1) / SQ3);
    let best = null, bd = 1e9;
    for (let r = Math.max(0, rp - 2); r <= Math.min(MAX_ROWS - 1, rp + 2); r++) {
      const len = rowLen(b, r);
      for (let c = 0; c < len; c++) {
        if (get(b, r, c)) continue;
        const dx = cx(b, r, c) - px, dy = cy(r) - py;
        const d = dx * dx + dy * dy;
        if (d >= bd) continue;
        /* 必須貼著天花板或貼著別的泡泡 */
        let ok = r === 0;
        if (!ok) for (const q of neighbors(b, r, c)) if (get(b, q[0], q[1])) { ok = true; break; }
        if (ok) { bd = d; best = [r, c]; }
      }
    }
    return best;
  }
  function shooterPos(b) { return { x: b.cols, y: cy(LINE_ROW + 1.5) }; }

  function trace(b, angle) {
    const a = clampAngle(angle);
    const s = shooterPos(b);
    let x = s.x, y = s.y, vx = DIRX[a] * STEP, vy = -DIRY[a] * STEP;
    const W = 2 * b.cols;
    const path = [{ x, y }];
    let land = null;
    for (let i = 0; i < 4000; i++) {
      x += vx; y += vy;
      if (x < 1) { x = 2 - x; vx = -vx; path.push({ x: 1, y }); }
      else if (x > W - 1) { x = 2 * (W - 1) - x; vx = -vx; path.push({ x: W - 1, y }); }
      if (y <= 1) { y = 1; land = nearestEmpty(b, x, y); break; }
      const rp = Math.round((y - 1) / SQ3);
      let hit = false;
      for (let r = Math.max(0, rp - 1); r <= rp + 1 && !hit; r++) {
        const row = b.rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (!row[c]) continue;
          const dx = cx(b, r, c) - x, dy = cy(r) - y;
          if (dx * dx + dy * dy < HIT_D * HIT_D) { hit = true; break; }
        }
      }
      if (hit) { land = nearestEmpty(b, x, y); break; }
    }
    if (!land) land = nearestEmpty(b, x, y) || [0, 0];
    const lx = cx(b, land[0], land[1]), ly = cy(land[0]);
    path.push({ x: lx, y: ly });
    return { path, land: { r: land[0], c: land[1] }, angle: a };
  }

  /* ---------- 消除結算 ---------- */
  /* 星星標記：被消除或掉落時，以星星泡泡為中心炸掉周圍幾圈（幼幼班、簡單 1 圈；普通、困難 2 圈；可連鎖）。
   * 圈數用六角格的「格距」算：1 圈 = 貼身 6 顆、2 圈 = 18 顆。 */
  function hexDist(b, r0, c0, r1, c1) {
    const dr = Math.abs(r1 - r0), dx = Math.abs(cx(b, r1, c1) - cx(b, r0, c0)) / 2;
    return dr + Math.max(0, dx - dr / 2);
  }
  function explodeStars(b, seeds, removed) {
    const R = (b.cfg && b.cfg.starR) || 1;
    const q = seeds.slice();
    while (q.length) {
      const p = q.pop();
      for (let r = Math.max(0, p[0] - R); r <= p[0] + R; r++) {
        const row = b.rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (r === p[0] && c === p[1]) continue;
          const v = row[c], k = key(r, c);
          if (!isBubble(v) || removed.has(k)) continue;
          if (hexDist(b, p[0], p[1], r, c) > R + 1e-6) continue;
          removed.set(k, { r, c, v, how: 'star' });
          if (modOf(v) === 1) q.push([r, c]);
        }
      }
    }
  }
  function weight(v) { return modOf(v) === 2 ? 3 : 1; }

  /** 雷射十字線上的所有泡泡：同一排全部＋每一排裡最靠近那條直線的泡泡（六角格會左右錯開半格，所以直的是一條之字線） */
  function laserLine(b, r, c) {
    const out = [], seen = new Set();
    const add = (rr, cc) => { const k = rr * 100 + cc; if (!seen.has(k)) { seen.add(k); out.push([rr, cc]); } };
    const row0 = b.rows[r] || [];
    for (let i = 0; i < row0.length; i++) if (isBubble(row0[i])) add(r, i);
    const x0 = cx(b, r, c);
    for (let rr = 0; rr < b.rows.length; rr++) {
      const row = b.rows[rr];
      if (!row) continue;
      let best = -1, bd = 1e9;
      for (let i = 0; i < row.length; i++) {
        const d = Math.abs(cx(b, rr, i) - x0);
        if (d < bd - 1e-9) { bd = d; best = i; }
      }
      if (best >= 0 && bd <= 1 + 1e-6 && isBubble(row[best])) add(rr, best);
    }
    return out;
  }

  /** 放下泡泡後的完整結算。回傳 { popped, dropped, gained } */
  function settle(b, popCells, how) {
    const removed = new Map();
    const starSeeds = [];
    for (const p of popCells) {
      const v = get(b, p[0], p[1]);
      if (!isBubble(v)) continue;
      removed.set(key(p[0], p[1]), { r: p[0], c: p[1], v, how: how || 'match' });
      if (modOf(v) === 1) starSeeds.push(p);
    }
    explodeStars(b, starSeeds, removed);
    const popped = Array.from(removed.values());
    for (const p of popped) set(b, p.r, p.c, 0);
    /* 掉落（掉落的星星也會再炸，所以迴圈到穩定） */
    const dropped = [];
    for (let guard = 0; guard < 12; guard++) {
      const fl = floating(b);
      if (!fl.length) break;
      const seeds = [];
      const map = new Map();
      for (const p of fl) {
        const v = get(b, p[0], p[1]);
        map.set(key(p[0], p[1]), { r: p[0], c: p[1], v, how: 'drop' });
        if (modOf(v) === 1) seeds.push(p);
      }
      explodeStars(b, seeds, map);
      for (const o of map.values()) { set(b, o.r, o.c, 0); dropped.push(o); }
    }
    let gained = 0;
    for (const o of popped) gained += weight(o.v);
    for (const o of dropped) gained += weight(o.v);
    return { popped, dropped, gained };
  }

  /* ---------- 天花板下降／泡泡雨／溢出 ---------- */
  function pushRow(b, filledCount, rng) {
    b.parity ^= 1;
    const len = b.cols - ((0 + b.parity) & 1);
    const row = new Array(len).fill(0);
    const present = presentColors(b);
    const pool = present.length ? present : b.colors;
    const slots = [];
    for (let i = 0; i < len; i++) slots.push(i);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = slots[i]; slots[i] = slots[j]; slots[j] = t; }
    const n = Math.min(len, filledCount);
    for (let i = 0; i < n; i++) row[slots[i]] = pool[Math.floor(rng() * pool.length)];
    b.rows.unshift(row);
    /* 超出最大列數的泡泡視為溢出，直接丟掉（正常情況泡泡雨早就先處理了） */
    while (b.rows.length > MAX_ROWS) b.rows.pop();
    return row.slice();
  }
  function rain(b) {
    const low = lowestRow(b);
    if (low < LINE_ROW) return null;
    const from = Math.max(0, low - (RAIN_ROWS - 1));
    const cells = [];
    for (let r = from; r <= low; r++) for (let c = 0; c < b.rows[r].length; c++) {
      if (b.rows[r][c]) { cells.push({ r, c, v: b.rows[r][c] }); b.rows[r][c] = 0; }
    }
    /* 沖掉之後，失去支撐的泡泡也會掉（不算分） */
    const fl = floating(b);
    const drops = fl.map(p => ({ r: p[0], c: p[1], v: get(b, p[0], p[1]) }));
    for (const p of fl) set(b, p[0], p[1], 0);
    b.rains++;
    b.protect = PROTECT_SHOTS;
    return { from, to: low, cells, drops };
  }
  function trimRows(b) {
    while (b.rows.length > 1 && b.rows[b.rows.length - 1].every(v => !v)) b.rows.pop();
  }

  /* ---------- 一發 ---------- */
  /** 發射目前的泡泡。回傳完整結果（動畫與結算都用它）；會修改 b。 */
  function applyShot(b, angle) {
    const item = b.cur;
    const tr = trace(b, angle);
    const res = {
      item, angle: tr.angle, path: tr.path, land: tr.land, popped: [], dropped: [], gained: 0,
      descended: null, rain: null, fullClear: false, combo: 0, rainbowColor: 0
    };
    const { r, c } = tr.land;
    ensureRow(b, r);
    let pop = [];
    if (item.k === 'n') {
      set(b, r, c, item.c);
      const g = group(b, r, c);
      if (g.length >= 3) pop = g;
    } else if (item.k === 'rainbow') {
      const count = {};
      for (const q of neighbors(b, r, c)) { const v = get(b, q[0], q[1]); if (isBubble(v)) count[colorOf(v)] = (count[colorOf(v)] || 0) + 1; }
      let best = 0, bn = 0;
      for (const k of Object.keys(count)) { if (count[k] > bn || (count[k] === bn && +k < best)) { best = +k; bn = count[k]; } }
      if (best) {
        set(b, r, c, best);
        pop = group(b, r, c);
        res.rainbowColor = best;
      } else {
        res.popped.push({ r, c, v: 0, how: 'fizzle' });   /* 附近沒有泡泡：彩虹泡泡自己消失 */
      }
    } else if (item.k === 'star') {
      set(b, r, c, 1 << 4 | 1);       /* 先放成帶星星標記的泡泡，再連同周圍一起炸 */
      pop = [[r, c]];
    }
    let popHow = 'match';
    if (item.k === 'laser') {
      /* 閃電泡泡：落下後同時消掉整排＋整列（十字，含自己） */
      set(b, r, c, 1);
      pop = laserLine(b, r, c);
      popHow = 'laser';
      res.laser = { r, c };
    }
    let st = { popped: [], dropped: [], gained: 0 };
    if (pop.length) st = settle(b, pop, popHow);
    res.popped = res.popped.concat(st.popped);
    res.dropped = st.dropped;
    res.gained = st.gained;
    b.cleared += st.gained;
    if (st.gained > 0) { b.hits++; b.dropN += st.dropped.length; if (st.gained > b.best) b.best = st.gained; }
    b.shots++;
    if (b.protect > 0) b.protect--;
    if (st.gained > 0) { b.combo++; b.miss = 0; if (b.combo > b.maxCombo) b.maxCombo = b.combo; }
    else { b.combo = 0; b.miss++; }
    res.combo = b.combo;
    /* 天花板下降（普通以上：連續沒消除就下降） */
    if (b.cfg.descend && b.miss >= b.cfg.descend && b.protect === 0) {
      const rng = mulberry32(hash2(b.seed, 5000 + b.descents));
      b.descents++; b.miss = 0;
      res.descended = pushRow(b, rowLen({ cols: b.cols, parity: b.parity ^ 1 }, 0), rng);
    }
    /* 發射序列前進 */
    b.cur = b.nxt;
    b.nxt = genItem(b, b.qIdx++);
    /* 盤面清光 */
    if (bubbleCount(b) === 0) { b.fullClear = true; res.fullClear = true; }
    else if (b.protect === 0) res.rain = rain(b);
    /* 只剩彩虹／星星之類的情況：發射序列要有盤面上存在的顏色 */
    trimRows(b);
    if (b.cur.k === 'n' && b.cur.c && presentColors(b).indexOf(b.cur.c) < 0 && presentColors(b).length) {
      const pc = presentColors(b);
      b.cur = { k: 'n', c: pc[hash2(b.queueSeed, b.qIdx) % pc.length] };
    }
    if (b.nxt.k === 'n' && presentColors(b).length && presentColors(b).indexOf(b.nxt.c) < 0) {
      const pc = presentColors(b);
      b.nxt = { k: 'n', c: pc[hash2(b.queueSeed, b.qIdx + 7) % pc.length] };
    }
    return res;
  }

  function swapItems(b) { const t = b.cur; b.cur = b.nxt; b.nxt = t; }

  /* ---------- 送來的泡泡（對打） ---------- */
  /** 在盤面頂端塞入 count 顆泡泡（滿列先入、最後一列不滿）。回傳 { rows:[…新列], rain } */
  function applyGarbage(b, count, gid) {
    const rng = mulberry32(hash2(b.seed, 70000 + (gid | 0)));
    const out = { rows: [], rain: null };
    let left = Math.max(0, count | 0);
    const rowsNeeded = Math.ceil(left / b.cols);
    for (let i = 0; i < rowsNeeded + 1 && left > 0; i++) {
      const lenNext = b.cols - ((b.parity ^ 1) & 1);
      const n = Math.min(lenNext, left);
      out.rows.push(pushRow(b, n, rng));
      left -= n;
    }
    b.garbageIn += count;
    out.rain = rain(b);
    trimRows(b);
    return out;
  }

  /** 一次清除 gained 顆時，要送給對手幾顆（依難度倍率） */
  function attackFor(gained, cols, mult) {
    let base = 0;
    if (gained >= 10) base = cols * 2;
    else if (gained >= 7) base = cols;
    else if (gained >= 5) base = Math.round(cols / 2);
    return Math.round(base * (mult == null ? 1 : mult));
  }

  /* ---------- 預覽（AI 與瞄準輔助：不改原盤面） ---------- */
  function preview(b, angle, swapFirst) {
    const c = cloneBoard(b);
    if (swapFirst) swapItems(c);
    return applyShot(c, angle);
  }

  /* ---------- 雜湊（對帳用） ---------- */
  function boardHash(b) {
    let h = hash2(b.cols, b.parity * 131 + b.shots);
    for (let r = 0; r < b.rows.length; r++) {
      const row = b.rows[r];
      for (let c = 0; c < row.length; c++) if (row[c]) h = hash2(h, r * 4096 + c * 64 + row[c]);
    }
    h = hash2(h, b.cur.c * 8 + (b.cur.k === 'n' ? 0 : b.cur.k === 'rainbow' ? 1 : b.cur.k === 'star' ? 2 : b.cur.k === 'laser' ? 3 : 4));
    h = hash2(h, b.nxt.c * 8 + (b.nxt.k === 'n' ? 0 : b.nxt.k === 'rainbow' ? 1 : b.nxt.k === 'star' ? 2 : b.nxt.k === 'laser' ? 3 : 4));
    return hash2(h, b.cleared);
  }

  /* ---------- 快照（斷線重連／不一致時整盤重送） ---------- */
  function snapshot(b) {
    return {
      level: b.level, cols: b.cols, parity: b.parity, rows: b.rows.map(r => r.slice()), colors: b.colors.slice(), seed: b.seed,
      queueSeed: b.queueSeed, shots: b.shots, miss: b.miss, cleared: b.cleared, combo: b.combo, maxCombo: b.maxCombo, hits: b.hits, best: b.best, dropN: b.dropN,
      descents: b.descents, rains: b.rains, protect: b.protect, fullClear: b.fullClear, layoutId: b.layoutId, layoutName: b.layoutName,
      garbageIn: b.garbageIn, garbageOut: b.garbageOut, cur: b.cur, nxt: b.nxt, qIdx: b.qIdx
    };
  }
  function fromSnapshot(s) {
    const b = Object.assign({}, s);
    b.cfg = DIFF[s.level] || DIFF.normal;
    b.rows = s.rows.map(r => r.slice());
    b.colors = s.colors.slice();
    b.cur = Object.assign({}, s.cur);
    b.nxt = Object.assign({}, s.nxt);
    return b;
  }

  const api = {
    SQ3, OBST, LINE_ROW, MAX_ROWS, MIN_A, MAX_A, STEP, LEVELS, LEVEL_NAME, DIFF,
    mulberry32, hash2, rand01, clampAngle,
    colorOf, modOf, isBubble, offOf, rowLen, cx, cy, get, neighbors, inBoard, shooterPos,
    cloneBoard, bubbleCount, lowestRow, presentColors,
    newBoard, trace, applyShot, swapItems, applyGarbage, attackFor, preview, boardHash, snapshot, fromSnapshot, group, floating, settle, laserLine, genItem
  };
  root.Rules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
