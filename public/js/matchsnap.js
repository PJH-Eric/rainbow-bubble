/* ===== public/js/matchsnap.js — 整場對局的完整快照／還原（不改 match.js） =====
 *
 * 用途：
 *   - 斷線重連、中途加入的觀戰者：伺服器不重播歷史事件，直接送一份 sync{snap}
 *   - 客戶端 hash 對不上時送 resync，伺服器回 sync{snap}
 *
 * snap = { cfg, seq, boards:[Rules.snapshot(b)...], pending, reachedAt, lastAttacker, left, gid, over, result }
 * 全部可 JSON 序列化；snapshotAll 一定回傳「深拷貝」，之後再改 m 不會影響 snap。
 * 瀏覽器端也可載入（掛在 root.MatchSnap），所以只用 root.Rules / root.Match，不碰 Node 專屬 API。
 */
(function (root) {
  'use strict';

  const Rules = root.Rules || (typeof require === 'function' ? require('./rules.js') : null);
  const Match = root.Match || (typeof require === 'function' ? require('./match.js') : null);

  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  /** 由對局物件反推出建立時的 cfg（players 只留 name／dragon／kind） */
  function cfgOf(m) {
    return {
      mode: m.mode, level: m.level, seed: m.seed >>> 0, layoutId: m.layoutId, themeId: m.themeId, duration: m.duration,
      players: m.players.map(p => ({ name: p.name, dragon: p.dragon, kind: p.kind }))
    };
  }

  function snapshotAll(m) {
    return clone({
      cfg: cfgOf(m),
      seq: m.seq,
      boards: m.boards.map(b => Rules.snapshot(b)),
      pending: m.pending,
      reachedAt: m.reachedAt,
      lastAttacker: m.lastAttacker,
      left: m.left,
      gid: m.gid,
      over: m.over,
      result: m.result
    });
  }

  function restoreAll(snap) {
    const s = clone(snap);
    const m = Match.create(s.cfg);
    m.boards = s.boards.map(b => Rules.fromSnapshot(b));
    m.pending = s.pending;
    m.reachedAt = s.reachedAt;
    m.lastAttacker = s.lastAttacker;
    m.left = s.left;
    m.gid = s.gid;
    m.over = !!s.over;
    m.result = s.result == null ? null : s.result;
    m.seq = s.seq;
    return m;
  }

  /** 每個盤面的雜湊（hash 訊息用） */
  function hashes(m) { return m.boards.map(b => Rules.boardHash(b)); }

  const api = { snapshotAll, restoreAll, hashes, cfgOf };
  root.MatchSnap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
