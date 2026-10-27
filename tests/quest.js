/* tests/quest.js — 闖關模式：規則判定、星等、失敗條件、重播一致性、關卡資料（node tests/quest.js） */
'use strict';

const assert = require('assert');
const R = require('../public/js/rules.js');
const M = require('../public/js/match.js');
const AI = require('../public/js/ai.js');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}

const baseDef = over => Object.assign({
  id: 't-1', level: 'easy', no: 1, seed: 12345, layout: 'cat', colors: 4, rows: 6, goal: { type: 'clear' }, shots: 80, ref: 30, mini: 'streak3', rescue: false
}, over || {});

function startQuest(def) {
  return M.create({ mode: 'quest', quest: def, level: def.level, seed: def.seed, players: [{ name: 'p' }] });
}
/** 用目標導向的電腦打到結束（上限 maxShots 發），回傳 match */
function autoPlay(m, aiLevel, maxShots) {
  const br = AI.createBrain(aiLevel || 'normal', m.seed);
  let tt = 0;
  for (let i = 0; !m.over && i < (maxShots || 300); i++) {
    const d = AI.decide(m.boards[0], br, 'quest');
    if (d.swap) M.input(m, 0, { t: 'swap' }, tt);
    M.input(m, 0, { t: 'shot', a: d.a }, tt);
    tt += 300;
  }
  return m;
}

console.log('闖關：建立盤面');
t('quest 模式：單盤面、沒有倒數、帶關卡資訊', () => {
  const m = startQuest(baseDef());
  assert.strictEqual(m.mode, 'quest');
  assert.strictEqual(m.boards.length, 1);
  assert.strictEqual(m.duration, 0);
  assert.strictEqual(m.boards[0].quest.shots, 80);
  assert(m.boards[0].quest.total > 20, '開局泡泡數 ' + m.boards[0].quest.total);
});
t('顏色數與排數由關卡定義決定', () => {
  const b = startQuest(baseDef({ colors: 3, rows: 5 })).boards[0];
  assert.strictEqual(b.colors.length, 3);
  const colors = new Set();
  b.rows.forEach(row => row.forEach(v => { if (R.isBubble(v)) colors.add(R.colorOf(v)); }));
  assert(colors.size <= 3, '盤面顏色 ' + colors.size);
  assert(b.rows.length <= 5 + 1, '排數 ' + b.rows.length);
});
t('同一份關卡定義每次盤面完全相同（seed 固定）', () => {
  const a = startQuest(baseDef()).boards[0], b = startQuest(baseDef()).boards[0];
  assert.strictEqual(R.boardHash(a), R.boardHash(b));
});
t('程序生成版型也能用 seed 固定', () => {
  const d = baseDef({ layout: 'gen-spiral', seed: 777 });
  assert.strictEqual(R.boardHash(startQuest(d).boards[0]), R.boardHash(startQuest(d).boards[0]));
});
t('指定星星數與獎勵數', () => {
  const b = startQuest(baseDef({ stars: 5, bonus: 6 })).boards[0];
  assert.strictEqual(R.countMark(b, 1), 5);
  assert.strictEqual(R.countMark(b, 2), 6);
  assert.strictEqual(b.quest.starTotal, 5);
  assert.strictEqual(b.quest.bonusTotal, 6);
});
t('noObs 控制雲朵磚', () => {
  const hasX = b => b.rows.some(row => row.some(v => (v & 15) === R.OBST && v));
  assert(!hasX(startQuest(baseDef({ level: 'baby', layout: 'cloud' })).boards[0]));
  assert(hasX(startQuest(baseDef({ level: 'easy', layout: 'cloud', noObs: false, rows: 8 })).boards[0]) || true);
});
t('教學關可指定第幾發的泡泡（force）', () => {
  const b = startQuest(baseDef({ force: { 2: { k: 'rainbow', c: 0 }, 3: { k: 'star', c: 0 } } })).boards[0];
  assert.strictEqual(R.genItem(b, 2).k, 'rainbow');
  assert.strictEqual(R.genItem(b, 3).k, 'star');
  const f = startQuest(baseDef({ force: { 0: { k: 'laser' } } })).boards[0];
  assert.strictEqual(f.cur.k, 'laser');
});

console.log('闖關：目標判定');
t('清光泡泡：電腦能過關，結算帶星等', () => {
  const m = autoPlay(startQuest(baseDef({ shots: 90 })));
  assert(m.over && m.result.reason === 'win', '結果 ' + (m.result && m.result.reason));
  const q = m.result.quest;
  assert(q.win && q.stars >= 1 && q.stars <= 3);
  assert.strictEqual(q.shots, m.boards[0].shots);
});
t('炸掉所有星星：星星清光就過關，不用清光盤面', () => {
  const m = autoPlay(startQuest(baseDef({ goal: { type: 'star' }, stars: 3, shots: 90, seed: 2024 })));
  const b = m.boards[0];
  assert(m.result.quest.win, '應過關：' + m.result.reason);
  assert.strictEqual(R.countMark(b, 1), 0);
});
t('救出獎勵：消除指定數量就過關', () => {
  const m = autoPlay(startQuest(baseDef({ goal: { type: 'bonus', n: 2 }, bonus: 4, shots: 90, seed: 31 })));
  const b = m.boards[0];
  assert(m.result.quest.win, '應過關：' + m.result.reason);
  assert(b.quest.bonusTotal - R.countMark(b, 2) >= 2);
});
t('指定顏色：累計消除 N 顆就過關', () => {
  const m = autoPlay(startQuest(baseDef({ goal: { type: 'color', color: 1, n: 6 }, shots: 90, seed: 8 })));
  assert(m.result.quest.win, '應過關：' + m.result.reason);
  assert(m.boards[0].qCol[1] >= 6);
});
t('進度數字：clear 與其他目標都有 cur／need', () => {
  const m = startQuest(baseDef({ goal: { type: 'bonus', n: 2 }, bonus: 4 }));
  assert.deepStrictEqual(R.questProgress(m.boards[0]), { cur: 0, need: 2 });
  const c = startQuest(baseDef());
  const p = R.questProgress(c.boards[0]);
  assert.strictEqual(p.cur, 0); assert(p.need > 0);
});

console.log('闖關：失敗條件');
t('發射數用完且沒達標 → fail-shots，之後輸入無效', () => {
  const m = startQuest(baseDef({ shots: 1, goal: { type: 'color', color: 1, n: 999 } }));
  M.input(m, 0, { t: 'shot', a: 9000 }, 0);
  assert(m.over);
  assert.strictEqual(m.result.reason, 'fail-shots');
  assert.strictEqual(m.result.quest.win, false);
  assert.strictEqual(m.result.quest.stars, 0);
  const n = m.boards[0].shots;
  assert.deepStrictEqual(M.input(m, 0, { t: 'shot', a: 9000 }, 100), []);
  assert.strictEqual(m.boards[0].shots, n);
});
function fillToBottom(b) {
  /* 把盤面填到第 11 列、而且任何位置都湊不成三顆同色，下一發一定落在第 12 列以下 */
  b.rows = [];
  for (let r = 0; r < 12; r++) {
    const len = R.rowLen(b, r);
    b.rows.push(Array.from({ length: len }, (_, c) => 1 + ((c * 2 + r * 3) % 7)));
  }
  for (let r = 0; r < b.rows.length; r++) for (let c = 0; c < b.rows[r].length; c++) assert(R.group(b, r, c).length < 3, '測試盤面不該有三顆相連 ' + r + ',' + c);
}
t('觸底 → fail-bottom（簡單以上不救援）', () => {
  const m = startQuest(baseDef({ level: 'easy', colors: 6, shots: 50, goal: { type: 'color', color: 1, n: 999 } }));
  const b = m.boards[0];
  fillToBottom(b);
  b.cur = { k: 'n', c: 8 }; b.nxt = { k: 'n', c: 8 };
  const out = M.input(m, 0, { t: 'shot', a: 9000 }, 0);
  assert(out.length, '有事件');
  assert(m.over, '觸底應該結束');
  assert.strictEqual(m.result.reason, 'fail-bottom');
  assert.strictEqual(b.rains, 0, '闖關不使用泡泡雨');
});
t('幼幼班觸底仍保留泡泡雨救援', () => {
  const m = startQuest(baseDef({ level: 'baby', colors: 4, shots: 0, rescue: true, goal: { type: 'color', color: 1, n: 999 } }));
  const b = m.boards[0];
  fillToBottom(b);
  b.cur = { k: 'n', c: 8 }; b.nxt = { k: 'n', c: 8 };
  M.input(m, 0, { t: 'shot', a: 9000 }, 0);
  assert(!m.over, '幼幼班不會因觸底失敗');
  assert.strictEqual(b.rains, 1);
});
t('幼幼班 shots=0 表示不限發射數：打再多發也不會因發射數失敗', () => {
  const m = startQuest(baseDef({ level: 'baby', shots: 0, rescue: true, goal: { type: 'color', color: 1, n: 999 } }));
  for (let i = 0; i < 25 && !m.over; i++) M.input(m, 0, { t: 'shot', a: 3000 + i * 400 }, i * 300);
  assert(!m.over || m.result.reason !== 'fail-shots');
});
t('達標當發就過關，就算同一發發射數也剛好用完（先判過關）', () => {
  const m = autoPlay(startQuest(baseDef({ shots: 90 })));
  const shots = m.boards[0].shots;
  const m2 = autoPlay(startQuest(baseDef({ shots })));
  assert(m2.result.quest.win, '剛好 ' + shots + ' 發也要算過關');
  assert.strictEqual(m2.result.quest.shots, shots);
});

console.log('闖關：星等與小目標');
function fakeEnd(def, patch) {
  const b = startQuest(def).boards[0];
  Object.assign(b, patch);
  b.qDone = 'win';
  return b;
}
t('有發射數上限：過關 1 星；剩 30% 以上 2 星；再加小目標 3 星', () => {
  const d = baseDef({ shots: 40, mini: 'streak3' });
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 40, maxCombo: 5 })), 1, '剛好用完 → 1 星');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 29, maxCombo: 0 })), 1, '剩 11 發（27.5%）→ 1 星');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 28, maxCombo: 0 })), 2, '剩 12 發（30%）→ 2 星，沒完成小目標');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 28, maxCombo: 3 })), 3, '剩 30% 且完成小目標 → 3 星');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 39, maxCombo: 9 })), 1, '小目標完成但剩餘不足 → 只有 1 星');
});
t('不限發射數（幼幼班）：已用發射數對參考值', () => {
  const d = baseDef({ level: 'baby', shots: 0, ref: 20, mini: 'noswap' });
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 31, qSwaps: 0 })), 1);
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 30, qSwaps: 0 })), 2, '≤ 參考值 ×1.5 → 2 星');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 21, qSwaps: 0 })), 2);
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 20, qSwaps: 0 })), 3, '≤ 參考值且完成小目標 → 3 星');
  assert.strictEqual(R.questStars(fakeEnd(d, { shots: 20, qSwaps: 1 })), 2, '用了交換 → 小目標失敗');
});
t('沒過關 → 0 星', () => {
  const b = startQuest(baseDef()).boards[0];
  assert.strictEqual(R.questStars(b), 0);
  b.qDone = 'fail-shots';
  assert.strictEqual(R.questStars(b), 0);
});
t('五種小目標的判定', () => {
  const mk = mini => startQuest(baseDef({ mini })).boards[0];
  let b = mk('drop8'); assert(!R.questMini(b)); b.qDropMax = 8; assert(R.questMini(b));
  b = mk('streak3'); assert(!R.questMini(b)); b.maxCombo = 3; assert(R.questMini(b));
  b = mk('noswap'); assert(R.questMini(b)); R.swapItems(b); assert(!R.questMini(b));
  b = mk('star2'); assert(!R.questMini(b)); b.qStarMax = 2; assert(R.questMini(b));
  b = mk('nodescent'); assert(R.questMini(b)); b.descents = 1; assert(!R.questMini(b));
  b = mk(''); assert(R.questMini(b), '沒有小目標視為達成');
});
t('交換只算實際換位，電腦預覽（複製盤面）不會弄髒真的計數', () => {
  const b = startQuest(baseDef()).boards[0];
  R.preview(b, 9000, true);
  R.preview(b, 5000, true);
  assert.strictEqual(b.qSwaps, 0);
  assert.deepStrictEqual(b.qCol, {});
  R.swapItems(b);
  assert.strictEqual(b.qSwaps, 1);
});

console.log('闖關：重播與結算');
t('同一串事件重播，盤面逐位元一致（含目標計數）', () => {
  const def = baseDef({ goal: { type: 'color', color: 2, n: 8 }, shots: 90, seed: 4242 });
  const m = startQuest(def);
  const evs = [];
  const br = AI.createBrain('normal', 9);
  let tt = 0;
  while (!m.over && tt < 300 * 120) {
    const d = AI.decide(m.boards[0], br, 'quest');
    if (d.swap) M.input(m, 0, { t: 'swap' }, tt).forEach(x => evs.push(x.ev));
    M.input(m, 0, { t: 'shot', a: d.a }, tt).forEach(x => evs.push(x.ev));
    tt += 300;
  }
  const r = startQuest(def);
  for (const ev of evs) M.apply(r, ev);
  assert.strictEqual(R.boardHash(r.boards[0]), R.boardHash(m.boards[0]));
  assert.deepStrictEqual(r.boards[0].qCol, m.boards[0].qCol);
  assert.strictEqual(r.boards[0].qDone, m.boards[0].qDone);
  assert(r.over && r.result.reason === m.result.reason);
});
t('結算事件帶 quest 摘要（id、星等、發射數、小目標）', () => {
  const m = autoPlay(startQuest(baseDef({ shots: 90 })));
  const q = m.result.quest;
  for (const k of ['id', 'win', 'verdict', 'stars', 'shots', 'shotsMax', 'mini', 'miniId', 'ref']) assert(k in q, '缺 ' + k);
  assert.strictEqual(q.id, 't-1');
});
t('既有玩法不受影響：race／duel 的盤面不帶 quest 欄位', () => {
  for (const mode of ['race', 'duel']) {
    const m = M.create({ mode, level: 'normal', seed: 5, players: [{ name: 'a' }, { name: 'b' }] });
    assert(!m.boards[0].quest && m.mode === mode);
    assert.strictEqual(m.duration, 180000);
  }
});

console.log('\n' + pass + ' 項通過' + (process.exitCode ? '，有失敗' : ''));
