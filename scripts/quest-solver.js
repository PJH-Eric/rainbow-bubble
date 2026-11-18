/* ===== quest-solver.js — 闖關資料測試用自動求解器 =====
 *
 * 只供闖關資料產生與測試使用，不載入遊戲頁面。
 */
(function (root) {
  'use strict';

  const Rules = root.Rules || (typeof require === 'function' ? require('../public/js/rules.js') : null);

  const LEVEL_ORDER = ['baby', 'easy', 'normal', 'hard'];
  const PROFILE = {
    baby:   { delay: [3000, 4500], step: 1500, noise: 0, random: 0.55, swap: 0,    depth: 0 },
    easy:   { delay: [2000, 3000], step: 800,  noise: 400, random: 0.25, swap: 0.15, depth: 0.2 },
    normal: { delay: [1200, 2000], step: 300,  noise: 150, random: 0.08, swap: 0.6,  depth: 0.6 },
    hard:   { delay: [800, 1300],  step: 100,  noise: 30,  random: 0.02, swap: 1,    depth: 1 }
  };

  function createBrain(level, seed) {
    const lv = PROFILE[level] ? level : 'normal';
    return { level: lv, p: PROFILE[lv], rng: Rules.mulberry32((seed >>> 0) ^ 0x51ED), wait: -1 };
  }

  function delayOf(brain) {
    const d = brain.p.delay;
    return d[0] + brain.rng() * (d[1] - d[0]);
  }

/** 闖關資料 QA：依目標加分，產生穩定的測試行動並校準關卡發射數。 */
  function questBonus(board, res) {
    const g = board.quest.goal;
    let n = 0;
    const all = res.popped.concat(res.dropped);
    for (const o of all) {
      if (o.how === 'fizzle' || !Rules.isBubble(o.v)) continue;
      if (g.type === 'star' && Rules.modOf(o.v) === 1) n += 30;
      else if (g.type === 'bonus' && Rules.modOf(o.v) === 2) n += 30;
      else if (g.type === 'color' && Rules.colorOf(o.v) === g.color) n += 14;
    }
    return n;
  }

  /** 評分：越高越好 */
  function score(board, res, brain) {
    const p = brain.p;
    let s = res.gained * 10;
    if (board.quest) s += questBonus(board, res);
    if (res.fullClear) s += 5000;
    /* 越高（離底線越遠）越好：落點列數越小越安全 */
    s -= res.land.r * 0.8 * p.depth;
    if (res.rain) s -= 40;
    if (res.descended) s -= 6 * p.depth;
    /* 沒消除時，偏好貼著同色（為下一發鋪路） */
    if (res.gained === 0) {
      let same = 0;
      for (const q of Rules.neighbors(board, res.land.r, res.land.c)) {
        const v = Rules.get(board, q[0], q[1]);
        if (Rules.isBubble(v) && Rules.colorOf(v) === Rules.colorOf(Rules.get(board, res.land.r, res.land.c) || 0)) same++;
      }
      s += same * 1.5 * p.depth;
    }
    return s;
  }

  /** 決定這一發怎麼打。回傳 { a, swap } */
  function decide(board, brain) {
    const p = brain.p, rng = brain.rng;
    const randomShot = () => ({ a: Rules.MIN_A + Math.floor(rng() * (Rules.MAX_A - Rules.MIN_A)), swap: false });
    if (rng() < p.random) return randomShot();
    let best = null;
    const options = [false];
    if (p.swap && board.nxt && rng() < p.swap && (board.nxt.k !== board.cur.k || board.nxt.c !== board.cur.c)) options.push(true);
    for (const sw of options) {
      for (let a = Rules.MIN_A; a <= Rules.MAX_A; a += p.step) {
        const res = Rules.preview(board, a, sw);
        const sc = score(board, res, brain) + rng() * 0.5;
        if (!best || sc > best.sc) best = { a, swap: sw, sc };
      }
    }
    if (!best) return randomShot();
    const noise = p.noise ? Math.round((rng() * 2 - 1) * p.noise) : 0;
    return { a: Rules.clampAngle(best.a + noise), swap: best.swap };
  }

  const api = { LEVEL_ORDER, PROFILE, createBrain, decide, delayOf };
  root.QuestSolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
