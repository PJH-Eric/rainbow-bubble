/* ===== match.js — 一場對局（最多 4 個盤面）的共用狀態與「可重播事件」 =====
 *
 * 瀏覽器（單機）與 Node 伺服器（線上）共用同一份：
 *   - create(cfg)            建立對局：每個玩家一個盤面，初始盤面與發射序列用同一個 seed
 *   - apply(m, ev)           重播一個事件（shot／swap／pend／cancel／land／end）；結果只由事件決定
 *   - input(m, slot, inp, t) 「裁判端」收到玩家輸入：驗證、套用、並產生需要廣播的事件
 *   - tick(m, t)             「裁判端」依時間產生事件（送來的泡泡落下、時間到結束）
 *
 * 線上：伺服器是裁判，把事件依序廣播；每個客戶端對自己的 m 呼叫 apply()，盤面就會逐位元一致。
 * 單機：瀏覽器自己當裁判，呼叫 input()/tick() 後直接用回傳的事件與結果做動畫。
 *
 * 事件格式（全部可 JSON 序列化）：
 *   { e:'shot', s:席位, a:角度(百分之一度), t:毫秒 }
 *   { e:'swap', s, t }
 *   { e:'pend', to, from, id, n, at, t }   對打：有 n 顆泡泡將在 at 毫秒落到 to 的盤面頂端（先預告）
 *   { e:'cancel', to, id, n, t }           預告期間被抵銷，n 是剩下的顆數（0 代表整筆取消）
 *   { e:'land', s, id, n, t }              預告結束，泡泡落下
 *   { e:'end', t, result }                 對局結束
 */
(function (root) {
  'use strict';

  const Rules = root.Rules || (typeof require === 'function' ? require('./rules.js') : null);

  function create(cfg) {
    const players = cfg.players.map((p, i) => ({
      slot: i, name: p.name || '', dragon: p.dragon || 'rainbow', kind: p.kind || 'human', aiLevel: p.aiLevel || null
    }));
    const m = {
      mode: cfg.mode === 'duel' ? 'duel' : 'race',
      level: cfg.level || 'normal', seed: cfg.seed >>> 0, layoutId: cfg.layoutId || 'random', themeId: cfg.themeId | 0,
      duration: cfg.duration == null ? 180000 : cfg.duration,
      players,
      boards: players.map(() => Rules.newBoard({ seed: cfg.seed, level: cfg.level, layoutId: cfg.layoutId })),
      pending: players.map(() => []),
      reachedAt: players.map(() => 0),
      lastAttacker: players.map(() => -1),
      left: players.map(() => false),
      gid: 0, over: false, result: null, seq: 0
    };
    return m;
  }

  /* ---------- 重播事件 ---------- */
  function apply(m, ev) {
    m.seq++;
    switch (ev.e) {
      case 'shot': {
        const b = m.boards[ev.s];
        if (!b || b.fullClear) return null;
        const before = b.cleared;
        const res = Rules.applyShot(b, ev.a);
        if (b.cleared > before) m.reachedAt[ev.s] = ev.t || 0;
        return res;
      }
      case 'swap': {
        const b = m.boards[ev.s];
        if (b) Rules.swapItems(b);
        return null;
      }
      case 'pend': {
        m.pending[ev.to].push({ id: ev.id, n: ev.n, from: ev.from, at: ev.at });
        if (ev.id > m.gid) m.gid = ev.id;
        const fb = m.boards[ev.from];
        if (fb) fb.garbageOut += ev.n;
        return null;
      }
      case 'cancel': {
        const list = m.pending[ev.to];
        const i = list.findIndex(p => p.id === ev.id);
        if (i >= 0) { if (ev.n <= 0) list.splice(i, 1); else list[i].n = ev.n; }
        return null;
      }
      case 'land': {
        const list = m.pending[ev.s];
        const i = list.findIndex(p => p.id === ev.id);
        if (i >= 0) list.splice(i, 1);
        const b = m.boards[ev.s];
        if (!b || b.fullClear) return null;
        return Rules.applyGarbage(b, ev.n, ev.id);
      }
      case 'end': {
        m.over = true; m.result = ev.result;
        return null;
      }
    }
    return null;
  }

  /* ---------- 裁判端 ---------- */
  function pickTarget(m, s) {
    let best = -1, bn = 1e9;
    for (let i = 0; i < m.players.length; i++) {
      if (i === s || m.left[i] || m.boards[i].fullClear) continue;
      const n = Rules.bubbleCount(m.boards[i]);
      if (n < bn || (n === bn && i === m.lastAttacker[s])) { bn = n; best = i; }
    }
    return best;
  }

  function ranking(m) {
    const rows = m.players.map((p, i) => {
      const b = m.boards[i];
      return {
        s: i, name: p.name, dragon: p.dragon, kind: p.kind, aiLevel: p.aiLevel, cleared: b.cleared, fullClear: b.fullClear,
        shots: b.shots, hits: b.hits | 0, best: b.best | 0, dropN: b.dropN | 0, rains: b.rains | 0, maxCombo: b.maxCombo, garbageOut: b.garbageOut, garbageIn: b.garbageIn, left: m.left[i], reachedAt: m.reachedAt[i]
      };
    });
    rows.sort((x, y) => (y.fullClear - x.fullClear) || (x.left - y.left) || (y.cleared - x.cleared) || (x.reachedAt - y.reachedAt) || (x.s - y.s));
    /* 同分且同時間視為並列名次 */
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.rank = prev && prev.cleared === r.cleared && prev.fullClear === r.fullClear && prev.reachedAt === r.reachedAt && prev.left === r.left ? prev.rank : i + 1;
    });
    return rows;
  }

  function endMatch(m, t, reason) {
    if (m.over) return [];
    const rank = ranking(m);
    const ev = { e: 'end', t, result: { reason, t: Math.round(t || 0), ranks: rank, winner: rank[0].s, mode: m.mode, layoutName: m.boards[0].layoutName } };
    apply(m, ev);
    return [{ ev, res: null }];
  }

  /** 玩家輸入：{ t:'shot', a } 或 { t:'swap' }。回傳 [{ ev, res }]，ev 要廣播，res 是本機動畫用的結果。 */
  function input(m, s, inp, t) {
    const out = [];
    if (m.over || !inp || s < 0 || s >= m.players.length || m.left[s]) return out;
    const b = m.boards[s];
    if (b.fullClear) return out;
    if (inp.t === 'swap') {
      const ev = { e: 'swap', s, t };
      apply(m, ev); out.push({ ev, res: null });
      return out;
    }
    if (inp.t !== 'shot') return out;
    const a = Rules.clampAngle(+inp.a);
    if (!isFinite(a)) return out;
    const ev = { e: 'shot', s, a, t };
    const res = apply(m, ev);
    out.push({ ev, res });
    if (!res) return out;
    /* 對打：這一發的清除量換成送給對手的泡泡 */
    if (m.mode === 'duel' && res.gained > 0) {
      let n = Rules.attackFor(res.gained, b.cols, b.cfg.mult);
      if (n > 0) {
        /* 先抵銷自己頭上還沒落下的 */
        const mine = m.pending[s].slice().sort((x, y) => x.at - y.at);
        for (const p of mine) {
          if (n <= 0) break;
          const cut = Math.min(n, p.n);
          const rest = p.n - cut;
          n -= cut;
          const cev = { e: 'cancel', to: s, id: p.id, n: rest, t };
          apply(m, cev); out.push({ ev: cev, res: null });
        }
        if (n > 0) {
          const to = pickTarget(m, s);
          if (to >= 0) {
            const pev = { e: 'pend', to, from: s, id: ++m.gid, n, at: t + m.boards[to].cfg.warnMs, t };
            m.lastAttacker[to] = s;
            apply(m, pev); out.push({ ev: pev, res: null });
          }
        }
      }
    }
    if (res.fullClear) out.push.apply(out, endMatch(m, t, 'clear'));
    return out;
  }

  /** 時間推進：預告到期的泡泡落下、時間到結束 */
  function tick(m, t) {
    const out = [];
    if (m.over) return out;
    const due = [];
    for (let s = 0; s < m.players.length; s++) for (const p of m.pending[s]) if (p.at <= t) due.push({ s, p });
    due.sort((x, y) => x.p.at - y.p.at || x.p.id - y.p.id);
    for (const d of due) {
      const ev = { e: 'land', s: d.s, id: d.p.id, n: d.p.n, t };
      const res = apply(m, ev);
      out.push({ ev, res });
    }
    if (m.duration > 0 && t >= m.duration) out.push.apply(out, endMatch(m, t, 'time'));
    return out;
  }

  /** 有人離場（斷線超時、被踢）：盤面凍結，名次排在最後 */
  function playerLeft(m, s, t) {
    if (m.left[s]) return [];
    m.left[s] = true;
    const out = [];
    /* 還有人在玩嗎？沒有就直接結束 */
    if (m.players.every((p, i) => m.left[i] || p.kind === 'ai')) out.push.apply(out, endMatch(m, t, 'left'));
    return out;
  }

  const api = { create, apply, input, tick, endMatch, ranking, playerLeft, pickTarget };
  root.Match = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
