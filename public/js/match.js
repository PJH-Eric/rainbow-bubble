/* ===== match.js — 單機與闖關對局狀態 =====
 *
 * create(cfg) 建立單一盤面的對局；input() 與 tick() 更新規則狀態。
 * shot、swap、end 事件可序列化，供重播測試使用。
 */
(function (root) {
  'use strict';

  const Rules = root.Rules || (typeof require === 'function' ? require('./rules.js') : null);

  function create(cfg) {
    const quest = cfg.mode === 'quest';
    const player = Object.assign({ name: '', dragon: 'rainbow' }, cfg.players && cfg.players[0]);
    const boardCfg = { level: cfg.level || 'normal', layoutId: cfg.layoutId || 'random' };
    const board = quest
      ? Rules.newQuestBoard(cfg.quest)
      : Rules.newBoard(Object.assign({ seed: cfg.seed >>> 0 }, boardCfg));
    return {
      mode: quest ? 'quest' : 'solo',
      quest: quest ? cfg.quest : null,
      level: cfg.level || 'normal',
      seed: cfg.seed >>> 0,
      themeId: cfg.themeId | 0,
      duration: quest ? 0 : (cfg.duration == null ? 180000 : cfg.duration),
      players: [player],
      boards: [board],
      over: false,
      result: null
    };
  }

  function apply(m, ev) {
    switch (ev.e) {
      case 'shot': {
        const b = m.boards[0];
        if (m.over || b.fullClear) return null;
        return Rules.applyShot(b, ev.a);
      }
      case 'swap':
        if (!m.over && !m.boards[0].fullClear) Rules.swapItems(m.boards[0]);
        return null;
      case 'end':
        m.over = true;
        m.result = ev.result;
        return null;
      default:
        return null;
    }
  }

  function endMatch(m, t, reason) {
    if (m.over) return [];
    const result = {
      reason,
      t: Math.round(t || 0),
      mode: m.mode,
      layoutName: m.boards[0].layoutName
    };
    if (m.mode === 'quest') result.quest = Rules.questSummary(m.boards[0]);
    const ev = { e: 'end', t, result };
    apply(m, ev);
    return [{ ev, res: null }];
  }

  function input(m, slot, inp, t) {
    if (m.over || slot !== 0 || !inp || m.boards[0].fullClear) return [];
    if (inp.t === 'swap') {
      const ev = { e: 'swap', s: 0, t };
      apply(m, ev);
      return [{ ev, res: null }];
    }
    if (inp.t !== 'shot') return [];
    const angle = Rules.clampAngle(+inp.a);
    if (!isFinite(angle)) return [];
    const ev = { e: 'shot', s: 0, a: angle, t };
    const res = apply(m, ev);
    const out = [{ ev, res }];
    const board = m.boards[0];
    if (board.qDone) out.push.apply(out, endMatch(m, t, board.qDone));
    else if (res && res.fullClear) out.push.apply(out, endMatch(m, t, 'clear'));
    return out;
  }

  function tick(m, t) {
    if (!m.over && m.duration > 0 && t >= m.duration) return endMatch(m, t, 'time');
    return [];
  }

  const api = { create, apply, input, tick, endMatch };
  root.Match = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
