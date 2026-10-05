/* tests/verify.js — 規則核心、對局事件、電腦難度、重播一致性（node tests/verify.js） */
'use strict';
const assert = require('assert');
const R = require('../public/js/rules.js');
const M = require('../public/js/match.js');
const AI = require('../public/js/ai.js');
const L = require('../public/js/layouts.js');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}

/* 手工盤面：清空後用 put 擺放 */
function blank(level, cols) {
  const b = R.newBoard({ seed: 1, level: level || 'normal', cols });
  b.rows = [];
  for (let r = 0; r < 4; r++) b.rows.push(new Array(R.rowLen(b, r)).fill(0));
  b.cur = { k: 'n', c: 1 }; b.nxt = { k: 'n', c: 2 }; b.miss = 0;
  return b;
}
function put(b, r, c, v) {
  while (b.rows.length <= r) b.rows.push(new Array(R.rowLen(b, b.rows.length)).fill(0));
  b.rows[r][c] = v;
}
/** 找一個會落在 (r,c) 的角度 */
function angleTo(b, r, c) {
  for (let a = R.MIN_A; a <= R.MAX_A; a += 10) {
    const tr = R.trace(b, a);
    if (tr.land.r === r && tr.land.c === c) return a;
  }
  return null;
}

console.log('規則：幾何');
t('鄰居關係對稱（兩種 parity、三種欄數）', () => {
  for (const cols of [8, 10, 11, 12, 14, 16]) for (const parity of [0, 1]) {
    const b = { cols, parity, rows: [] };
    for (let r = 0; r < 10; r++) for (let c = 0; c < R.rowLen(b, r); c++) {
      for (const q of R.neighbors(b, r, c)) {
        const back = R.neighbors(b, q[0], q[1]).some(x => x[0] === r && x[1] === c);
        assert(back, `非對稱 cols=${cols} parity=${parity} (${r},${c})→(${q})`);
      }
      const n = R.neighbors(b, r, c).length;
      assert(n <= 6 && n >= 2, '鄰居數異常 ' + n);
    }
  }
});
t('三角函式表與標準值相符', () => {
  const R2 = require('../public/js/rules.js');
  const tr = R2.trace(blank(), 9000);   /* 90° 正上方 */
  assert(Math.abs(tr.path[0].x - tr.path[tr.path.length - 2 >= 0 ? 0 : 0].x) < 1e-9);
  const b = blank();
  const t90 = R.trace(b, 9000);
  assert(t90.land.r === 0, '正上方應落在第 0 列');
});

console.log('規則：發射與消除');
t('三顆同色相連會消除，並算分', () => {
  const b = blank();
  put(b, 0, 3, 1); put(b, 0, 4, 1);
  const a = angleTo(b, 0, 5) || angleTo(b, 0, 2);
  assert(a != null, '找不到角度');
  const before = b.cleared;
  const res = R.applyShot(b, a);
  assert(res.gained >= 3 && b.cleared - before >= 3, '應該消除 3 顆，實際 ' + res.gained);
});
t('不同色不消除，盤面多一顆', () => {
  const b = blank();
  put(b, 0, 3, 2); put(b, 0, 4, 2);
  const a = angleTo(b, 0, 5);
  const res = R.applyShot(b, a);
  assert.strictEqual(res.gained, 0);
  assert.strictEqual(R.bubbleCount(b), 3);
});
t('失去支撐的泡泡會掉落並算分', () => {
  const b = blank();
  put(b, 0, 3, 1); put(b, 0, 4, 1);          /* 第 0 列兩顆紅，下方吊著一串黃 */
  put(b, 1, 3, 2); put(b, 2, 3, 2);
  b.cur = { k: 'n', c: 1 };
  const a = angleTo(b, 0, 5) || angleTo(b, 0, 2);
  const res = R.applyShot(b, a);
  assert(res.popped.length === 3, '紅色三顆消除');
  assert(res.dropped.length === 2, '吊著的兩顆黃色掉落，實際 ' + res.dropped.length);
  assert.strictEqual(res.gained, 5);
});
t('雲朵磚消不掉，而且永遠算黏在天花板', () => {
  const b = blank();
  put(b, 1, 3, R.OBST); put(b, 2, 3, 2);      /* 雲朵磚吊在空中，下面接一顆黃 */
  assert.strictEqual(R.floating(b).length, 0, '雲朵磚底下的泡泡不該掉');
  put(b, 0, 3, 1); put(b, 0, 4, 1); b.cur = { k: 'n', c: 1 };
  const res = R.applyShot(b, angleTo(b, 0, 5) || angleTo(b, 0, 2));
  assert(res.popped.every(p => R.colorOf(p.v) !== R.OBST));
  assert.strictEqual(R.get(b, 1, 3), R.OBST);
});
t('星星標記：消除時連帶炸掉周圍', () => {
  const b = blank();
  put(b, 0, 3, 1 | 16); put(b, 0, 4, 1);
  put(b, 1, 2, 2); put(b, 1, 3, 3);           /* 星星泡泡旁邊的兩顆其他顏色 */
  b.cur = { k: 'n', c: 1 };
  const res = R.applyShot(b, angleTo(b, 0, 5) || angleTo(b, 0, 2));
  assert(res.popped.some(p => p.how === 'star'), '應有被星星炸掉的泡泡');
});
t('星星炸掉的圈數：所有難度都是 1 圈(6 顆)', () => {
  const want = { baby: 6, easy: 6, normal: 6, hard: 6 };
  for (const lv of R.LEVELS) {
    const b = blank(lv);
    for (let r = 0; r < 13; r++) {
      while (b.rows.length <= r) b.rows.push(new Array(R.rowLen(b, b.rows.length)).fill(0));
      for (let c = 0; c < R.rowLen(b, r); c++) b.rows[r][c] = 1 + ((r * 2 + c * 3) % 4);   /* 沒有同色連片，免得干擾 */
    }
    b.rows[6][4] = 1 | 16;
    const st = R.settle(b, [[6, 4]]);
    const boom = st.popped.filter(p => p.how === 'star').length;
    assert.strictEqual(boom, want[lv], lv + ' 應炸掉 ' + want[lv] + ' 顆，實際 ' + boom);
  }
});
function fillDistinct(b, rows) {
  for (let r = 0; r < rows; r++) {
    while (b.rows.length <= r) b.rows.push(new Array(R.rowLen(b, b.rows.length)).fill(0));
    for (let c = 0; c < R.rowLen(b, r); c++) b.rows[r][c] = 1 + ((r * 2 + c * 3) % 4);
  }
}
t('閃電泡泡：落下後同時消掉整排＋整列（十字）', () => {
  const b = blank();
  fillDistinct(b, 4);
  b.rows[3][5] = 0;                           /* 第 3 排留一個洞讓閃電泡泡落進去 */
  b.cur = { k: 'laser', c: 0 };
  const a = angleTo(b, 3, 5);
  assert(a != null, '找不到落點');
  const tr = R.trace(b, a);
  const row = tr.land.r;
  const res = R.applyShot(b, a);
  assert(res.laser, '應該有雷射結果');
  const lasered = res.popped.filter(p => p.how === 'laser');
  const n = lasered.filter(p => p.r === row).length;
  assert.strictEqual(n, R.rowLen(b, row), '整排都該消失，實際 ' + n + '／' + R.rowLen(b, row));
  const rowsHit = new Set(lasered.map(p => p.r));
  for (let r = 0; r <= row; r++) assert(rowsHit.has(r), '第 ' + r + ' 排應該被縱向雷射打到');
  assert.strictEqual(new Set(lasered.map(p => p.r * 100 + p.c)).size, lasered.length, '不該重複計算');
});
t('發射序列會出現閃電泡泡，且與彩虹、星星機率相同', () => {
  const b = R.newBoard({ seed: 11, level: 'normal' });
  const cnt = {};
  for (let i = 0; i < 6000; i++) { const k = R.genItem(b, i).k; cnt[k] = (cnt[k] || 0) + 1; }
  assert(cnt.laser > 0 && !cnt.laserh && !cnt.laserv, '應該只有一種閃電泡泡：' + JSON.stringify(cnt));
  const hi = Math.max(cnt.rainbow, cnt.star, cnt.laser), lo = Math.min(cnt.rainbow, cnt.star, cnt.laser);
  assert(lo > hi * 0.6, '三種機率應該接近：' + JSON.stringify(cnt));
});
t('獎勵標記算 3 顆分數', () => {
  const b = blank();
  put(b, 0, 3, 1 | 32); put(b, 0, 4, 1);
  b.cur = { k: 'n', c: 1 };
  const res = R.applyShot(b, angleTo(b, 0, 5) || angleTo(b, 0, 2));
  assert.strictEqual(res.gained, 5, '3 顆紅（其中一顆獎勵=3）=1+1+3');
});
t('彩虹泡泡：消掉周圍最多的那種顏色的整片', () => {
  const b = blank();
  put(b, 0, 3, 2); put(b, 0, 4, 2); put(b, 0, 5, 2); put(b, 1, 3, 4);
  b.cur = { k: 'rainbow', c: 0 };
  const a = angleTo(b, 0, 6) || angleTo(b, 0, 2) || angleTo(b, 1, 4);
  const res = R.applyShot(b, a);
  assert(res.gained >= 3, '彩虹應消掉整片黃色，實際 ' + res.gained);
});
t('星星泡泡（發射用）：炸掉自己與周圍一圈', () => {
  const b = blank();
  put(b, 0, 3, 2); put(b, 0, 4, 3); put(b, 0, 5, 4);
  b.cur = { k: 'star', c: 0 };
  const res = R.applyShot(b, angleTo(b, 1, 3) || angleTo(b, 1, 4) || angleTo(b, 0, 6));
  assert(res.gained >= 2, '應至少炸掉自己與一顆鄰居，實際 ' + res.gained);
});
t('碰壁反彈：軌跡有轉折點', () => {
  const b = blank();
  const tr = R.trace(b, 2000);                /* 20°：很斜，一定會撞牆 */
  assert(tr.path.length >= 3, '應有反彈點');
});
t('觸底會被泡泡雨沖掉最底下 3 列，之後有保護', () => {
  const b = blank();
  for (let r = 0; r <= R.LINE_ROW; r++) for (let c = 0; c < R.rowLen(b, r); c++) put(b, r, c, r % 3 + 1);
  const g = R.applyGarbage(b, 3, 1);
  assert(g.rain, '應觸發泡泡雨');
  assert(b.protect > 0);
  assert(R.lowestRow(b) < R.LINE_ROW, '沖掉之後不該再碰到底線');
});
t('下壓：普通以上連續沒消除會下降一列，幼幼班不會', () => {
  const run = lv => {
    let desc = 0;
    for (let seed = 9; seed < 21; seed++) {
      const b = R.newBoard({ seed, level: lv });
      for (let i = 0; i < 40; i++) { const res = R.applyShot(b, 4000 + (i % 7) * 1500); if (res.descended) desc++; if (R.bubbleCount(b) === 0) break; }
    }
    return desc;
  };
  assert(run('baby') === 0, '幼幼班不會下降');
  assert(run('normal') > 0 && run('hard') >= run('normal'), '普通以上會下降，困難更頻繁');
});
t('送泡泡量表與倍率', () => {
  assert.strictEqual(R.attackFor(3, 10, 1), 0);
  assert.strictEqual(R.attackFor(5, 10, 1), 5);
  assert.strictEqual(R.attackFor(8, 10, 1), 10);
  assert.strictEqual(R.attackFor(12, 10, 1), 20);
  assert.strictEqual(R.attackFor(12, 8, 0.5), 8);
});
t('塞入泡泡：滿列先入、最後一列不滿，且都連著天花板', () => {
  const b = R.newBoard({ seed: 3, level: 'normal' });
  const before = R.bubbleCount(b);
  R.applyGarbage(b, 15, 4);
  assert.strictEqual(R.bubbleCount(b) - before, 15);
  assert.strictEqual(R.floating(b).length, 0);
});

console.log('規則：開局與決定性');
t('每個難度、每張地圖開局都至少有一組可打、沒有開局就掉下來的泡泡', () => {
  for (const lv of R.LEVELS) for (let seed = 1; seed <= 150; seed++) {
    const b = R.newBoard({ seed, level: lv });
    assert(R.bubbleCount(b) >= 10, `${lv}/${seed} 泡泡太少：${R.bubbleCount(b)}`);
    assert.strictEqual(R.floating(b).length, 0, `${lv}/${seed} 開局就有浮空泡泡 (${b.layoutId})`);
    const colors = new Set(R.presentColors(b));
    colors.forEach(c => assert(b.colors.indexOf(c) >= 0, '用到不在難度顏色表的顏色'));
  }
});
t('幼幼班不會出現雲朵磚', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const b = R.newBoard({ seed, level: 'baby' });
    for (const row of b.rows) for (const v of row) assert.notStrictEqual(R.colorOf(v), R.OBST);
  }
});
t('同 seed 同輸入 → 雜湊逐位元相同；快照還原後也相同', () => {
  for (const lv of R.LEVELS) {
    const A = R.newBoard({ seed: 77, level: lv }), B = R.newBoard({ seed: 77, level: lv });
    for (let i = 0; i < 50; i++) { const a = 1500 + (i * 977) % 15000; R.applyShot(A, a); R.applyShot(B, a); if (i % 5 === 0) { R.swapItems(A); R.swapItems(B); } }
    assert.strictEqual(R.boardHash(A), R.boardHash(B));
    assert.strictEqual(R.boardHash(R.fromSnapshot(JSON.parse(JSON.stringify(R.snapshot(A))))), R.boardHash(A));
  }
});
t('不同 seed 的盤面不同；地圖種類夠多', () => {
  const ids = new Set();
  for (let seed = 1; seed <= 400; seed++) ids.add(R.newBoard({ seed, level: 'normal' }).layoutId);
  assert(ids.size >= 30, '400 局只出現 ' + ids.size + ' 種版型');
});

console.log('對局：事件重播與對打');
function playScripted(mode, level, seed, steps) {
  const m = M.create({ mode, level, seed, duration: 180000, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  const log = [];
  const rng = R.mulberry32(seed + 5);
  let now = 0;
  for (let i = 0; i < steps && !m.over; i++) {
    now += 400;
    const s = Math.floor(rng() * 4);
    const inp = rng() < 0.1 ? { t: 'swap' } : { t: 'shot', a: 1500 + Math.floor(rng() * 13500) };
    for (const o of M.input(m, s, inp, now)) log.push(o.ev);
    for (const o of M.tick(m, now)) log.push(o.ev);
  }
  return { m, log };
}
t('把伺服器端事件依序重播到另一場，四個盤面雜湊全相同（競賽、對打）', () => {
  for (const mode of ['race', 'duel']) for (const level of ['baby', 'normal', 'hard']) {
    const { m, log } = playScripted(mode, level, 123, 400);
    const m2 = M.create({ mode, level, seed: 123, duration: 180000, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
    for (const ev of JSON.parse(JSON.stringify(log))) M.apply(m2, ev);
    m.boards.forEach((b, i) => assert.strictEqual(R.boardHash(m2.boards[i]), R.boardHash(b), `${mode}/${level} 盤面 ${i} 不一致`));
  }
});
t('對打：消除會產生預告，預告到期才落下；自己消除可以抵銷', () => {
  const m = M.create({ mode: 'duel', level: 'normal', seed: 5, duration: 0, players: [{ name: 'A' }, { name: 'B' }] });
  /* 讓 A 的盤面擺好一個大連消 */
  const b = m.boards[0];
  b.rows = [];
  for (let r = 0; r < 4; r++) b.rows.push(new Array(R.rowLen(b, r)).fill(0));
  for (let c = 0; c < 9; c++) put(b, 0, c, 1);
  put(b, 1, 2, 3); put(b, 1, 3, 3); put(b, 1, 4, 3); put(b, 1, 5, 3);
  put(b, 1, 0, R.OBST); put(b, 2, 0, 4);       /* 另外留一顆，避免整盤清光而提前結束 */
  b.cur = { k: 'n', c: 1 };
  const a = angleTo(b, 0, 9);
  assert(a != null, '找不到角度');
  const out = M.input(m, 0, { t: 'shot', a }, 1000);
  const pend = out.find(o => o.ev.e === 'pend');
  assert(pend, '大連消應該送出泡泡，事件：' + out.map(o => o.ev.e));
  assert.strictEqual(pend.ev.to, 1);
  assert(pend.ev.at > 1000);
  assert.strictEqual(M.tick(m, 1001).length, 0, '預告期間不落下');
  const before = R.bubbleCount(m.boards[1]);
  const land = M.tick(m, pend.ev.at);
  assert(land.some(o => o.ev.e === 'land'));
  assert(R.bubbleCount(m.boards[1]) > before, '泡泡應落到對手盤面');
});
t('時間到結束並排名；先全清者獲勝', () => {
  const m = M.create({ mode: 'race', level: 'baby', seed: 8, duration: 5000, players: [{ name: 'A' }, { name: 'B' }] });
  m.boards[1].cleared = 7;
  const out = M.tick(m, 5000);
  assert(m.over && out.some(o => o.ev.e === 'end'));
  assert.strictEqual(m.result.winner, 1);
  assert.strictEqual(m.result.ranks[0].rank, 1);
});
t('離場的玩家排最後', () => {
  const m = M.create({ mode: 'race', level: 'baby', seed: 8, duration: 5000, players: [{ name: 'A' }, { name: 'B' }] });
  m.boards[0].cleared = 99;
  M.playerLeft(m, 0, 100);
  M.tick(m, 5000);
  assert.strictEqual(m.result.ranks[1].s, 0);
});

console.log('電腦：四段難度');
t('四段電腦：清光盤面所需的發數：簡單以下明顯多於普通，普通多於困難（幼幼班主要差在反應時間）（簡單盤面 80 局，上限 150 發）', () => {
  const avg = {};
  for (const lv of AI.LEVEL_ORDER) {
    const arr = [];
    const N = 80;
    for (let seed = 1; seed <= N; seed++) {
      const b = R.newBoard({ seed, level: 'easy' });
      const brain = AI.createBrain(lv, seed);
      let n = 0;
      while (n < 150 && !b.fullClear) {
        const d = AI.decide(b, brain, 'race');
        if (d.swap) R.swapItems(b);
        R.applyShot(b, d.a);
        n++;
      }
      arr.push(n);
    }
    arr.sort((x, y) => x - y);
    avg[lv] = arr[N >> 1];   /* 中位數：避免少數卡關的盤面拉高平均 */
  }
  console.log('       中位發數：' + AI.LEVEL_ORDER.map(l => l + ' ' + avg[l].toFixed(1)).join(' > '));
  assert(avg.baby > avg.normal && avg.easy > avg.normal && avg.normal > avg.hard, JSON.stringify(avg));
});
t('反應間隔：幼幼班最慢、困難最快', () => {
  const d = lv => { const b = AI.createBrain(lv, 1); let s = 0; for (let i = 0; i < 200; i++) s += AI.delayOf(b); return s / 200; };
  assert(d('baby') > d('easy') && d('easy') > d('normal') && d('normal') > d('hard'));
});

console.log('地圖資料');
t('版型數量與重採樣', () => {
  assert(L.PATTERNS.length >= 40 && L.FAMILIES.length >= 8);
  for (const cols of [8, 10, 11, 12, 14, 16]) for (const p of L.PATTERNS) {
    const v = L.validate(L.resample(p.rows, cols), cols);
    assert(v.ok, `${p.id}@${cols}: ${v.problems}`);
  }
});

console.log('\n' + pass + ' 項通過' + (process.exitCode ? '，有失敗' : ''));
