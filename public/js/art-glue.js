/* ===== art-glue.js — 美術小工具：SVG 轉圖片網址、點陣快取（精靈圖）、頭像 =====
 * 美術本身在 art-dragons.js / art-world.js；這裡只做「怎麼拿來用」。
 */
(function (root) {
  'use strict';
  const Art = root.Art = root.Art || {};
  const urlCache = new Map();

  /** SVG 字串 → data URL（同一份字串只轉一次） */
  Art.svgUrl = function (svg) {
    let u = urlCache.get(svg);
    if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); if (urlCache.size > 400) urlCache.clear(); urlCache.set(svg, u); }
    return u;
  };

  /* ---------- 精靈圖：把 SVG 預先畫成 Image，canvas 直接 drawImage ---------- */
  const sprites = new Map();
  function load(key, svg, px) {
    let s = sprites.get(key);
    if (s) return s;
    s = { img: new Image(), ready: false, key };
    s.img.onload = () => { s.ready = true; };
    s.img.decoding = 'async';
    s.img.src = Art.svgUrl(svg);
    sprites.set(key, s);
    return s;
  }
  /** 回傳 Image（尚未載入完成時回傳 null，畫面下一格再試） */
  Art.sprite = function (key) {
    let s = sprites.get(key);
    if (!s) {
      let svg = null;
      const p = key.split(':');
      if (p[0] === 'b') svg = Art.bubbleSVG(+p[1], { mod: +p[2] || 0, set: p[3] || 'default' });
      else if (p[0] === 's') svg = Art.specialBubbleSVG(p[1]);
      else if (p[0] === 'cannon') svg = Art.cannonSVG();
      else if (p[0] === 'dragon') svg = Art.dragonSVG(p[1], p[2] || 'idle');
      else if (p[0] === 'face') svg = Art.dragonFaceSVG(p[1]);
      if (!svg) return null;
      s = load(key, svg);
    }
    return s.ready ? s.img : null;
  };
  /** 先把常用精靈圖全部載入，避免開局時閃一下空白 */
  Art.preload = function (dragonIds) {
    for (let c = 1; c <= 9; c++) for (let m = 0; m < 3; m++) Art.sprite('b:' + c + ':' + m);
    ['rainbow', 'star', 'cloud'].forEach(k => Art.sprite('s:' + k));
    Art.sprite('cannon');
    (dragonIds || Art.DRAGONS.map(d => d.id)).forEach(id => { ['idle', 'shoot', 'cheer', 'sad'].forEach(p => Art.sprite('dragon:' + id + ':' + p)); Art.sprite('face:' + id); });
  };
  /** 其他圖案組：進入該主題時才載入（lazy） */
  Art.preloadSet = function (set) {
    if (!set || set === 'default' || !Art.SETS[set]) return;
    for (let c = 1; c <= 9; c++) Art.sprite('b:' + c + ':0:' + set);
  };
  Art.spriteKeyOf = function (v, set) {
    const c = v & 15, m = v >> 4;
    return c === 15 ? 's:cloud' : 'b:' + c + ':' + m + (set && set !== 'default' ? ':' + set : '');
  };
  Art.dragonName = function (id) { const d = Art.DRAGONS.find(x => x.id === id); return d ? d.name : id; };
  Art.dragonAccent = function (id) { const d = Art.DRAGONS.find(x => x.id === id); return d ? d.accent : '#ff7eb6'; };
  Art.randomDragon = function () { return Art.DRAGONS[Math.floor(Math.random() * Art.DRAGONS.length)].id; };
})(typeof self !== 'undefined' ? self : this);
