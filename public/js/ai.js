/* ===== ai.js — 四段電腦（幼幼班／簡單／普通／困難） =====
 *
 * 電腦和玩家走一模一樣的路：只能「瞄準角度＋發射＋交換」，不能直接改盤面。
 * 難度差異看得出來，不只是改名字：
 *   - 取樣精細度：幼幼班幾乎亂打、簡單粗略挑、普通細挑、困難逐度挑
 *   - 失誤：幼幼班常打偏，困難幾乎不失誤
 *   - 反應間隔：幼幼班 3～4.5 秒、困難 0.8～1.3 秒
 *   - 交換：幼幼班不用，簡單偶爾，普通與困難會比較兩顆
 *   - 對打：困難會看「消除數換算成送出的泡泡」來挑，並避免讓自己離底線太近
 */
(function (root) {
  'use strict';

  const Rules = root.Rules || (typeof require === 'function' ? require('./rules.js') : null);

  const LEVEL_ORDER = ['baby', 'easy', 'normal', 'hard'];
  const PROFILE = {
    baby:   { delay: [3000, 4500], step: 1500, noise: 0, random: 0.55, swap: 0,    depth: 0,   attack: 0 },
    easy:   { delay: [2000, 3000], step: 800,  noise: 400, random: 0.25, swap: 0.15, depth: 0.2, attack: 0 },
    normal: { delay: [1200, 2000], step: 300,  noise: 150, random: 0.08, swap: 0.6,  depth: 0.6, attack: 0.3 },
    hard:   { delay: [800, 1300],  step: 100,  noise: 30,  random: 0.02, swap: 1,    depth: 1,   attack: 1 }
  };

  function createBrain(level, seed) {
    const lv = PROFILE[level] ? level : 'normal';
    return { level: lv, p: PROFILE[lv], rng: Rules.mulberry32((seed >>> 0) ^ 0x51ED), wait: -1 };
  }

  function delayOf(brain) {
    const d = brain.p.delay;
    return d[0] + brain.rng() * (d[1] - d[0]);
  }

  /** 評分：越高越好 */
  function score(board, res, brain, mode) {
    const p = brain.p;
    let s = res.gained * 10;
    if (res.fullClear) s += 5000;
    if (mode === 'duel' && p.attack) s += Rules.attackFor(res.gained, board.cols, board.cfg.mult) * 6 * p.attack;
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
  function decide(board, brain, mode) {
    const p = brain.p, rng = brain.rng;
    const randomShot = () => ({ a: Rules.MIN_A + Math.floor(rng() * (Rules.MAX_A - Rules.MIN_A)), swap: false });
    if (rng() < p.random) return randomShot();
    let best = null;
    const options = [false];
    if (p.swap && board.nxt && rng() < p.swap && (board.nxt.k !== board.cur.k || board.nxt.c !== board.cur.c)) options.push(true);
    for (const sw of options) {
      for (let a = Rules.MIN_A; a <= Rules.MAX_A; a += p.step) {
        const res = Rules.preview(board, a, sw);
        const sc = score(board, res, brain, mode) + rng() * 0.5;
        if (!best || sc > best.sc) best = { a, swap: sw, sc };
      }
    }
    if (!best) return randomShot();
    const noise = p.noise ? Math.round((rng() * 2 - 1) * p.noise) : 0;
    return { a: Rules.clampAngle(best.a + noise), swap: best.swap };
  }

  /** 每個畫格呼叫：時間到就回傳決定，否則回傳 null。dt 是毫秒。 */
  function think(brain, board, dt, mode, ready) {
    if (!ready) return null;
    if (brain.wait < 0) brain.wait = delayOf(brain);
    brain.wait -= dt;
    if (brain.wait > 0) return null;
    brain.wait = -1;
    return decide(board, brain, mode);
  }

  const api = { LEVEL_ORDER, PROFILE, createBrain, decide, think, delayOf };
  root.AI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
