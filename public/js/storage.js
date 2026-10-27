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
    seenHelp: false,
    quest: null             /* 闖關進度：{ v, baby:{stars:[…]}, easy, normal, hard, hints:{} } */
  }, SETTING_DEFAULTS);

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    const data = Object.assign({}, DEFAULTS, raw || {});
    data.solo = Object.assign({}, SOLO_DEFAULTS, (raw && raw.solo) || {});
    if (!Array.isArray(data.solo.aiLevels) || data.solo.aiLevels.length < 3) data.solo.aiLevels = SOLO_DEFAULTS.aiLevels.slice();
    data.stats = Object.assign({}, (raw && raw.stats) || {});
    data.quest = normalizeQuest(raw && raw.quest);
    if (!raw || !raw.dragon) {
      const ids = ['rainbow', 'cloud', 'candy', 'sun', 'moon', 'blossom', 'frost', 'forest'];
      data.dragon = ids[Math.floor(Math.random() * ids.length)];
      save(data);
    }
    return data;
  }
  /* ---------- 闖關進度 ---------- */
  const QLEVELS = ['baby', 'easy', 'normal', 'hard'];
  const QPER = 100;
  /** 壞掉或舊版的存檔一律整理成合法格式：星等只收 0～3 的整數、長度不超過 100 */
  function normalizeQuest(q) {
    const out = { v: 1, hints: {} };
    QLEVELS.forEach(lv => {
      const src = q && q[lv] && Array.isArray(q[lv].stars) ? q[lv].stars : [];
      const stars = [];
      for (let i = 0; i < Math.min(QPER, src.length); i++) { const n = src[i] | 0; stars.push(n < 0 ? 0 : n > 3 ? 3 : n); }
      out[lv] = { stars };
    });
    if (q && q.hints && typeof q.hints === 'object') Object.keys(q.hints).forEach(k => { if (q.hints[k]) out.hints[String(k).slice(0, 24)] = true; });
    return out;
  }
  const questStars = (data, level, no) => (data.quest && data.quest[level] && data.quest[level].stars[no - 1]) | 0;
  /** 目前可玩到第幾關：連續過關的下一關（最多 100） */
  function questUnlocked(data, level) {
    const st = (data.quest && data.quest[level] && data.quest[level].stars) || [];
    let n = 0;
    while (n < st.length && st[n] > 0) n++;
    return Math.min(QPER, n + 1);
  }
  const questTotalStars = (data, level) => ((data.quest && data.quest[level] && data.quest[level].stars) || []).reduce((a, b) => a + b, 0);
  const questCleared = (data, level) => ((data.quest && data.quest[level] && data.quest[level].stars) || []).filter(n => n > 0).length;
  /** 記錄一次過關：星等只升不降；回傳 { first, improved, stars }。沒解鎖的關卡不能記錄 */
  function questRecord(data, level, no, stars) {
    if (QLEVELS.indexOf(level) < 0 || no < 1 || no > QPER || no > questUnlocked(data, level)) return { first: false, improved: false, stars: 0, ignored: true };
    stars = Math.max(0, Math.min(3, stars | 0));
    if (!data.quest) data.quest = normalizeQuest(null);
    const st = data.quest[level].stars;
    while (st.length < no) st.push(0);
    const old = st[no - 1];
    if (stars > old) st[no - 1] = stars;
    save(data);
    return { first: old === 0 && stars > 0, improved: stars > old, stars: st[no - 1] };
  }
  const questHintSeen = (data, key) => !!(data.quest && data.quest.hints && data.quest.hints[key]);
  function questHintMark(data, key) {
    if (!data.quest) data.quest = normalizeQuest(null);
    data.quest.hints[String(key).slice(0, 24)] = true;
    save(data);
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
  root.Store = { load, save, resetSettings, record, normalizeQuest, questStars, questUnlocked, questTotalStars, questCleared, questRecord, questHintSeen, questHintMark, DEFAULTS, SETTING_DEFAULTS, SOLO_DEFAULTS, KEY };
})(typeof self !== 'undefined' ? self : this);
