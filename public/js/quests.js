/* ===== quests.js — 闖關關卡資料的查詢與校驗 =====
 * 資料在 quests-data.js（scripts/gen-quests.js 產生）。瀏覽器掛 root.Quests；Node 用 module.exports。
 * 四段難度（baby／easy／normal／hard）各 100 關；每 10 關第 10 關是關主關。 */
(function (root) {
  'use strict';

  const Data = root.QuestData || (typeof require === 'function' ? require('./quests-data.js') : { levels: {} });
  const Rules = root.Rules || (typeof require === 'function' ? require('./rules.js') : null);
  const Layouts = root.Layouts || (typeof require === 'function' ? require('./layouts.js') : null);
  const PER_LEVEL = 100;
  const GROUP = 10;

  function list(level) { return (Data.levels && Data.levels[level]) || []; }
  function count(level) { return list(level).length; }
  /** 取第 no 關（從 1 開始）；沒有就回傳 null */
  function get(level, no) { const l = list(level); return no >= 1 && no <= l.length ? l[no - 1] : null; }
  const isBoss = no => no % GROUP === 0;
  /** 該關屬於第幾組（0～9），一組共用一套主題 */
  const groupOf = no => Math.floor((no - 1) / GROUP);

  /** 檢查一筆關卡定義；回傳問題清單（空陣列代表沒問題） */
  function validate(def) {
    const bad = [];
    const need = (ok, msg) => { if (!ok) bad.push(msg); };
    need(def && def.id, '缺 id');
    if (!def) return bad;
    const cfg = Rules.DIFF[def.level];
    need(!!cfg, '難度不存在：' + def.level);
    if (!cfg) return bad;
    need(def.id === def.level + '-' + def.no, 'id 與難度／關號不符');
    need(def.no >= 1 && def.no <= PER_LEVEL, '關號超出範圍');
    need(!!def.boss === isBoss(def.no), '關主關必須是 10 的倍數');
    need(def.colors >= 3 && def.colors <= cfg.colors.length, '顏色數 ' + def.colors + ' 超出 3～' + cfg.colors.length);
    need(def.rows >= 4 && def.rows <= 11, '排數 ' + def.rows);
    need(def.cols == null || (def.cols >= 8 && def.cols <= cfg.cols), '欄數 ' + def.cols);
    need(def.theme >= 0 && def.theme <= 6, '主題 ' + def.theme);
    need(Number.isInteger(def.seed) && def.seed >= 0, 'seed');
    need(!!Layouts.list().some(x => x.id === def.layout) || !!Layouts.BOSS.some(x => x.id === def.layout), '版型不存在：' + def.layout);
    need(Rules.GOAL_TYPES.indexOf(def.goal && def.goal.type) >= 0, '目標種類');
    if (def.level === 'baby') need(!def.shots, '幼幼班不限發射數');
    else need(def.shots > 0, '缺發射數上限');
    need(!def.mini || Rules.MINI_IDS.indexOf(def.mini) >= 0, '小目標：' + def.mini);
    need(def.rescue === (def.level === 'baby'), '只有幼幼班保留觸底救援');
    if (def.level === 'baby') need(def.noObs === true, '幼幼班沒有雲朵磚');
    if (def.goal && def.goal.type === 'color') need(def.goal.color > 0 && def.goal.n > 0, '指定顏色目標缺顏色或數量');
    if (def.goal && def.goal.type === 'bonus') need(def.bonus >= def.goal.n && def.goal.n > 0, '獎勵目標：總數要 ≥ 目標數');
    if (def.goal && def.goal.type === 'star') need(def.stars >= 2, '星星目標至少要 2 顆星星');
    return bad;
  }

  /** 把關卡定義包成 Match.create 要的 cfg（單機闖關） */
  function matchCfg(def, player) {
    return { mode: 'quest', quest: def, level: def.level, seed: def.seed, layoutId: def.layout, themeId: def.theme, duration: 0, players: [player] };
  }

  const api = { PER_LEVEL, GROUP, list, count, get, isBoss, groupOf, validate, matchCfg };
  root.Quests = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
