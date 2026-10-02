/* ===== storage.js — 本機設定與戰績（只存在這台裝置，不上傳） ===== */
(function (root) {
  'use strict';
  const KEY = 'rainbow-bubble';
  const SETTING_DEFAULTS = {
    bgm: true, bgmVol: 0.5,
    sfx: true, sfxVol: 0.8,
    vibrate: true,
    reduceMotion: false,
    aimMode: 'tap',          /* tap 點哪射哪／drag 拖曳瞄準、放開才射 */
    aimLine: true            /* 顯示瞄準虛線 */
  };
  const SOLO_DEFAULTS = {
    mode: 'race',            /* 單機：race 比賽／duel 對打 */
    opponents: 0,            /* 電腦對手數 0～3 */
    aiLevels: ['easy', 'easy', 'easy'],
    level: 'easy',           /* 自己的盤面難度 baby/easy/normal/hard */
    layout: 'random', theme: 'random', duration: 180000
  };
  const DEFAULTS = Object.assign({
    nickname: '',
    dragon: 'rainbow',
    solo: Object.assign({}, SOLO_DEFAULTS),
    stats: {},             /* { solo: {play, win}, online: {play, win} } */
    seenHelp: false
  }, SETTING_DEFAULTS);

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    const data = Object.assign({}, DEFAULTS, raw || {});
    data.solo = Object.assign({}, SOLO_DEFAULTS, (raw && raw.solo) || {});
    if (!Array.isArray(data.solo.aiLevels) || data.solo.aiLevels.length < 3) data.solo.aiLevels = SOLO_DEFAULTS.aiLevels.slice();
    data.stats = Object.assign({}, (raw && raw.stats) || {});
    if (!raw || !raw.dragon) {
      const ids = ['rainbow', 'cloud', 'candy', 'sun', 'moon', 'blossom', 'frost', 'forest'];
      data.dragon = ids[Math.floor(Math.random() * ids.length)];
      save(data);
    }
    return data;
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 無痕模式等，忽略 */ }
  }
  function resetSettings(data) {
    Object.assign(data, SETTING_DEFAULTS);
    save(data);
    return data;
  }
  function record(data, bucket, win) {
    const s = data.stats[bucket] || { play: 0, win: 0 };
    s.play++;
    if (win) s.win++;
    data.stats[bucket] = s;
    save(data);
    return s;
  }
  root.Store = { load, save, resetSettings, record, DEFAULTS, SETTING_DEFAULTS, SOLO_DEFAULTS, KEY };
})(typeof self !== 'undefined' ? self : this);
