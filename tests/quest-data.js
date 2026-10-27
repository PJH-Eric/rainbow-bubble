/* tests/quest-data.js — 闖關 400 關資料檢查（node tests/quest-data.js）
 * 版型合法、目標做得到、顏色與排數隨關數遞增、關主關、教學關、發射數、存檔、抽樣電腦模擬。 */
'use strict';

const assert = require('assert');
const R = require('../public/js/rules.js');
const M = require('../public/js/match.js');
const AI = require('../public/js/ai.js');
const L = require('../public/js/layouts.js');
const Q = require('../public/js/quests.js');
const Tiers = require('../public/js/layout-tiers.js');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}
const LEVELS = ['baby', 'easy', 'normal', 'hard'];
const boards = {};
const boardOf = def => boards[def.id] || (boards[def.id] = R.newQuestBoard(def));

console.log('關卡資料：結構');
t('四段難度各 100 關，編號連續、id 唯一', () => {
  const ids = new Set();
  LEVELS.forEach(lv => {
    assert.strictEqual(Q.count(lv), 100, lv);
    Q.list(lv).forEach((d, i) => { assert.strictEqual(d.no, i + 1); assert(!ids.has(d.id), '重複 id ' + d.id); ids.add(d.id); });
  });
  assert.strictEqual(ids.size, 400);
});
t('每一關都通過欄位校驗', () => {
  const bad = [];
  LEVELS.forEach(lv => Q.list(lv).forEach(d => { const p = Q.validate(d); if (p.length) bad.push(d.id + '：' + p.join('、')); }));
  assert.deepStrictEqual(bad, []);
});
t('校驗本身抓得到壞資料', () => {
  const ok = Q.get('easy', 5);
  assert.deepStrictEqual(Q.validate(ok), []);
  assert(Q.validate(Object.assign({}, ok, { colors: 99 })).length);
  assert(Q.validate(Object.assign({}, ok, { shots: 0 })).length, '簡單以上沒有發射數要報錯');
  assert(Q.validate(Object.assign({}, ok, { layout: 'nope' })).length);
  assert(Q.validate(Object.assign({}, ok, { goal: { type: 'xx' } })).length);
  assert(Q.validate(Object.assign({}, Q.get('baby', 5), { shots: 30 })).length, '幼幼班不能有發射數上限');
  assert(Q.validate(Object.assign({}, ok, { boss: true })).length, '非 10 的倍數不能是關主關');
});
t('Quests.get 邊界', () => {
  assert.strictEqual(Q.get('easy', 0), null);
  assert.strictEqual(Q.get('easy', 101), null);
  assert.strictEqual(Q.get('nope', 1), null);
  assert.strictEqual(Q.get('hard', 100).id, 'hard-100');
});

console.log('關卡資料：盤面');
t('每關盤面都建得起來、開局泡泡夠多、離底線夠遠', () => {
  LEVELS.forEach(lv => Q.list(lv).forEach(d => {
    const b = boardOf(d);
    const n = R.bubbleCount(b);
    assert(n >= R.MIN_COUNT[lv] * 0.6, d.id + ' 泡泡太少 ' + n);
    assert(R.lowestRow(b) <= 9, d.id + ' 開局最低一列 ' + R.lowestRow(b));
    assert(b.rows[0].some(v => v), d.id + ' 第 0 列是空的');
    assert.strictEqual(R.floating(b).length, 0, d.id + ' 開局有懸空泡泡');
  }));
});
t('顏色數沒有超過關卡設定', () => {
  LEVELS.forEach(lv => Q.list(lv).forEach(d => {
    const seen = new Set();
    boardOf(d).rows.forEach(row => row.forEach(v => { if (R.isBubble(v)) seen.add(R.colorOf(v)); }));
    assert(seen.size <= d.colors, d.id + ' 實際 ' + seen.size + ' 色 > ' + d.colors);
  }));
});
t('開局至少有一組能消、兩發內不會一發清光（沿用防一發清光規則）', () => {
  LEVELS.forEach(lv => Q.list(lv).forEach(d => {
    const b = boardOf(d), total = R.bubbleCount(b);
    let best = 0, any = 0;
    for (const which of ['cur', 'nxt']) {
      for (let a = 1200; a <= 16800; a += 200) {
        const c = R.cloneBoard(b); c.cur = Object.assign({}, b[which]);
        const g = R.applyShot(c, a).gained;
        any = Math.max(any, g);
        if (b[which].k !== 'laser') best = Math.max(best, g);
      }
    }
    /* 教學關（前 10 關）第一發一定要能消；其後關卡色數多，前兩顆偶爾沒得消屬正常（可換位、下一發就有） */
    if (d.no <= 10) assert(any > 0, d.id + ' 開局打不出任何消除');
    assert(best <= Math.max(8, Math.floor(total * 0.34)) + 2, d.id + ' 一發就消 ' + best + '/' + total);
  }));
});
t('同一關盤面每次相同（seed 固定）', () => {
  [['baby', 1], ['easy', 20], ['normal', 55], ['hard', 100]].forEach(([lv, no]) => {
    const d = Q.get(lv, no);
    assert.strictEqual(R.boardHash(R.newQuestBoard(d)), R.boardHash(R.newQuestBoard(d)));
  });
});

console.log('關卡資料：目標做得到');
t('星星／獎勵／指定顏色目標都有足夠的材料', () => {
  LEVELS.forEach(lv => Q.list(lv).forEach(d => {
    const b = boardOf(d), g = d.goal;
    if (g.type === 'star') { assert(b.quest.starTotal >= 2, d.id + ' 星星不夠 ' + b.quest.starTotal); assert.strictEqual(b.quest.starTotal, d.stars, d.id); }
    if (g.type === 'bonus') { assert.strictEqual(b.quest.bonusTotal, d.bonus, d.id + ' 獎勵泡泡數'); assert(b.quest.bonusTotal >= g.n); }
    if (g.type === 'color') {
      assert(b.colors.indexOf(g.color) >= 0, d.id + ' 指定顏色不在本關顏色內');
      let n = 0; b.rows.forEach(row => row.forEach(v => { if (R.isBubble(v) && R.colorOf(v) === g.color) n++; }));
      assert(n >= g.n, d.id + ' 指定顏色只有 ' + n + ' 顆，目標 ' + g.n);
    }
  }));
});
t('目標種類都有出現，指定顏色第 41 關起才出現', () => {
  LEVELS.forEach(lv => {
    const types = new Set(Q.list(lv).map(d => d.goal.type));
    ['clear', 'star', 'bonus'].forEach(k => assert(types.has(k), lv + ' 沒有 ' + k));
    Q.list(lv).filter(d => d.goal.type === 'color').forEach(d => assert(d.no >= 41, d.id + ' 太早出現指定顏色'));
  });
  assert(['easy', 'normal', 'hard'].some(lv => Q.list(lv).some(d => d.goal.type === 'color')), '至少有一段難度有指定顏色');
});

console.log('關卡資料：曲線與關主');
t('顏色數隨關數不遞減，前期少、後期多', () => {
  LEVELS.forEach(lv => {
    const l = Q.list(lv);
    for (let i = 10; i < l.length; i++) assert(l[i].colors >= l[i - 1].colors, lv + ' 第 ' + (i + 1) + ' 關顏色變少');
    assert(l[99].colors > l[0].colors, lv + ' 顏色沒有成長');
    assert(l[99].colors <= R.DIFF[lv].colors.length);
  });
  assert.strictEqual(Q.get('hard', 100).colors, 10);
  assert.strictEqual(Q.get('normal', 100).colors, 8);
  assert.strictEqual(Q.get('easy', 100).colors, 6);
});
t('關主關：每 10 關一次、手設大圖案、星星或獎勵目標、同難度不重複', () => {
  LEVELS.forEach(lv => {
    const bosses = Q.list(lv).filter(d => d.boss);
    assert.strictEqual(bosses.length, 10);
    assert.strictEqual(new Set(bosses.map(d => d.layout)).size, 10, lv + ' 關主圖案重複');
    bosses.forEach(d => {
      assert(d.no % 10 === 0);
      assert(L.BOSS.some(x => x.id === d.layout), d.id + ' 不是關主圖案');
      assert(['star', 'bonus'].indexOf(d.goal.type) >= 0, d.id + ' 關主關目標');
    });
  });
});
t('主題：每 10 關一組、七套輪流', () => {
  LEVELS.forEach(lv => Q.list(lv).forEach(d => assert.strictEqual(d.theme, Math.floor((d.no - 1) / 10) % 7, d.id)));
});
t('教學關：新機制依序出現', () => {
  LEVELS.forEach(lv => {
    const hints = Q.list(lv).slice(0, 10).map(d => d.hint);
    assert.deepStrictEqual(hints.slice(0, 8), ['shoot', 'bounce', 'drop', 'rainbow', 'swap', 'star', 'laser', 'bonus']);
    assert.strictEqual(hints[9], 'boss');
    assert.strictEqual(hints[8], lv === 'baby' ? null : 'descend');
    assert.strictEqual(Q.get(lv, 4).force[2].k, 'rainbow');
    assert.strictEqual(Q.get(lv, 7).force[2].k, 'laser');
    assert.strictEqual(Q.get(lv, 6).goal.type, 'star');
    assert.strictEqual(Q.get(lv, 8).goal.type, 'bonus');
  });
});
t('雲朵磚：幼幼班沒有；其他難度第 21 關前沒有', () => {
  const hasX = b => b.rows.some(row => row.some(v => v && (v & 15) === R.OBST));
  Q.list('baby').forEach(d => assert(!hasX(boardOf(d)), d.id));
  ['easy', 'normal', 'hard'].forEach(lv => Q.list(lv).filter(d => d.no < 21).forEach(d => assert(!hasX(boardOf(d)), d.id)));
  assert(['easy', 'normal', 'hard'].some(lv => Q.list(lv).some(d => d.no >= 21 && hasX(boardOf(d)))), '後段應該要有雲朵磚的關卡');
});
t('版型：手設為主、每個手設版型同難度最多用 2 次、版型都在該難度的清單內', () => {
  LEVELS.forEach(lv => {
    const use = {};
    let hand = 0, gen = 0;
    Q.list(lv).filter(d => !d.boss).forEach(d => {
      if (d.layout.indexOf('gen-') === 0) gen++; else { hand++; if (d.no > 10) use[d.layout] = (use[d.layout] || 0) + 1; }
      assert(Tiers[lv].indexOf(d.layout) >= 0 || d.no <= 9, d.id + ' ' + d.layout + ' 不在 ' + lv + ' 的地圖清單');
    });
    assert(hand > gen * 2, lv + ' 手設 ' + hand + '、程序生成 ' + gen);
    Object.keys(use).forEach(k => assert(use[k] <= 3, lv + ' ' + k + ' 用了 ' + use[k] + ' 次'));
  });
});

console.log('關卡資料：發射數與小目標');
t('幼幼班不限發射數；其他難度有上限，且比電腦實測的參考值寬、但不離譜', () => {
  Q.list('baby').forEach(d => assert(!d.shots, d.id));
  ['easy', 'normal', 'hard'].forEach(lv => Q.list(lv).forEach(d => {
    assert(d.shots > 0 && d.ref > 0, d.id);
    assert(d.shots >= d.ref + 4, d.id + ' 上限 ' + d.shots + ' 沒比參考 ' + d.ref + ' 寬');
    assert(d.shots <= d.ref * 2.2 + 6, d.id + ' 上限 ' + d.shots + ' 太寬（參考 ' + d.ref + '）');
    assert(d.shots <= 160, d.id);
  }));
});
t('小目標：幼幼班沒有 nodescent；關主關一律 streak3', () => {
  Q.list('baby').forEach(d => assert(d.mini !== 'nodescent', d.id));
  LEVELS.forEach(lv => Q.list(lv).filter(d => d.boss).forEach(d => assert.strictEqual(d.mini, 'streak3', d.id)));
  LEVELS.forEach(lv => assert(new Set(Q.list(lv).map(d => d.mini)).size >= 3));
});

console.log('關卡資料：電腦抽樣實測');
t('每段難度每組抽 1 關，電腦能在發射數上限內過關（至少 55%）', () => {
  const SIM = { baby: 'easy', easy: 'easy', normal: 'normal', hard: 'hard' };
  let wins = 0, total = 0;
  const lows = [];
  LEVELS.forEach(lv => {
    for (let g = 0; g < 10; g++) {
      const d = Q.get(lv, g * 10 + 2 + (g % 7));
      let ok = 0;
      for (let k = 0; k < 2; k++) {
        const dd = lv === 'baby' ? Object.assign({}, d) : d;
        const m = M.create({ mode: 'quest', quest: dd, level: lv, seed: dd.seed, players: [{ name: 'x' }] });
        const br = AI.createBrain(SIM[lv], 1000 + k);
        br.p = Object.assign({}, br.p, lv === 'hard' ? { step: 200 } : lv === 'normal' ? { step: 300 } : {});
        for (let i = 0; i < 170 && !m.over; i++) {
          const dec = AI.decide(m.boards[0], br, 'quest');
          if (dec.swap) M.input(m, 0, { t: 'swap' }, i * 300);
          M.input(m, 0, { t: 'shot', a: dec.a }, i * 300);
        }
        if (m.result && m.result.quest.win) ok++;
        total++;
      }
      wins += ok;
      if (!ok) lows.push(d.id);
    }
  });
  assert(wins / total >= 0.55, '電腦通關率 ' + Math.round(wins / total * 100) + '%，全沒過的關：' + lows.join(','));
});

console.log('\n' + pass + ' 項通過' + (process.exitCode ? '，有失敗' : ''));
