/* 彩虹泡泡砲 — art-world.js
 * 泡泡、特殊物件、發射器、七套背景、標誌、介面圖示（全部是程式產生的向量 SVG 字串）
 * 介面：Art.COLORS / bubbleSVG / specialBubbleSVG / cannonSVG / THEMES / themeBgSVG / logoSVG / icon
 * 規則：不用外部資源、不用 foreignObject、不用 CSS 變數；每張 SVG 的 id 都帶唯一前綴。
 */
(function (root) {
  'use strict';
  var Art = root.Art = root.Art || {};

  var NS = 'xmlns="http://www.w3.org/2000/svg"';
  var FONT = '"Baloo 2","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

  // ───────────── 小工具 ─────────────
  function n2(v) { return Math.round(v * 100) / 100; }
  function hex2rgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgb2hex(r) {
    return '#' + r.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }
  function mix(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function darken(c, t) { return mix(c, '#2a1240', t); }   // 往深紫偏，描邊比純黑可愛
  function lighten(c, t) { return mix(c, '#ffffff', t); }
  function rng(seed) {                                      // 固定種子亂數（背景裝飾位置固定）
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function svgWrap(vb, inner, extra) {
    return '<svg ' + NS + ' viewBox="' + vb + '"' + (extra ? ' ' + extra : '') + '>' + inner + '</svg>';
  }
  function starPts(cx, cy, ro, ri, n, rot) {
    var pts = [], i, a, r;
    rot = rot === undefined ? -Math.PI / 2 : rot;
    for (i = 0; i < n * 2; i++) {
      a = rot + i * Math.PI / n;
      r = i % 2 === 0 ? ro : ri;
      pts.push(n2(cx + Math.cos(a) * r) + ',' + n2(cy + Math.sin(a) * r));
    }
    return pts.join(' ');
  }
  function lg(id, x1, y1, x2, y2, stops) {                   // 線性漸層
    return '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
      stops.map(function (s) {
        return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>';
      }).join('') + '</linearGradient>';
  }
  function rg(id, cx, cy, r, stops, fx, fy) {                // 放射漸層
    return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"' +
      (fx !== undefined ? ' fx="' + fx + '" fy="' + fy + '"' : '') + '>' +
      stops.map(function (s) {
        return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>';
      }).join('') + '</radialGradient>';
  }

  // ───────────── 1. 六種顏色 ─────────────
  var COLORS = [null,
    { id: 1, name: '紅', main: '#ff5c7a', shape: 'heart' },
    { id: 2, name: '黃', main: '#ffcf3a', shape: 'star' },
    { id: 3, name: '綠', main: '#46d37f', shape: 'clover' },
    { id: 4, name: '藍', main: '#4aa8ff', shape: 'drop' },
    { id: 5, name: '紫', main: '#a678ff', shape: 'moon' },
    { id: 6, name: '橘', main: '#ff9a3c', shape: 'flower' },
    { id: 7, name: '青', main: '#27cfc3', shape: 'diamond' },
    { id: 8, name: '粉', main: '#ff86d2', shape: 'smile' },
    { id: 9, name: '棕', main: '#c98857', shape: 'paw' },
    { id: 10, name: '萊姆', main: '#a6d52f', shape: 'butterfly' }
  ];
  Art.COLORS = COLORS;

  // 圖案：回傳 { shapes, extraO, extraF, fAttr }；shapes 同時用在外框層與白色填色層
  function moonPath(cx, cy, r0, bx, by, r1) {
    var dx = bx - cx, dy = by - cy, d = Math.sqrt(dx * dx + dy * dy);
    var a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
    var h = Math.sqrt(r0 * r0 - a * a);
    var mx = cx + a * dx / d, my = cy + a * dy / d;
    var p1 = [mx + h * dy / d, my - h * dx / d], p2 = [mx - h * dy / d, my + h * dx / d];
    return 'M' + n2(p1[0]) + ' ' + n2(p1[1]) + ' A' + r0 + ' ' + r0 + ' 0 1 0 ' + n2(p2[0]) + ' ' + n2(p2[1]) +
      ' A' + r1 + ' ' + r1 + ' 0 1 1 ' + n2(p1[0]) + ' ' + n2(p1[1]) + 'Z';
  }
  // ── 主題圖案組（每組 10 個，對應 colorId 1..10；顏色不變，只換圖案）──
  Art.SETS = {
    'default': { 1: 'heart', 2: 'star', 3: 'clover', 4: 'drop', 5: 'moon', 6: 'flower', 7: 'diamond', 8: 'smile', 9: 'paw', 10: 'butterfly' },
    beach: { 1: 'crab', 2: 'sun', 3: 'palm', 4: 'wave', 5: 'shell', 6: 'starfish', 7: 'fish', 8: 'umbrella', 9: 'anchor', 10: 'cloudsun' },
    candy: { 1: 'lollipop', 2: 'cookie', 3: 'wrapped', 4: 'icecream', 5: 'cupcake', 6: 'donut', 7: 'popsicle', 8: 'cherry', 9: 'choco', 10: 'sparkle' },
    forest: { 1: 'mushroom', 2: 'sun', 3: 'leaf', 4: 'drop', 5: 'butterfly', 6: 'fox', 7: 'pine', 8: 'flower', 9: 'acorn', 10: 'firefly' },
    night: { 1: 'rocket', 2: 'star', 3: 'ufo', 4: 'planet', 5: 'moon', 6: 'comet', 7: 'sparkle', 8: 'alien', 9: 'asteroid', 10: 'firefly' },
    ocean: { 1: 'octopus', 2: 'fish', 3: 'turtle', 4: 'whale', 5: 'jellyfish', 6: 'starfish', 7: 'seahorse', 8: 'shell', 9: 'anchor', 10: 'crab' },
    sunmoon: { 1: 'bloodmoon', 2: 'sunray', 3: 'aurora', 4: 'fullmoon', 5: 'crescent', 6: 'dawn', 7: 'ringplanet', 8: 'sharpstar', 9: 'solarecl', 10: 'eclipse' }
  };
  // 粗線條（外框層 + 白色層）與細節線
  function thick(d, w) { return { o: '<path d="' + d + '" fill="none" stroke-width="' + (w || 10) + '"/>', f: '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="' + ((w || 10) - 5.5) + '"/>' }; }
  function ln(d, c, w) { return '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (w || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>'; }
  function dot(x, y, r, c) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/>'; }
  function many(list, w) { var o = '', f = '', i, t; for (i = 0; i < list.length; i++) { t = thick(list[i], w); o += t.o; f += t.f; } return { o: o, f: f }; }
  function rot(a, cx, cy, inner) { return '<g transform="rotate(' + a + ' ' + cx + ' ' + cy + ')">' + inner + '</g>'; }
  var G = {
    crab: function (m, k) { var t = many(['M32 64 L20 74', 'M68 64 L80 74', 'M37 70 L31 82', 'M63 70 L69 82']);
      return { shapes: '<ellipse cx="50" cy="56" rx="22" ry="15"/><circle cx="27" cy="38" r="9"/><circle cx="73" cy="38" r="9"/><path d="M32 50 L28 42 M68 50 L72 42" stroke-width="5"/>', extraO: t.o, extraF: t.f + dot(43, 53, 3.6, k) + dot(57, 53, 3.6, k) + ln('M44 62 Q50 67 56 62', k) }; },
    sunray: function (m, k) { var r = [], i, a, L; for (i = 0; i < 16; i++) { a = i * Math.PI / 8; L = i % 2 ? 29 : 36; r.push('M' + n2(50 + Math.cos(a) * 22) + ' ' + n2(50 + Math.sin(a) * 22) + ' L' + n2(50 + Math.cos(a) * L) + ' ' + n2(50 + Math.sin(a) * L)); }
      var t = many(r, 7.5); return { shapes: '<circle cx="50" cy="50" r="15"/>', extraO: t.o, extraF: t.f + '<circle cx="50" cy="50" r="10.5" fill="none" stroke="' + m + '" stroke-width="1.6" opacity="0.55"/>' }; },
    fullmoon: function (m, k) { return { shapes: '<circle cx="50" cy="50" r="29"/>', extraF: '<g fill="' + k + '" opacity="0.5"><ellipse cx="41" cy="40" rx="9" ry="7" transform="rotate(-20 41 40)"/><ellipse cx="60" cy="58" rx="8" ry="6"/><circle cx="62" cy="38" r="4.4"/><circle cx="38" cy="62" r="3.6"/><circle cx="50" cy="50" r="2.6"/><circle cx="68" cy="50" r="2"/><circle cx="31" cy="50" r="2.2"/></g>' }; },
    crescent: function (m, k) { return { shapes: '<path d="' + moonPath(48, 52, 30, 63, 42, 25) + '"/>', extraF: '<polygon points="' + starPts(75, 27, 6, 2, 4, 0) + '" fill="#fff" stroke="' + k + '" stroke-width="1.4"/>' + '<polygon points="' + starPts(70, 70, 4, 1.4, 4, 0) + '" fill="#fff" stroke="' + k + '" stroke-width="1"/>' }; },
    dawn: function (m, k) { var r = [], i, a; for (i = 0; i < 7; i++) { a = (-180 + 15 + i * 25) * Math.PI / 180; r.push('M' + n2(50 + Math.cos(a) * 25) + ' ' + n2(62 + Math.sin(a) * 25) + ' L' + n2(50 + Math.cos(a) * (i % 2 ? 33 : 38)) + ' ' + n2(62 + Math.sin(a) * (i % 2 ? 33 : 38))); }
      var t = many(r.concat(['M12 64 H88']), 7); return { shapes: '<path d="M32 62 A18 18 0 0 1 68 62Z"/>', extraO: t.o, extraF: t.f + ln('M30 73 H70', '#fff', 3) + ln('M38 80 H62', '#fff', 2.6) + ln('M44 86 H56', '#fff', 2.2) }; },
    ringplanet: function (m, k) { var rg = 'rotate(-22 50 52)';
      return { shapes: '<circle cx="50" cy="52" r="0.1"/>', extraO: '<ellipse cx="50" cy="52" rx="37" ry="11" transform="' + rg + '" fill="none" stroke-width="9"/>', extraF: '<ellipse cx="50" cy="52" rx="37" ry="11" transform="' + rg + '" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="50" cy="52" r="19" fill="#fff" stroke="' + k + '" stroke-width="2.4"/><path d="M33 47 Q50 52 67 45 M32 58 Q50 62 68 55" fill="none" stroke="' + m + '" stroke-width="2" opacity="0.6"/><g transform="' + rg + '"><path d="M13 52 A37 11 0 0 0 87 52" fill="none" stroke="' + k + '" stroke-width="6.4"/><path d="M13 52 A37 11 0 0 0 87 52" fill="none" stroke="#fff" stroke-width="3.4"/></g>' }; },
    sharpstar: function (m, k) { return { shapes: '<polygon points="' + starPts(50, 53, 36, 11, 5) + '" stroke-linejoin="miter"/>', extraF: ln('M50 53 L50 22 M50 53 L79 44 M50 53 L68 80 M50 53 L32 80 M50 53 L21 44', m, 1.3).replace('stroke-linecap="round"', 'opacity="0.45" stroke-linecap="round"') }; },
    aurora: function (m, k) { var t = many(['M12 72 Q30 28 50 52 T88 30', 'M12 88 Q30 50 50 72 T88 52'], 11);
      return { shapes: '<polygon points="' + starPts(22, 24, 7, 2.4, 4, 0) + '"/><polygon points="' + starPts(60, 16, 4.5, 1.6, 4, 0) + '"/><polygon points="' + starPts(82, 14, 3.5, 1.2, 4, 0) + '"/>', extraO: t.o, extraF: t.f }; },
    solarecl: function (m, k) { var r = [], i, a; for (i = 0; i < 16; i++) { a = i * Math.PI / 8; r.push('M' + n2(50 + Math.cos(a) * 28) + ' ' + n2(50 + Math.sin(a) * 28) + ' L' + n2(50 + Math.cos(a) * (i % 2 ? 34 : 40)) + ' ' + n2(50 + Math.sin(a) * (i % 2 ? 34 : 40))); }
      var t = many(r, 6.5); return { shapes: '<circle cx="50" cy="50" r="24"/>', extraO: t.o, extraF: t.f + '<circle cx="50" cy="50" r="19" fill="' + k + '"/><circle cx="35" cy="35" r="4.6" fill="#fff"/>' + ln('M31 31 L39 39 M39 31 L31 39', '#fff', 1.2) }; },
    bloodmoon: function (m, k) { return { shapes: '<circle cx="50" cy="50" r="29"/>', extraF: '<circle cx="50" cy="50" r="25.5" fill="' + k + '"/><path d="' + moonPath(50, 50, 25.5, 66, 66, 24) + '" fill="#fff"/><g fill="#fff" opacity="0.35"><circle cx="58" cy="44" r="3"/><circle cx="62" cy="58" r="2.2"/><circle cx="48" cy="60" r="2.6"/></g>' }; },
    sun: function (m, k) { var r = [], i, a; for (i = 0; i < 8; i++) { a = i * Math.PI / 4; r.push('M' + n2(50 + Math.cos(a) * 22) + ' ' + n2(53 + Math.sin(a) * 22) + ' L' + n2(50 + Math.cos(a) * 29) + ' ' + n2(53 + Math.sin(a) * 29)); }
      var t = many(r, 9); return { shapes: '<circle cx="50" cy="53" r="16"/>', extraO: t.o, extraF: t.f + dot(45, 50, 2.6, k) + dot(55, 50, 2.6, k) + ln('M44 58 Q50 63 56 58', k, 2.6) }; },
    palm: function (m, k) { var s = '', i, a = [-78, -42, 0, 42, 78], t = thick('M50 46 Q56 64 48 82', 11);
      for (i = 0; i < 5; i++) s += rot(a[i], 50, 46, '<path d="M50 46 Q62 34 50 17 Q38 34 50 46Z"/>');
      return { shapes: s, extraO: t.o, extraF: t.f, fAttr: ' stroke="' + k + '" stroke-width="1.6"' }; },
    wave: function () { var t = many(['M20 44 Q30 31 40 44 T60 44 T80 44', 'M20 62 Q30 49 40 62 T60 62 T80 62'], 13); return { shapes: '', extraO: t.o, extraF: t.f }; },
    shell: function (m, k) { return { shapes: '<path d="M50 78 L24 50 Q20 28 50 26 Q80 28 76 50Z"/><path d="M42 78 H58 L55 70 H45Z"/>', extraF: ln('M50 76 L50 32 M50 76 L35 36 M50 76 L65 36 M50 76 L27 50 M50 76 L73 50', k, 2.6) }; },
    starfish: function (m, k) { return { shapes: '<polygon points="' + starPts(50, 54, 30, 13, 5) + '" stroke-linejoin="round"/>', extraF: dot(50, 54, 3, k) + dot(50, 38, 2.3, k) + dot(65, 49, 2.3, k) + dot(59, 66, 2.3, k) + dot(41, 66, 2.3, k) + dot(35, 49, 2.3, k) }; },
    fish: function (m, k) { return { shapes: '<ellipse cx="44" cy="53" rx="23" ry="15"/><polygon points="62,53 82,38 82,68" stroke-linejoin="round"/>', extraF: dot(34, 49, 3.8, k) + ln('M50 41 Q56 53 50 65', k, 2.8) + ln('M30 59 Q35 62 38 60', k, 2.4) }; },
    umbrella: function (m, k) { var t = thick('M50 52 L50 76 Q50 82 44 80', 8); return { shapes: '<path d="M21 54 A29 29 0 0 1 79 54 Q71 46 64.5 54 Q57 46 50 54 Q43 46 35.5 54 Q29 46 21 54Z"/>', extraO: t.o, extraF: t.f + ln('M50 25 L38 52 M50 25 L62 52', k, 2.6) }; },
    anchor: function (m, k) { var t = many(['M50 38 L50 76', 'M38 48 L62 48', 'M26 62 Q28 77 50 77 Q72 77 74 62'], 11);
      return { shapes: '<circle cx="50" cy="31" r="7"/><circle cx="26" cy="59" r="5"/><circle cx="74" cy="59" r="5"/>', extraO: t.o, extraF: t.f + '<circle cx="50" cy="31" r="3" fill="' + m + '"/>' }; },
    lollipop: function (m, k) { var t = thick('M50 62 L50 84', 8); return { shapes: '<circle cx="50" cy="42" r="21"/>', extraO: t.o, extraF: t.f + ln('M50 42 Q56 42 56 37 Q56 30 48 30 Q38 30 38 41 Q38 54 51 54 Q65 54 65 40 Q65 26 50 24', k, 3) }; },
    cookie: function (m, k) { return { shapes: '<circle cx="50" cy="53" r="27"/>', extraF: dot(39, 42, 4.2, k) + dot(58, 40, 4, k) + dot(48, 56, 4.4, k) + dot(66, 58, 3.8, k) + dot(36, 65, 3.8, k) + dot(55, 69, 3.6, k) }; },
    wrapped: function (m, k) { return { shapes: '<ellipse cx="50" cy="53" rx="17" ry="14"/><polygon points="36,53 17,39 17,67" stroke-linejoin="round"/><polygon points="64,53 83,39 83,67" stroke-linejoin="round"/>', extraF: ln('M44 40 Q40 53 44 66 M56 40 Q60 53 56 66', k, 2.8) }; },
    icecream: function (m, k) { return { shapes: '<path d="M33 56 L67 56 L50 84Z" stroke-linejoin="round"/><circle cx="50" cy="42" r="18"/><ellipse cx="50" cy="55" rx="21" ry="7"/>', extraF: ln('M40 62 L54 74 M60 62 L46 74', k, 2.4) + '<circle cx="44" cy="36" r="3.4" fill="' + lighten(m, 0.5) + '"/>' }; },
    cupcake: function (m, k) { return { shapes: '<path d="M29 58 H71 L65 81 H35Z" stroke-linejoin="round"/><circle cx="37" cy="52" r="11"/><circle cx="63" cy="52" r="11"/><circle cx="50" cy="43" r="13"/>', extraF: ln('M41 62 L43 77 M50 62 V77 M59 62 L57 77', k, 2.4) + dot(50, 26, 5, k) }; },
    donut: function (m, k) { return { shapes: '<circle cx="50" cy="53" r="28"/>', extraF: '<circle cx="50" cy="53" r="9.5" fill="' + k + '"/>' + ln('M33 40 l6 -3 M60 33 l6 3 M69 55 l3 6 M33 66 l6 -4 M56 72 l5 2 M48 30 l1 6', k, 3.4) }; },
    popsicle: function (m, k) { var t = thick('M50 66 L50 84', 8); return { shapes: '<path d="M34 42 A16 16 0 0 1 66 42 V66 H34Z"/>', extraO: t.o, extraF: t.f + ln('M34 54 H66', k, 2.6) + ln('M42 34 V46', k, 3) }; },
    cherry: function (m, k) { var t = many(['M38 52 Q42 34 55 24', 'M64 50 Q60 34 55 24'], 9);
      return { shapes: '<circle cx="37" cy="64" r="13"/><circle cx="65" cy="62" r="13"/><ellipse cx="65" cy="25" rx="11" ry="5.5" transform="rotate(-20 65 25)"/>', extraO: t.o, extraF: t.f + dot(32, 59, 3, k) + dot(60, 57, 3, k) }; },
    choco: function (m, k) { return { shapes: '<path d="M31 27 H69 V79 H31Z" stroke-linejoin="round"/>', extraF: ln('M50 27 V79 M31 44.3 H69 M31 61.6 H69', k, 2.8) + '<path d="M31 27 H69 V35 H31Z" fill="' + k + '"/>' }; },
    mushroom: function (m, k) { return { shapes: '<path d="M21 52 A29 27 0 0 1 79 52Z"/><path d="M39 50 V72 Q50 82 61 72 V50Z"/>', extraF: dot(36, 42, 4.2, k) + dot(52, 33, 4.6, k) + dot(65, 44, 3.8, k) }; },
    leaf: function (m, k) { return { shapes: '<path d="M24 78 Q18 32 76 26 Q82 72 24 78Z"/>', extraF: ln('M26 76 Q48 54 68 34', k, 3) + ln('M44 58 L38 46 M54 48 L56 38', k, 2.4) }; },
    butterfly: function (m, k) { return { shapes: '<circle cx="34" cy="42" r="14"/><circle cx="66" cy="42" r="14"/><circle cx="38" cy="65" r="11"/><circle cx="62" cy="65" r="11"/>', extraO: '<ellipse cx="50" cy="55" rx="4" ry="18"/>', extraF: '<ellipse cx="50" cy="55" rx="4.2" ry="18" fill="' + k + '"/>' + ln('M48 38 Q44 29 38 26 M52 38 Q56 29 62 26', k, 2.6) + dot(32, 41, 4.5, lighten(m, 0.3)) + dot(68, 41, 4.5, lighten(m, 0.3)) }; },
    fox: function (m, k) { return { shapes: '<path d="M22 26 L41 41 Q50 39 59 41 L78 26 L77 56 Q70 80 50 82 Q30 80 23 56Z" stroke-linejoin="round"/>', extraF: '<path d="M22 26 L33 36 L25 44Z M78 26 L67 36 L75 44Z" fill="' + m + '"/>' + dot(39, 56, 3.8, k) + dot(61, 56, 3.8, k) + dot(50, 70, 4.4, k) }; },
    pine: function (m, k) { return { shapes: '<path d="M50 17 L65 39 H57 L71 59 H60 L75 76 H25 L40 59 H29 L43 39 H35Z" stroke-linejoin="round"/><path d="M44 76 H56 V85 H44Z"/>', extraF: '' }; },
    acorn: function (m, k) { return { shapes: '<path d="M31 46 Q33 76 50 82 Q67 76 69 46Z"/><path d="M50 30 V20" stroke-width="6"/>', extraF: '<path d="M26 47 Q24 26 50 28 Q76 26 74 47Z" fill="' + mix(m, k, 0.25) + '" stroke="' + k + '" stroke-width="2.6"/>' + ln('M36 37 L42 45 M50 33 V45 M64 37 L58 45', k, 2.2) }; },
    rocket: function (m, k) { return { shapes: '<path d="M50 16 Q70 32 67 62 H33 Q30 32 50 16Z"/><polygon points="34,48 20,72 36,64" stroke-linejoin="round"/><polygon points="66,48 80,72 64,64" stroke-linejoin="round"/>', extraF: '<circle cx="50" cy="40" r="8" fill="' + lighten(m, 0.35) + '" stroke="' + k + '" stroke-width="3"/><path d="M42 67 Q50 90 58 67Z" fill="#ffb020" stroke="' + k + '" stroke-width="2.4" stroke-linejoin="round"/>' }; },
    ufo: function (m, k) { return { shapes: '<path d="M33 52 A17 18 0 0 1 67 52Z"/><ellipse cx="50" cy="57" rx="30" ry="11"/>', extraF: '<path d="M39 49 A12 12 0 0 1 61 49Z" fill="' + lighten(m, 0.35) + '" stroke="' + k + '" stroke-width="2.4"/>' + dot(32, 58, 3, k) + dot(50, 61, 3, k) + dot(68, 58, 3, k) + ln('M38 72 L32 82 M62 72 L68 82', k, 3) }; },
    planet: function (m, k) { var o = '<ellipse cx="50" cy="54" rx="35" ry="11" transform="rotate(-22 50 54)" fill="none"'; return { shapes: '<circle cx="50" cy="54" r="19"/>', extraO: o + ' stroke-width="11"/>', extraF: o + ' stroke="#fff" stroke-width="5.5"/>' + '<path d="M33 49 Q50 42 67 49" fill="none" stroke="' + k + '" stroke-width="0"/>' + dot(48, 42, 2.4, k) }; },
    comet: function (m, k) { var t = many(['M54 50 L24 72', 'M62 54 L44 78', 'M52 40 L22 52'], 9); return { shapes: '<circle cx="66" cy="40" r="15"/>', extraO: t.o, extraF: t.f + dot(61, 36, 3, k) + dot(70, 45, 2.4, k) }; },
    sparkle: function () { return { shapes: '<path d="M46 20 Q48 46 74 51 Q48 56 46 82 Q44 56 18 51 Q44 46 46 20Z"/><path d="M76 20 Q77 28 85 29 Q77 30 76 38 Q75 30 67 29 Q75 28 76 20Z"/>' }; },
    alien: function (m, k) { return { shapes: '<path d="M50 22 C76 22 80 48 67 62 Q58 80 50 80 Q42 80 33 62 C20 48 24 22 50 22Z"/>', extraF: '<ellipse cx="38" cy="47" rx="6" ry="10" transform="rotate(25 38 47)" fill="' + k + '"/><ellipse cx="62" cy="47" rx="6" ry="10" transform="rotate(-25 62 47)" fill="' + k + '"/>' + ln('M45 68 H55', k, 2.6) }; },
    asteroid: function (m, k) { return { shapes: '<path d="M29 40 L45 24 L64 29 L78 46 L71 67 L52 80 L33 71 L22 54Z" stroke-linejoin="round"/>', extraF: '<circle cx="42" cy="44" r="6" fill="none" stroke="' + k + '" stroke-width="3"/><circle cx="62" cy="54" r="7" fill="none" stroke="' + k + '" stroke-width="3"/><circle cx="45" cy="66" r="4" fill="none" stroke="' + k + '" stroke-width="2.6"/>' }; },
    octopus: function (m, k) { var t = many(['M34 56 Q24 66 32 80', 'M44 60 Q40 70 46 82', 'M56 60 Q60 70 54 82', 'M66 56 Q76 66 68 80'], 11); return { shapes: '<circle cx="50" cy="42" r="21"/>', extraO: t.o, extraF: t.f + dot(42, 42, 3.8, k) + dot(58, 42, 3.8, k) + ln('M45 52 Q50 56 55 52', k, 2.4) }; },
    turtle: function (m, k) { return { shapes: '<ellipse cx="50" cy="55" rx="23" ry="21"/><circle cx="50" cy="26" r="9"/><circle cx="28" cy="38" r="6.5"/><circle cx="72" cy="38" r="6.5"/><circle cx="28" cy="71" r="6.5"/><circle cx="72" cy="71" r="6.5"/><path d="M50 76 L50 86" stroke-width="5"/>', extraF: '<polygon points="50,45 59,51 59,61 50,67 41,61 41,51" fill="none" stroke="' + k + '" stroke-width="3" stroke-linejoin="round"/>' + dot(46, 24, 2.2, k) + dot(54, 24, 2.2, k) }; },
    whale: function (m, k) { var t = many(['M44 38 V28', 'M44 30 Q38 24 33 26', 'M44 30 Q50 24 55 26'], 8); return { shapes: '<ellipse cx="42" cy="58" rx="26" ry="18"/><path d="M62 58 Q76 56 76 42 Q84 50 91 44 Q92 62 66 68Z" stroke-linejoin="round"/>', extraO: t.o, extraF: t.f + dot(27, 54, 3.4, k) + ln('M30 66 Q42 72 54 66', k, 2.6) }; },
    jellyfish: function (m, k) { var t = many(['M33 52 Q28 61 33 67 T33 82', 'M44 53 Q39 62 44 68 T44 84', 'M56 53 Q61 62 56 68 T56 84', 'M67 52 Q72 61 67 67 T67 82'], 7); return { shapes: '<path d="M24 52 A26 26 0 0 1 76 52Z"/>', extraO: t.o, extraF: t.f + dot(41, 43, 3.4, k) + dot(59, 43, 3.4, k) }; },
    lantern: function (m, k) { var t = many(['M50 31 V21', 'M50 74 V86'], 7);
      return { shapes: '<ellipse cx="50" cy="52" rx="24" ry="19"/><path d="M38 31 H62 V37 H38Z M40 68 H60 V74 H40Z" stroke-linejoin="round"/>', extraO: t.o, extraF: t.f + ln('M50 34 V70 M38 36 Q32 52 38 68 M62 36 Q68 52 62 68', k, 2.4) + dot(50, 86, 3.2, k) }; },
    firefly: function (m, k) { var wing = '<ellipse cx="35" cy="42" rx="11" ry="6.5" transform="rotate(-35 35 42)"/><ellipse cx="65" cy="42" rx="11" ry="6.5" transform="rotate(35 65 42)"/>';
      return { shapes: wing + '<circle cx="50" cy="30" r="8"/><ellipse cx="50" cy="48" rx="9" ry="11"/><circle cx="50" cy="69" r="13"/>', extraF: '<circle cx="50" cy="69" r="10" fill="#ffe84a" stroke="' + k + '" stroke-width="2.4"/>' + ln('M32 70 H25 M68 70 H75 M36 82 L30 87 M64 82 L70 87', '#e8a82a', 3) + dot(46, 29, 2, k) + dot(54, 29, 2, k) + ln('M45 23 L41 17 M55 23 L59 17', k, 2.2) }; },
    prism: function (m, k) { return { shapes: '<path d="M50 22 L78 72 H22Z" stroke-linejoin="round"/>', extraF: ln('M10 58 L40 52', k, 3) + ln('M60 50 L90 38', '#ff5c7a', 3.4) + ln('M62 56 L91 50', '#ffb020', 3.4) + ln('M63 62 L90 62', '#46d37f', 3.4) + ln('M62 68 L88 74', '#4aa8ff', 3.4) + ln('M50 34 L36 60', lighten(m, 0.5), 3) }; },
    crescentstar: function (m, k) { return { shapes: '<path d="' + moonPath(42, 54, 27, 56, 46, 22) + '"/><polygon points="' + starPts(72, 32, 13, 5.6, 5) + '" stroke-linejoin="round"/>', extraF: dot(34, 56, 2.2, k) + ln('M31 66 Q36 70 40 67', k, 2.2) }; },
    sunrise: function (m, k) { var r = [], i, a; for (i = 0; i < 5; i++) { a = (-150 + i * 30) * Math.PI / 180; r.push('M' + n2(50 + Math.cos(a) * 30) + ' ' + n2(66 + Math.sin(a) * 30) + ' L' + n2(50 + Math.cos(a) * 39) + ' ' + n2(66 + Math.sin(a) * 39)); }
      var t = many(r.concat(['M14 70 H86']), 8); return { shapes: '<path d="M27 70 A23 23 0 0 1 73 70Z"/>', extraO: t.o, extraF: t.f + ln('M38 80 H62', k, 3) + ln('M44 87 H56', k, 2.6) + dot(44, 61, 2.4, k) + dot(56, 61, 2.4, k) }; },
    bulb: function (m, k) { return { shapes: '<circle cx="50" cy="41" r="21"/><path d="M41 55 H59 L57 70 H43Z" stroke-linejoin="round"/><rect x="41" y="70" width="18" height="6" rx="2"/><rect x="44" y="76" width="12" height="6" rx="3"/>', extraF: ln('M43 56 L46 44 L50 51 L54 44 L57 56', k, 2.6) + ln('M41 62 H59 M42 67 H58', k, 2) + '<circle cx="42" cy="34" r="3.4" fill="' + lighten(m, 0.55) + '"/>' }; },
    cloudsun: function (m, k) { var cl = '<ellipse cx="45" cy="66" rx="27" ry="12"/><circle cx="34" cy="58" r="12"/><circle cx="53" cy="54" r="14"/>', i, a, r = '';
      for (i = 0; i < 8; i++) { a = i * Math.PI / 4; r += 'M' + n2(66 + Math.cos(a) * 15) + ' ' + n2(32 + Math.sin(a) * 15) + ' L' + n2(66 + Math.cos(a) * 20) + ' ' + n2(32 + Math.sin(a) * 20); }
      return { shapes: cl + '<circle cx="66" cy="32" r="12"/>', extraF: '<circle cx="66" cy="32" r="10" fill="#ffd23a" stroke="' + k + '" stroke-width="2.2"/>' + ln(r, '#e8a82a', 3) + '<g fill="#fff" stroke="' + k + '" stroke-width="2.6">' + cl + '</g><path d="M26 66 H64" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' + dot(40, 62, 2.4, k) + dot(52, 62, 2.4, k) + ln('M42 68 Q46 71 50 68', k, 2.2) }; },
    eclipse: function (m, k) { return { shapes: '<circle cx="50" cy="53" r="28"/><path d="M76 20 Q77 27 84 28 Q77 29 76 36 Q75 29 68 28 Q75 27 76 20Z"/>', extraF: '<circle cx="50" cy="53" r="19" fill="' + k + '"/><path d="M33 47 A19 19 0 0 1 47 35" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>' + dot(24, 70, 2.2, k) + dot(30, 79, 1.8, k) }; },
    seahorse: function (m, k) { var t = thick('M52 40 Q38 52 50 62 Q60 70 50 78 Q42 82 38 74', 15); return { shapes: '<circle cx="54" cy="32" r="12"/><path d="M62 30 L80 33 L64 40Z" stroke-linejoin="round"/><path d="M42 36 L34 30 L40 44Z" stroke-linejoin="round"/>', extraO: t.o, extraF: t.f + dot(56, 29, 3.2, k) + ln('M45 52 Q52 56 47 62', k, 2.2) }; }
  };
  function pattern(shape, main) {
    var i, a, s = '';
    if (G[shape]) return G[shape](main, darken(main, 0.5));
    switch (shape) {
      case 'heart':
        return { shapes: '<path d="M50 76 C27 60 23 49 25 41 C27 31 41 29 50 41 C59 29 73 31 75 41 C77 49 73 60 50 76Z"/>' };
      case 'star':
        return { shapes: '<polygon points="' + starPts(50, 53, 28, 12.5, 5) + '"/>' };
      case 'clover':
        for (i = 0; i < 4; i++) {
          s += '<path transform="translate(50 47) rotate(' + (45 + i * 90) + ') scale(1.02)" d="M0 0 C-17 -9 -16 -25 -8 -27 C-3 -28 0 -25 0 -22 C0 -25 3 -28 8 -27 C16 -25 17 -9 0 0Z"/>';
        }
        return {
          shapes: s,
          extraO: '<path d="M50 52 Q51 66 44 78" fill="none" stroke-width="10"/>',
          extraF: '<path d="M50 52 Q51 66 44 78" fill="none" stroke="#fff" stroke-width="4.5"/>',
          fAttr: ' stroke="' + mix(main, '#14663a', 0.55) + '" stroke-width="2.2"'
        };
      case 'drop':
        return {
          shapes: '<path d="M50 23 C50 23 31 46 31 59 A19 19 0 0 0 69 59 C69 46 50 23 50 23Z"/>',
          extraF: '<path d="M41 58 Q41 66 47 70" fill="none" stroke="' + lighten(main, 0.45) + '" stroke-width="4"/>'
        };
      case 'moon':
        return { shapes: '<path d="' + moonPath(48, 52, 26, 63, 44, 21) + '"/>' };
      case 'diamond':
        return { shapes: '<path d="M50 24 L74 53 L50 80 L26 53Z" stroke-linejoin="round"/>', extraF: '<path d="M50 24 L50 80 M26 53 L74 53" stroke="' + lighten(main, 0.45) + '" stroke-width="2.4" fill="none"/>' };
      case 'smile':
        return {
          shapes: '<circle cx="50" cy="53" r="27"/>',
          extraF: '<circle cx="41" cy="47" r="3.6" fill="' + darken(main, 0.5) + '"/><circle cx="59" cy="47" r="3.6" fill="' + darken(main, 0.5) + '"/><path d="M38 59 Q50 72 62 59" fill="none" stroke="' + darken(main, 0.5) + '" stroke-width="3.6" stroke-linecap="round"/>'
        };
      case 'paw':
        return {
          shapes: '<ellipse cx="50" cy="62" rx="15" ry="12.5"/><circle cx="30" cy="48" r="7.5"/><circle cx="42" cy="36" r="7.5"/><circle cx="58" cy="36" r="7.5"/><circle cx="70" cy="48" r="7.5"/>'
        };
      case 'flower':
        for (i = 0; i < 5; i++) {
          a = -Math.PI / 2 + i * 2 * Math.PI / 5;
          s += '<circle cx="' + n2(50 + Math.cos(a) * 15.5) + '" cy="' + n2(53 + Math.sin(a) * 15.5) + '" r="12.5"/>';
        }
        return {
          shapes: s,
          extraO: '<circle cx="50" cy="53" r="10.5"/>',
          extraF: '<circle cx="50" cy="53" r="9" fill="#ffc83a" stroke="' + darken(main, 0.45) + '" stroke-width="2"/>',
          fAttr: ' stroke="' + lighten(main, 0.3) + '" stroke-width="1.2"'
        };
    }
    return { shapes: '' };
  }

  // 星星徽章（mod=1）
  function starBadge(p, cx, cy, r) {
    return '<g>' +
      '<polygon points="' + starPts(cx, cy, r, r * 0.5, 5) + '" fill="url(#' + p + 'gold)" stroke="#b86a08" stroke-width="3" stroke-linejoin="round"/>' +
      '<polygon points="' + starPts(cx - r * 0.12, cy - r * 0.12, r * 0.5, r * 0.22, 5) + '" fill="#fff" opacity="0.55"/>' +
      '</g>';
  }
  // 「3」金幣徽章（mod=2）
  function coinBadge(p, cx, cy, r) {
    return '<g>' +
      '<circle cx="' + cx + '" cy="' + (cy + 1.5) + '" r="' + r + '" fill="#2a1240" opacity="0.25"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#' + p + 'gold)" stroke="#b86a08" stroke-width="3"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 4.5) + '" fill="none" stroke="#fff3b0" stroke-width="1.6" opacity="0.9"/>' +
      '<text x="' + cx + '" y="' + (cy + 8.2) + '" text-anchor="middle" font-family=\'' + FONT + '\' font-size="23" font-weight="900" ' +
      'fill="#fff" stroke="#a85a00" stroke-width="3" paint-order="stroke" stroke-linejoin="round">3</text>' +
      '</g>';
  }
  function goldDefs(p) {
    return lg(p + 'gold', 0, 0, 1, 1, [[0, '#fff3a0'], [0.5, '#ffd23a'], [1, '#ff9f1c']]);
  }

  Art.bubbleSVG = function (colorId, opt) {
    var c = COLORS[colorId] || COLORS[1];
    var mod = (opt && opt.mod) || 0;
    var set = (opt && opt.set && Art.SETS[opt.set]) ? opt.set : 'default';
    var m = c.main, dk = darken(m, 0.5), edge = darken(m, 0.38);
    var p = 'bub' + c.id + 'm' + mod + (set === 'default' ? '' : set) + '-';
    var pt = pattern(Art.SETS[set][c.id] || c.shape, m);
    var defs =
      rg(p + 'body', 0.38, 0.3, 0.85, [[0, lighten(m, 0.6), 0.92], [0.4, lighten(m, 0.12), 0.9], [1, darken(m, 0.22), 0.96]]) +
      rg(p + 'rim', 0.5, 0.5, 0.5, [[0.72, '#fff', 0], [1, '#fff', 0.5]]) +
      (mod ? goldDefs(p) : '');
    var tf = mod ? ' transform="translate(46 54) scale(0.84) translate(-50 -53)"' : '';
    var pat =
      '<g' + tf + '>' +
      '<g fill="' + dk + '" stroke="' + dk + '" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">' + pt.shapes + (pt.extraO || '') + '</g>' +
      '<g fill="#fff"' + (pt.fAttr || '') + '>' + pt.shapes + '</g>' + (pt.extraF || '') +
      '</g>';
    var body =
      '<circle cx="50" cy="50" r="44" fill="url(#' + p + 'body)" stroke="' + edge + '" stroke-width="3"/>' +
      '<circle cx="50" cy="50" r="42.5" fill="url(#' + p + 'rim)"/>' +
      '<path d="M22 64 Q50 94 78 64 Q50 80 22 64Z" fill="#fff" opacity="0.38"/>' +
      pat +
      '<ellipse cx="31" cy="26" rx="12" ry="7" transform="rotate(-38 31 26)" fill="#fff" opacity="0.88"/>' +
      '<circle cx="19" cy="42" r="2.6" fill="#fff" opacity="0.8"/>';
    if (mod === 1) body += starBadge(p, 50, 17, 15);
    if (mod === 2) body += coinBadge(p, 77, 77, 17);
    return svgWrap('0 0 100 100', '<defs>' + defs + '</defs>' + body);
  };

  // ───────────── 2. 特殊泡泡 ─────────────
  function sparkle(x, y, r, op) {
    return '<path d="M' + x + ' ' + (y - r) + ' Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y + r) +
      ' Q' + x + ' ' + y + ' ' + (x - r) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y - r) + 'Z" fill="#fff" opacity="' + (op || 1) + '"/>';
  }
  function arcPath(cx, cy, r, a0, a1) {
    var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    return 'M' + n2(x0) + ' ' + n2(y0) + ' A' + r + ' ' + r + ' 0 ' + ((a1 - a0) > Math.PI ? 1 : 0) + ' 1 ' + n2(x1) + ' ' + n2(y1);
  }

  Art.specialBubbleSVG = function (kind) {
    var p = 'sp' + kind + '-', defs = '', s = '', i;
    if (kind === 'rainbow') {
      var rc = ['#ff5c7a', '#ff9a3c', '#ffcf3a', '#46d37f', '#4aa8ff', '#a678ff'];
      defs = rg(p + 'in', 0.4, 0.35, 0.8, [[0, '#ffffff'], [0.6, '#f3ecff'], [1, '#d9e8ff']]) +
        rg(p + 'rim', 0.5, 0.5, 0.5, [[0.8, '#fff', 0], [1, '#fff', 0.45]]);
      s += '<circle cx="50" cy="50" r="44" fill="#2a1240" opacity="0.12"/>';
      s += '<circle cx="50" cy="50" r="44" fill="url(#' + p + 'in)" stroke="#6a4a9a" stroke-width="3"/>';
      for (i = 0; i < 6; i++) {
        var a0 = -Math.PI / 2 + i * Math.PI / 3 - 0.03, a1 = a0 + Math.PI / 3 + 0.06;
        s += '<path d="' + arcPath(50, 50, 33, a0, a1) + '" fill="none" stroke="' + rc[i] + '" stroke-width="13"/>';
      }
      s += '<circle cx="50" cy="50" r="39.5" fill="none" stroke="#6a4a9a" stroke-width="1.6" opacity="0.7"/>';
      s += '<circle cx="50" cy="50" r="26.5" fill="none" stroke="#6a4a9a" stroke-width="1.6" opacity="0.7"/>';
      s += '<circle cx="50" cy="50" r="25" fill="url(#' + p + 'in)" opacity="0.9"/>';
      s += '<g transform="translate(50 50)"><polygon points="' + starPts(0, 0, 13, 5.5, 4, -Math.PI / 2) + '" fill="#fff" stroke="#a678ff" stroke-width="2.2" stroke-linejoin="round"/></g>';
      s += '<ellipse cx="30" cy="25" rx="11" ry="6" transform="rotate(-38 30 25)" fill="#fff" opacity="0.9"/>';
      s += sparkle(78, 26, 9) + sparkle(24, 76, 6, 0.95) + sparkle(80, 72, 4.5, 0.85);
      s += '<circle cx="50" cy="50" r="43" fill="url(#' + p + 'rim)"/>';
    } else if (kind === 'star') { // 星星泡泡：不是圓形！整顆就是一顆大金星（外形與所有圓泡泡不同），外圍有爆炸光環
      defs = lg(p + 'body', 0.2, 0, 0.8, 1, [[0, '#fff7a8'], [0.5, '#ffcf1f'], [1, '#ff9a0a']]);
      s += '<circle cx="50" cy="52" r="45" fill="#ffb347" opacity="0.38"/>';
      s += '<circle cx="50" cy="52" r="45" fill="none" stroke="#ff7a1c" stroke-width="2.6" stroke-dasharray="3 6" stroke-linecap="round" opacity="0.85"/>';
      var big = starPts(50, 53, 47, 22, 5);
      s += '<polygon points="' + big + '" fill="#b84a00" stroke="#b84a00" stroke-width="10" stroke-linejoin="round"/>';
      s += '<polygon points="' + big + '" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>';
      s += '<polygon points="' + big + '" fill="url(#' + p + 'body)" stroke="#ff8a00" stroke-width="3" stroke-linejoin="round"/>';
      s += '<polygon points="' + starPts(50, 54, 25, 12, 5) + '" fill="#fff3a0" stroke="#ffb41f" stroke-width="2" stroke-linejoin="round" opacity="0.95"/>';
      s += '<ellipse cx="38" cy="38" rx="7" ry="3.6" transform="rotate(-40 38 38)" fill="#fff" opacity="0.95"/>';
      s += sparkle(86, 16, 8) + sparkle(12, 84, 6.5) + sparkle(88, 78, 5);
    } else if (kind === 'laser') { // 閃電泡泡：深藍泡泡＋中央大閃電＋上下左右四個箭頭（十字雷射）
      defs = rg(p + 'in', 0.4, 0.3, 0.9, [[0, '#8fb0ff'], [0.55, '#4a5fe0'], [1, '#262a8c']]) +
        rg(p + 'glow', 0.5, 0.5, 0.5, [[0, '#fff6a8', 0.9], [1, '#ffd23a', 0]]);
      s += '<circle cx="50" cy="50" r="44" fill="#2a1240" opacity="0.15"/>';
      s += '<circle cx="50" cy="50" r="44" fill="url(#' + p + 'in)" stroke="#1b1f6e" stroke-width="3.5"/>';
      s += '<circle cx="50" cy="50" r="40" fill="none" stroke="#bcd0ff" stroke-width="1.8" opacity="0.6"/>';
      s += '<path d="M26 50 H74 M50 26 V74" stroke="#bfe6ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7" opacity="0.9"/>';
      var ar = ['M13 50 L27 37 V44 H31 V56 H27 V63Z', 'M87 50 L73 37 V44 H69 V56 H73 V63Z', 'M50 13 L37 27 H44 V31 H56 V27 H63Z', 'M50 87 L37 73 H44 V69 H56 V73 H63Z'];
      for (i = 0; i < 4; i++) s += '<path d="' + ar[i] + '" fill="#ffffff" stroke="#1b1f6e" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>';
      s += '<circle cx="50" cy="50" r="20" fill="url(#' + p + 'glow)"/>';
      var bolt = 'M57 22 L35 54 H48 L41 80 L66 44 H52 Z';
      s += '<g transform="translate(50 51) scale(0.62) translate(-50 -51)"><path d="' + bolt + '" fill="#ffe14a" stroke="#fff" stroke-width="9" stroke-linejoin="round"/>';
      s += '<path d="' + bolt + '" fill="#ffd21f" stroke="#b86a00" stroke-width="3.8" stroke-linejoin="round"/></g>';
      s += '<ellipse cx="31" cy="27" rx="9" ry="5" transform="rotate(-38 31 27)" fill="#fff" opacity="0.55"/>';
    } else { // cloud 雲朵磚：圓角方塊感，看起來推不動
      defs = lg(p + 'f', 0, 0, 0, 1, [[0, '#ffffff'], [0.65, '#f4f8ff'], [1, '#dbe6f7']]);
      var shapes = '<rect x="10" y="36" width="80" height="50" rx="22"/><circle cx="33" cy="42" r="19"/><circle cx="58" cy="34" r="23"/><circle cx="76" cy="48" r="15"/>';
      s += '<ellipse cx="50" cy="90" rx="38" ry="5" fill="#2a1240" opacity="0.14"/>';
      s += '<g fill="#9db4d4" stroke="#9db4d4" stroke-width="7" stroke-linejoin="round">' + shapes + '</g>';
      s += '<g fill="url(#' + p + 'f)">' + shapes + '</g>';
      s += '<path d="M24 78 Q50 86 76 78" fill="none" stroke="#c8d8ee" stroke-width="5" stroke-linecap="round" opacity="0.8"/>';
      s += '<path d="M24 31 Q32 22 42 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>';
      // 睡著的小臉（表示它不會動）
      s += '<path d="M33 62 Q38 67 43 62 M57 62 Q62 67 67 62" fill="none" stroke="#7d93b8" stroke-width="3" stroke-linecap="round"/>';
      s += '<path d="M46 71 Q50 74.5 54 71" fill="none" stroke="#7d93b8" stroke-width="2.6" stroke-linecap="round"/>';
      s += '<ellipse cx="28" cy="70" rx="5" ry="3" fill="#ffb3c6" opacity="0.7"/><ellipse cx="72" cy="70" rx="5" ry="3" fill="#ffb3c6" opacity="0.7"/>';
    }
    return svgWrap('0 0 100 100', '<defs>' + defs + '</defs>' + s);
  };

  // ───────────── 3. 彩虹砲 ─────────────
  Art.cannonSVG = function () {
    var p = 'cn-', rc = ['#ff5c7a', '#ff9a3c', '#ffcf3a', '#46d37f', '#4aa8ff', '#a678ff'], i, s = '';
    var defs =
      lg(p + 'wood', 0, 0, 1, 0, [[0, '#e0a05a'], [0.35, '#f6c17c'], [0.7, '#d98f45'], [1, '#b8692c']]) +
      lg(p + 'wood2', 0, 0, 0, 1, [[0, '#f6c17c'], [1, '#c97c38']]) +
      lg(p + 'gold', 0, 0, 1, 1, [[0, '#fff3a0'], [0.5, '#ffd23a'], [1, '#ff9f1c']]);
    var ol = '#5a2d12';
    // 底座（輪子在後）
    s += '<ellipse cx="50" cy="154" rx="40" ry="5" fill="#2a1240" opacity="0.18"/>';
    s += '<circle cx="24" cy="138" r="15" fill="url(#' + p + 'wood2)" stroke="' + ol + '" stroke-width="3.5"/>';
    s += '<circle cx="76" cy="138" r="15" fill="url(#' + p + 'wood2)" stroke="' + ol + '" stroke-width="3.5"/>';
    s += '<circle cx="24" cy="138" r="5.5" fill="url(#' + p + 'gold)" stroke="' + ol + '" stroke-width="2"/>';
    s += '<circle cx="76" cy="138" r="5.5" fill="url(#' + p + 'gold)" stroke="' + ol + '" stroke-width="2"/>';
    s += '<path d="M24 124 V152 M10 138 H38 M76 124 V152 M62 138 H90" stroke="' + ol + '" stroke-width="2" opacity="0.5"/>';
    // 砲身（短胖款：砲口不會超過盤面的底線）
    s += '<rect x="36" y="46" width="28" height="68" rx="6" fill="url(#' + p + 'wood)" stroke="' + ol + '" stroke-width="3.5"/>';
    // 彩虹條紋（砲身中段）
    for (i = 0; i < 6; i++) {
      s += '<rect x="36" y="' + (56 + i * 6.5) + '" width="28" height="6.5" fill="' + rc[i] + '"/>';
    }
    s += '<rect x="36" y="56" width="28" height="39" fill="none" stroke="' + ol + '" stroke-width="2"/>';
    s += '<path d="M42 52 V108" stroke="#fff" stroke-width="3" opacity="0.35" stroke-linecap="round"/>';
    // 砲口環
    s += '<rect x="31" y="38" width="38" height="16" rx="7" fill="url(#' + p + 'gold)" stroke="' + ol + '" stroke-width="3.5"/>';
    s += '<rect x="38" y="41" width="24" height="5" rx="2.5" fill="#fff" opacity="0.5"/>';
    // 後環
    s += '<rect x="33" y="98" width="34" height="9" rx="4" fill="url(#' + p + 'gold)" stroke="' + ol + '" stroke-width="3"/>';
    // 底座木箱（旋轉中心周圍）
    s += '<path d="M14 118 Q14 104 30 104 H70 Q86 104 86 118 V140 Q86 150 76 150 H24 Q14 150 14 140Z" fill="url(#' + p + 'wood2)" stroke="' + ol + '" stroke-width="3.5"/>';
    s += '<path d="M20 120 Q50 132 80 120" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.35" stroke-linecap="round"/>';
    // 底座上的彩虹小弧
    for (i = 0; i < 4; i++) {
      s += '<path d="M' + (28 + i * 2.5) + ' 146 A' + (22 - i * 2.5) + ' ' + (22 - i * 2.5) + ' 0 0 1 ' + (72 - i * 2.5) + ' 146" fill="none" stroke="' + rc[i] + '" stroke-width="2.6" opacity="0"/>';
    }
    s += '<path d="M26 146 A24 24 0 0 1 74 146" fill="none" stroke="#ff5c7a" stroke-width="3.2"/>' +
         '<path d="M31 146 A19 19 0 0 1 69 146" fill="none" stroke="#ffcf3a" stroke-width="3.2"/>' +
         '<path d="M36 146 A14 14 0 0 1 64 146" fill="none" stroke="#4aa8ff" stroke-width="3.2"/>';
    // 旋轉軸心
    s += '<circle cx="50" cy="110" r="12" fill="url(#' + p + 'gold)" stroke="' + ol + '" stroke-width="3.5"/>';
    s += '<circle cx="50" cy="110" r="4.5" fill="#fff" stroke="' + ol + '" stroke-width="2"/>';
    return svgWrap('0 0 100 160', '<defs>' + defs + '</defs>' + s);
  };

  // ───────────── 4. 主題色票 ─────────────
  Art.THEMES = [
    { id: 0, name: '彩虹草原', sky: ['#8fd6ff', '#e9f9ff'], frame: ['#8fe39a', '#3fa863'], boardFill: 'rgba(255,255,255,0.72)', boardLine: '#7ccf8a', accent: '#ff7aa8', music: 'a', set: 'default' },
    { id: 1, name: '暖暖海灘', sky: ['#7fdcff', '#fff3d2'], frame: ['#ffd88a', '#e09a3c'], boardFill: 'rgba(255,255,255,0.74)', boardLine: '#f0b960', accent: '#ff8a5c', music: 'b', set: 'beach' },
    { id: 2, name: '糖果山', sky: ['#ffbfe0', '#fff2fa'], frame: ['#ff9ccb', '#d9569a'], boardFill: 'rgba(255,255,255,0.76)', boardLine: '#ff9ccb', accent: '#c06bff', music: 'c', set: 'candy' },
    { id: 3, name: '童話森林', sky: ['#bdeecb', '#fbffe0'], frame: ['#9bd47a', '#4d8f3c'], boardFill: 'rgba(255,255,250,0.76)', boardLine: '#8cc66b', accent: '#ffa63c', music: 'd', set: 'forest' },
    { id: 4, name: '星星夜空', sky: ['#252a7a', '#8a6ee0'], frame: ['#b9a6ff', '#5a46b8'], boardFill: 'rgba(255,255,255,0.86)', boardLine: '#a58cf5', accent: '#ffd23a', music: 'e', set: 'night' },
    { id: 5, name: '海底世界', sky: ['#62d6f5', '#1a7ec6'], frame: ['#7fe0ee', '#2a8fb8'], boardFill: 'rgba(255,255,255,0.80)', boardLine: '#6cc8e6', accent: '#ff7a6b', music: 'f', set: 'ocean' },
    { id: 6, name: '日月光', sky: ['#2c2a7a', '#f08a4c'], frame: ['#ffd36a', '#a8672a'], boardFill: 'rgba(255,252,244,0.84)', boardLine: '#e0a850', accent: '#ff8a3c', music: 'g', set: 'sunmoon' }
  ];

  // ───────────── 5. 背景共用裝飾 ─────────────
  function wave(y0, amp, wl, ph, bottom, step) {          // 起伏的地平線，封到畫面底部
    var d = 'M0 ' + bottom + ' L0 ' + n2(y0 + Math.sin(ph) * amp), x;
    step = step || 20;
    for (x = 0; x <= 1600; x += step) d += ' L' + x + ' ' + n2(y0 + Math.sin(x / wl + ph) * amp + Math.sin(x / (wl * 0.43) + ph * 2) * amp * 0.3);
    return d + ' L1600 ' + bottom + 'Z';
  }
  function cloud(x, y, s, fill, op) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="' + fill + '" opacity="' + (op === undefined ? 0.95 : op) + '">' +
      '<ellipse cx="0" cy="6" rx="70" ry="22"/><circle cx="-30" cy="-8" r="26"/><circle cx="10" cy="-20" r="32"/><circle cx="44" cy="-4" r="22"/></g>';
  }
  function flower(x, y, s, col, ctr) {
    var o = '', i;
    for (i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
      o += '<circle cx="' + n2(Math.cos(a) * 9) + '" cy="' + n2(Math.sin(a) * 9) + '" r="8"/>';
    }
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M0 0 V34" stroke="#3fa863" stroke-width="4" stroke-linecap="round"/><g fill="' + col + '">' + o + '</g><circle r="6.5" fill="' + (ctr || '#ffe066') + '"/></g>';
  }
  function bubbles(r, count, xr, yr, col) {                // 小氣泡裝飾
    var o = '', i;
    for (i = 0; i < count; i++) {
      var x = xr[0] + r() * (xr[1] - xr[0]), y = yr[0] + r() * (yr[1] - yr[0]), rr = 4 + r() * 12;
      o += '<circle cx="' + n2(x) + '" cy="' + n2(y) + '" r="' + n2(rr) + '" fill="' + col + '" fill-opacity="0.18" stroke="' + col + '" stroke-opacity="0.7" stroke-width="2"/>' +
        '<circle cx="' + n2(x - rr * 0.35) + '" cy="' + n2(y - rr * 0.35) + '" r="' + n2(rr * 0.22) + '" fill="#fff" opacity="0.8"/>';
    }
    return o;
  }
  function sideX(r, left) {                                // 取左側或右側邊緣的 x（避開中央）
    return left ? 40 + r() * 330 : 1230 + r() * 330;
  }
  function palm(x, y, s, flip) {
    var leaves = '', i;
    for (i = 0; i < 7; i++) {
      leaves += '<path d="M0 0 Q40 -30 95 -5 Q50 -8 0 6Z" fill="#3fbf6a" stroke="#217a42" stroke-width="3" stroke-linejoin="round" transform="rotate(' + (-170 + i * 30) + ')"/>';
    }
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (flip ? -s : s) + ' ' + s + ')">' +
      '<path d="M0 0 Q-30 -140 20 -270" fill="none" stroke="#7a4a22" stroke-width="30" stroke-linecap="round"/>' +
      '<path d="M0 0 Q-30 -140 20 -270" fill="none" stroke="#c98a4a" stroke-width="22" stroke-linecap="round"/>' +
      '<path d="M-6 -60 l22 -4 M-14 -120 l24 -2 M-6 -180 l22 4" stroke="#7a4a22" stroke-width="3" stroke-linecap="round"/>' +
      '<g transform="translate(20 -270)">' + leaves + '<circle cx="-8" cy="8" r="11" fill="#8a5a2a" stroke="#5a3414" stroke-width="3"/><circle cx="10" cy="10" r="11" fill="#8a5a2a" stroke="#5a3414" stroke-width="3"/></g></g>';
  }
  function fish(x, y, s, col, flip) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (flip ? -s : s) + ' ' + s + ')">' +
      '<path d="M-34 0 L-56 -16 L-56 16Z" fill="' + col + '" stroke="' + darken(col, 0.4) + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<ellipse cx="0" cy="0" rx="38" ry="24" fill="' + col + '" stroke="' + darken(col, 0.4) + '" stroke-width="3"/>' +
      '<path d="M-8 -22 Q0 -34 14 -22Z" fill="' + darken(col, 0.15) + '"/>' +
      '<path d="M-6 -20 Q-14 0 -6 20" fill="none" stroke="#fff" stroke-width="5" opacity="0.6"/>' +
      '<circle cx="18" cy="-5" r="6" fill="#fff"/><circle cx="19.5" cy="-5" r="3" fill="#2a1240"/>' +
      '<path d="M26 8 Q30 10 33 7" fill="none" stroke="' + darken(col, 0.4) + '" stroke-width="2.4" stroke-linecap="round"/></g>';
  }
  function mushroom(x, y, s, col) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path d="M-12 0 Q-14 -22 -10 -26 H10 Q14 -22 12 0Z" fill="#fff4e0" stroke="#a87c5a" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M-38 -24 Q-36 -62 0 -62 Q36 -62 38 -24Q0 -16 -38 -24Z" fill="' + col + '" stroke="' + darken(col, 0.4) + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<circle cx="-16" cy="-42" r="6" fill="#fff"/><circle cx="12" cy="-48" r="5" fill="#fff"/><circle cx="22" cy="-34" r="4" fill="#fff"/></g>';
  }
  function lollipop(x, y, s, c1, c2) {
    var o = '', i;
    for (i = 5; i >= 1; i--) o += '<circle r="' + (i * 9) + '" fill="none" stroke="' + (i % 2 ? c1 : c2) + '" stroke-width="9"/>';
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<rect x="-4" y="0" width="8" height="190" rx="4" fill="#fff" stroke="#d9a0c0" stroke-width="3"/>' +
      '<circle r="48" fill="' + c2 + '" stroke="' + darken(c1, 0.35) + '" stroke-width="4"/>' + o +
      '<circle r="48" fill="none" stroke="' + darken(c1, 0.35) + '" stroke-width="4"/>' +
      '<ellipse cx="-18" cy="-20" rx="10" ry="5" transform="rotate(-40 -18 -20)" fill="#fff" opacity="0.7"/></g>';
  }
  function candyCane(x, y, s, flip) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (flip ? -s : s) + ' ' + s + ')">' +
      '<path d="M0 0 V-120 A28 28 0 0 1 56 -120" fill="none" stroke="#d9569a" stroke-width="26" stroke-linecap="round"/>' +
      '<path d="M0 0 V-120 A28 28 0 0 1 56 -120" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/>' +
      '<path d="M0 0 V-120 A28 28 0 0 1 56 -120" fill="none" stroke="#ff5c8a" stroke-width="20" stroke-dasharray="14 16" />' +
      '</g>';
  }
  function gumdrop(x, y, s, col) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path d="M-34 0 Q-34 -46 0 -46 Q34 -46 34 0Z" fill="' + col + '" stroke="' + darken(col, 0.4) + '" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<ellipse cx="-12" cy="-30" rx="8" ry="4" transform="rotate(-35 -12 -30)" fill="#fff" opacity="0.7"/>' +
      '<g fill="#fff" opacity="0.6"><circle cx="-14" cy="-12" r="2.2"/><circle cx="4" cy="-20" r="2.2"/><circle cx="16" cy="-8" r="2.2"/><circle cx="-2" cy="-6" r="2.2"/></g></g>';
  }
  function sprinkle(x, y, a, c) {
    return '<rect x="-7" y="-2.5" width="14" height="5" rx="2.5" fill="' + c + '" transform="translate(' + x + ' ' + y + ') rotate(' + a + ')"/>';
  }
  function tree(x, y, s, c1, c2) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<path d="M-14 0 L-10 -90 H10 L14 0Z" fill="#a8703a" stroke="#6a4020" stroke-width="3.5" stroke-linejoin="round"/>' +
      '<circle cx="0" cy="-130" r="62" fill="' + c1 + '" stroke="' + c2 + '" stroke-width="4"/>' +
      '<circle cx="-38" cy="-98" r="40" fill="' + c1 + '" stroke="' + c2 + '" stroke-width="4"/>' +
      '<circle cx="40" cy="-100" r="42" fill="' + c1 + '" stroke="' + c2 + '" stroke-width="4"/>' +
      '<circle cx="0" cy="-130" r="58" fill="' + c1 + '"/><circle cx="-38" cy="-98" r="36" fill="' + c1 + '"/><circle cx="40" cy="-100" r="38" fill="' + c1 + '"/>' +
      '<ellipse cx="-20" cy="-152" rx="20" ry="10" transform="rotate(-30 -20 -152)" fill="#fff" opacity="0.28"/></g>';
  }
  function seaweed(x, y, h, col, s) {
    var d = 'M' + x + ' ' + y, k, dir = 1, steps = Math.round(h / 40);
    for (k = 1; k <= steps; k++) { d += ' Q' + (x + dir * 22 * s) + ' ' + (y - k * 40 + 20) + ' ' + x + ' ' + (y - k * 40); dir = -dir; }
    return '<path d="' + d + '" fill="none" stroke="' + darken(col, 0.3) + '" stroke-width="20" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="13" stroke-linecap="round"/>';
  }
  function coral(x, y, s, col) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="none" stroke-linecap="round">' +
      '<path d="M0 0 V-70 M0 -30 L-26 -62 M0 -44 L24 -80 M-26 -62 V-86 M24 -80 V-104" stroke="' + darken(col, 0.35) + '" stroke-width="20"/>' +
      '<path d="M0 0 V-70 M0 -30 L-26 -62 M0 -44 L24 -80 M-26 -62 V-86 M24 -80 V-104" stroke="' + col + '" stroke-width="13"/></g>';
  }
  function starfish(x, y, s, col, rot) {
    return '<g transform="translate(' + x + ' ' + y + ') rotate(' + (rot || 0) + ') scale(' + s + ')"><polygon points="' + starPts(0, 0, 30, 14, 5) + '" fill="' + col + '" stroke="' + darken(col, 0.4) + '" stroke-width="4" stroke-linejoin="round"/>' +
      '<g fill="#fff" opacity="0.6"><circle cx="0" cy="-12" r="2.4"/><circle cx="11" cy="-3" r="2.4"/><circle cx="7" cy="9" r="2.4"/><circle cx="-7" cy="9" r="2.4"/><circle cx="-11" cy="-3" r="2.4"/></g></g>';
  }

  // ───────────── 6. 七套背景 ─────────────
  function bg0(p) {   // 彩虹草原
    var r = rng(11), s = '', i, rc = ['#ff6b8a', '#ffa64d', '#ffd84a', '#5fd98a', '#58b2ff', '#b088ff'];
    var defs = lg(p + 'sky', 0, 0, 0, 1, [[0, '#8fd6ff'], [1, '#eafaff']]) + rg(p + 'sun', 0.5, 0.5, 0.5, [[0, '#fff6b0', 1], [0.45, '#ffe680', 0.55], [1, '#ffe680', 0]]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    s += '<circle cx="190" cy="150" r="150" fill="url(#' + p + 'sun)"/><circle cx="190" cy="150" r="62" fill="#ffe36a" stroke="#ffc83a" stroke-width="5"/>';
    for (i = 0; i < 6; i++) s += '<path d="M' + (1130 + i * 14) + ' 760 A' + (300 - i * 14) + ' ' + (300 - i * 14) + ' 0 0 1 ' + (1730 - i * 14) + ' 760" transform="translate(-130 0)" fill="none" stroke="' + rc[i] + '" stroke-width="15" opacity="0.5"/>';
    s += cloud(330, 190, 1.1, '#fff') + cloud(1280, 150, 1.0, '#fff') + cloud(1470, 340, 0.8, '#fff', 0.9) + cloud(120, 450, 0.7, '#fff', 0.9) + cloud(800, 90, 0.8, '#fff', 0.55);
    s += '<path d="' + wave(640, 28, 190, 0.6, 900, 16) + '" fill="#b5ecb0"/>';
    s += '<path d="' + wave(720, 30, 260, 2.1, 900, 16) + '" fill="#8ddf94"/>';
    s += '<path d="' + wave(805, 24, 220, 4.0, 900, 16) + '" fill="#62cf7c"/>';
    for (i = 0; i < 16; i++) {
      var left = i % 2 === 0;
      s += flower(n2(sideX(r, left)), n2(760 + r() * 100), n2(0.8 + r() * 0.7), ['#ff7aa8', '#ffd23a', '#fff', '#b088ff', '#ff9a3c'][i % 5]);
    }
    for (i = 0; i < 4; i++) s += flower(n2(560 + i * 160 + r() * 40), n2(850 + r() * 20), 0.6, ['#ff7aa8', '#fff', '#ffd23a', '#b088ff'][i]);
    // 蝴蝶
    s += '<g transform="translate(1390 520) rotate(15)"><ellipse cx="-10" cy="-4" rx="14" ry="10" fill="#ff9ccb" stroke="#d9569a" stroke-width="2.5"/><ellipse cx="10" cy="-4" rx="14" ry="10" fill="#ffb8dc" stroke="#d9569a" stroke-width="2.5"/><rect x="-2.5" y="-10" width="5" height="22" rx="2.5" fill="#6a3a5a"/></g>';
    s += '<g transform="translate(210 600) rotate(-12) scale(0.9)"><ellipse cx="-10" cy="-4" rx="14" ry="10" fill="#8ad4ff" stroke="#3a86c8" stroke-width="2.5"/><ellipse cx="10" cy="-4" rx="14" ry="10" fill="#b8e6ff" stroke="#3a86c8" stroke-width="2.5"/><rect x="-2.5" y="-10" width="5" height="22" rx="2.5" fill="#3a5a7a"/></g>';
    return '<defs>' + defs + '</defs>' + s;
  }
  function bg1(p) {   // 暖暖海灘
    var s = '', i, defs =
      lg(p + 'sky', 0, 0, 0, 1, [[0, '#7fdcff'], [1, '#fff3d6']]) +
      lg(p + 'sea', 0, 0, 0, 1, [[0, '#5fd0ec'], [1, '#a8eef6']]) +
      lg(p + 'sand', 0, 0, 0, 1, [[0, '#ffe9b0'], [1, '#ffd08a']]) +
      rg(p + 'sun', 0.5, 0.5, 0.5, [[0, '#fff1a8', 1], [0.5, '#ffd77a', 0.5], [1, '#ffd77a', 0]]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    s += '<circle cx="1400" cy="150" r="170" fill="url(#' + p + 'sun)"/><circle cx="1400" cy="150" r="68" fill="#ffd84a" stroke="#ffb02e" stroke-width="5"/>';
    s += cloud(260, 170, 1.0, '#fff') + cloud(1000, 110, 0.7, '#fff', 0.6) + cloud(170, 380, 0.65, '#fff', 0.9) + cloud(1500, 400, 0.6, '#fff', 0.85);
    s += '<rect x="0" y="560" width="1600" height="200" fill="url(#' + p + 'sea)"/>';
    s += '<path d="M0 560 H1600" stroke="#fff" stroke-width="3" opacity="0.6"/>';
    for (i = 0; i < 9; i++) s += '<path d="M' + (i * 190 + 30) + ' ' + (600 + (i % 3) * 36) + ' q20 -14 40 0 t40 0 t40 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.5"/>';
    // 小帆船
    s += '<g transform="translate(1210 540)"><path d="M-40 0 H40 L28 20 H-28Z" fill="#ff7a6b" stroke="#b84a40" stroke-width="3" stroke-linejoin="round"/><path d="M0 -4 V-64 L34 -8Z" fill="#fff" stroke="#9db4d4" stroke-width="3" stroke-linejoin="round"/><path d="M0 -64 V0" stroke="#7a4a22" stroke-width="4"/></g>';
    s += '<path d="' + wave(715, 22, 260, 1.0, 900, 20) + '" fill="#fff" opacity="0.85"/>';
    s += '<path d="' + wave(735, 22, 260, 1.0, 900, 20) + '" fill="url(#' + p + 'sand)"/>';
    s += '<path d="' + wave(830, 16, 200, 2.4, 900, 20) + '" fill="#ffc77a" opacity="0.7"/>';
    s += palm(120, 860, 1.05, false) + palm(1500, 870, 1.0, true);
    // 陽傘
    s += '<g transform="translate(1320 800) rotate(-10)"><rect x="-3" y="-120" width="6" height="150" rx="3" fill="#a87c5a"/><path d="M-90 -110 Q0 -190 90 -110Z" fill="#ff7a8a" stroke="#b84a60" stroke-width="3.5" stroke-linejoin="round"/><path d="M-30 -110 Q-10 -168 0 -170 Q10 -168 30 -110Z" fill="#fff" opacity="0.9"/></g>';
    s += starfish(300, 840, 0.8, '#ff9a6b', 20) + starfish(1220, 850, 0.6, '#ffb86b', -15);
    s += '<g transform="translate(330 790)"><path d="M0 0 Q-28 -4 -26 -34 Q0 -50 26 -34 Q28 -4 0 0Z" fill="#ffd0e0" stroke="#d9709a" stroke-width="3.5" stroke-linejoin="round"/><path d="M0 -2 V-42 M-14 -4 L-15 -38 M14 -4 L15 -38" stroke="#d9709a" stroke-width="2.5"/></g>';
    s += '<g transform="translate(200 790)"><circle r="28" fill="#fff" stroke="#9db4d4" stroke-width="3.5"/><path d="M0 0 L0 -28 A28 28 0 0 1 24 -14Z M0 0 L0 28 A28 28 0 0 1 -24 14Z" fill="#ff7a8a"/><path d="M0 0 L24 -14 A28 28 0 0 1 24 14Z M0 0 L-24 14 A28 28 0 0 1 -24 -14Z" fill="#4aa8ff"/><circle r="28" fill="none" stroke="#9db4d4" stroke-width="3.5"/></g>';
    return '<defs>' + defs + '</defs>' + s;
  }
  function bg2(p) {   // 糖果山
    var s = '', i, r = rng(22), defs =
      lg(p + 'sky', 0, 0, 0, 1, [[0, '#ffbde0'], [1, '#fff3fb']]) +
      lg(p + 'h1', 0, 0, 0, 1, [[0, '#d9f5e6'], [1, '#bdeed6']]) +
      lg(p + 'h2', 0, 0, 0, 1, [[0, '#ffd6ea'], [1, '#ffb8d8']]) +
      lg(p + 'gr', 0, 0, 0, 1, [[0, '#ff9ccb'], [1, '#ff7ab8']]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    s += cloud(260, 170, 1.1, '#ffe3f3') + cloud(1300, 140, 1.0, '#e6f2ff') + cloud(1480, 360, 0.7, '#fff0fa', 0.95) + cloud(130, 440, 0.7, '#e6f2ff', 0.95) + cloud(820, 90, 0.7, '#fff', 0.5);
    s += '<path d="' + wave(630, 40, 170, 1.0, 900, 16) + '" fill="url(#' + p + 'h1)"/>';
    s += '<path d="' + wave(705, 34, 230, 3.0, 900, 16) + '" fill="url(#' + p + 'h2)"/>';
    // 山丘上的條紋糖果點點（只放在兩側）
    for (i = 0; i < 20; i++) s += '<circle cx="' + n2(sideX(r, i % 2 === 0)) + '" cy="' + n2(700 + r() * 90) + '" r="' + n2(5 + r() * 5) + '" fill="' + ['#fff', '#ffe36a', '#8ad4ff', '#c79bff'][i % 4] + '" opacity="0.9"/>';
    s += lollipop(120, 380, 1.1, '#ff5c9a', '#fff') + lollipop(1490, 330, 1.2, '#7a5cff', '#e6defa') + lollipop(300, 520, 0.7, '#3ec6a8', '#fff') + lollipop(1330, 520, 0.75, '#ff9a3c', '#fff');
    s += candyCane(60, 860, 1.0, false) + candyCane(1540, 860, 1.0, true);
    s += '<path d="' + wave(815, 18, 160, 0.4, 900, 16) + '" fill="url(#' + p + 'gr)"/>';
    // 糖霜滴落
    var dr = '';
    for (i = 0; i < 40; i++) { var x = 20 + i * 40; dr += 'M' + x + ' 800 q20 0 20 ' + (24 + (i * 7) % 26) + ' q0 14 -10 14 q-10 0 -10 -14Z '; }
    s += '<path d="' + dr + '" fill="#fff" opacity="0.0"/>';
    s += gumdrop(240, 870, 1.0, '#ffd23a') + gumdrop(340, 880, 0.8, '#7ad8ff') + gumdrop(1260, 878, 0.9, '#b088ff') + gumdrop(1390, 872, 1.0, '#8be3a8') + gumdrop(160, 886, 0.7, '#ff7ab8');
    for (i = 0; i < 14; i++) s += sprinkle(n2(sideX(r, i % 2 === 0)), n2(835 + r() * 55), n2(r() * 180), ['#fff', '#ffe36a', '#8ad4ff', '#c79bff'][i % 4]);
    return '<defs>' + defs + '</defs>' + s;
  }
  function bg3(p) {   // 童話森林
    var s = '', i, r = rng(33), defs =
      lg(p + 'sky', 0, 0, 0, 1, [[0, '#bfeecb'], [1, '#fcffe2']]) +
      lg(p + 'ray', 0, 0, 0, 1, [[0, '#fff', 0.5], [1, '#fff', 0]]) +
      rg(p + 'ff', 0.5, 0.5, 0.5, [[0, '#fff8a0', 1], [1, '#fff8a0', 0]]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    s += '<polygon points="180,0 330,0 560,700 300,700" fill="url(#' + p + 'ray)"/><polygon points="1180,0 1300,0 1500,700 1260,700" fill="url(#' + p + 'ray)"/>';
    // 遠景樹叢（淡）
    for (i = 0; i < 12; i++) s += '<circle cx="' + (i * 150 + 20) + '" cy="' + (600 + (i % 3) * 14) + '" r="' + (80 + (i % 4) * 14) + '" fill="#b7e3a4"/>';
    s += '<path d="' + wave(660, 22, 200, 0.5, 900, 20) + '" fill="#a6dc8f"/>';
    s += tree(110, 760, 1.25, '#6fc860', '#3f8f3a') + tree(300, 800, 0.95, '#85d46c', '#4a9a42') + tree(1500, 770, 1.3, '#6fc860', '#3f8f3a') + tree(1310, 810, 0.9, '#85d46c', '#4a9a42');
    s += '<path d="' + wave(790, 20, 240, 2.0, 900, 20) + '" fill="#7ccf70"/>';
    s += '<path d="' + wave(850, 14, 200, 4.0, 900, 20) + '" fill="#5fbd5f"/>';
    // 小屋（右下）
    s += '<g transform="translate(1180 830)"><rect x="-34" y="-50" width="68" height="50" fill="#ffe0b0" stroke="#a87c5a" stroke-width="3.5"/><polygon points="-44,-50 0,-92 44,-50" fill="#ff7a6b" stroke="#b84a40" stroke-width="3.5" stroke-linejoin="round"/><rect x="-9" y="-30" width="18" height="30" rx="9" fill="#a87c5a"/><rect x="14" y="-40" width="12" height="12" fill="#bfe8ff" stroke="#a87c5a" stroke-width="2.5"/></g>';
    s += mushroom(240, 880, 1.0, '#ff5c7a') + mushroom(400, 886, 0.7, '#ffa64d') + mushroom(1420, 884, 0.9, '#ff5c7a') + mushroom(1050, 890, 0.55, '#b088ff');
    for (i = 0; i < 14; i++) {
      var fx = n2(sideX(r, i % 2 === 0)), fy = n2(300 + r() * 380);
      s += '<circle cx="' + fx + '" cy="' + fy + '" r="22" fill="url(#' + p + 'ff)"/><circle cx="' + fx + '" cy="' + fy + '" r="4" fill="#ffe84a"/>';
    }
    for (i = 0; i < 8; i++) s += flower(n2(sideX(r, i % 2 === 0)), n2(840 + r() * 30), 0.55, ['#ff7aa8', '#fff', '#ffd23a', '#b088ff'][i % 4]);
    return '<defs>' + defs + '</defs>' + s;
  }
  function bg4(p) {   // 星星夜空
    var s = '', i, r = rng(44), defs =
      lg(p + 'sky', 0, 0, 0, 1, [[0, '#232878'], [0.6, '#5b4fc8'], [1, '#b98ae6']]) +
      rg(p + 'moon', 0.5, 0.5, 0.5, [[0, '#fff3b0', 0.8], [1, '#fff3b0', 0]]) +
      lg(p + 'hill', 0, 0, 0, 1, [[0, '#4a3aa8'], [1, '#2f2680']]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    for (i = 0; i < 70; i++) {
      var x = r() * 1600, y = r() * 640, rad = 1.8 + r() * 3.6;
      var center = x > 430 && x < 1170 && y > 90;
      if (center) { if (r() > 0.25) continue; rad *= 0.6; }
      s += (i % 3 === 0) ? '<polygon points="' + starPts(n2(x), n2(y), n2(rad * 3.2), n2(rad * 1.3), 4, 0) + '" fill="#fff6c0" opacity="' + (center ? 0.4 : 0.9) + '"/>' :
        '<circle cx="' + n2(x) + '" cy="' + n2(y) + '" r="' + n2(rad) + '" fill="#fff" opacity="' + (center ? 0.35 : 0.85) + '"/>';
    }
    // 月亮
    s += '<circle cx="230" cy="170" r="150" fill="url(#' + p + 'moon)"/>';
    s += '<path d="' + moonPath(230, 170, 78, 270, 148, 66) + '" fill="#fff0a0" stroke="#e8c060" stroke-width="4"/>';
    // 小行星
    s += '<g transform="translate(1420 210)"><ellipse rx="110" ry="24" transform="rotate(-18)" fill="none" stroke="#ffd0f0" stroke-width="10" opacity="0.8"/><circle r="52" fill="#ff9ccb" stroke="#d9569a" stroke-width="4"/><path d="M-40 -14 Q0 -30 40 -14 M-48 8 Q0 -8 48 8" fill="none" stroke="#fff" stroke-width="5" opacity="0.5"/><ellipse rx="110" ry="24" transform="rotate(-18)" fill="none" stroke="#ffd0f0" stroke-width="10" stroke-dasharray="0 190 220 0" opacity="0.9"/></g>';
    // 流星
    s += '<g transform="translate(1250 110) rotate(25)"><rect x="-90" y="-3" width="90" height="6" rx="3" fill="#fff" opacity="0.4"/><polygon points="' + starPts(0, 0, 16, 7, 5) + '" fill="#ffe36a" stroke="#e8a82a" stroke-width="2.5" stroke-linejoin="round"/></g>';
    s += cloud(1500, 480, 0.8, '#d8c8ff', 0.5) + cloud(110, 470, 0.7, '#d8c8ff', 0.5);
    s += '<path d="' + wave(740, 36, 230, 0.3, 900, 20) + '" fill="url(#' + p + 'hill)" opacity="0.85"/>';
    s += '<path d="' + wave(820, 28, 280, 2.2, 900, 20) + '" fill="#2a2275"/>';
    // 小房子（兩側）
    function house(x, y, c) {
      return '<g transform="translate(' + x + ' ' + y + ')"><rect x="-26" y="-40" width="52" height="40" fill="' + c + '" stroke="#1a1450" stroke-width="3"/><polygon points="-34,-40 0,-72 34,-40" fill="#ff7a8a" stroke="#1a1450" stroke-width="3" stroke-linejoin="round"/><rect x="-8" y="-28" width="16" height="16" rx="3" fill="#ffe36a"/></g>';
    }
    s += house(120, 830, '#6a5ad8') + house(260, 850, '#7a6ae8') + house(1380, 840, '#6a5ad8') + house(1500, 860, '#7a6ae8');
    return '<defs>' + defs + '</defs>' + s;
  }
  function bg5(p) {   // 海底世界
    var s = '', i, r = rng(55), defs =
      lg(p + 'sea', 0, 0, 0, 1, [[0, '#62d8f6'], [0.6, '#2a96d8'], [1, '#1668b4']]) +
      lg(p + 'ray', 0, 0, 0, 1, [[0, '#fff', 0.3], [1, '#fff', 0]]) +
      lg(p + 'sand', 0, 0, 0, 1, [[0, '#ffe9b8'], [1, '#f2c680']]);
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sea)"/>';
    s += '<polygon points="120,0 260,0 520,760 260,760" fill="url(#' + p + 'ray)"/><polygon points="1180,0 1340,0 1500,760 1240,760" fill="url(#' + p + 'ray)"/><polygon points="760,0 840,0 900,500 740,500" fill="url(#' + p + 'ray)" opacity="0.5"/>';
    s += bubbles(r, 10, [30, 380], [100, 760], '#fff') + bubbles(r, 10, [1220, 1570], [100, 760], '#fff');
    s += fish(250, 300, 1.0, '#ffb13a', false) + fish(1380, 420, 0.9, '#ff7a9a', true) + fish(150, 560, 0.7, '#ffe04a', false) + fish(1480, 220, 0.7, '#9a7aff', true);
    // 水母
    s += '<g transform="translate(1320 600)"><path d="M-36 0 Q-36 -50 0 -50 Q36 -50 36 0Z" fill="#ffc0e6" fill-opacity="0.85" stroke="#d9709a" stroke-width="3.5"/><path d="M-22 4 q0 24 -6 40 M0 4 q0 28 6 46 M22 4 q0 24 6 40" fill="none" stroke="#ffc0e6" stroke-width="5" stroke-linecap="round"/><circle cx="-12" cy="-26" r="4" fill="#fff" opacity="0.8"/></g>';
    s += '<path d="' + wave(790, 22, 240, 0.8, 900, 20) + '" fill="url(#' + p + 'sand)"/>';
    s += seaweed(70, 830, 280, '#3fcf8a', 1) + seaweed(130, 840, 200, '#5fe0a0', -1) + seaweed(1530, 830, 300, '#3fcf8a', -1) + seaweed(1470, 840, 210, '#5fe0a0', 1);
    s += coral(260, 850, 1.1, '#ff7a8a') + coral(360, 860, 0.8, '#ffa64d') + coral(1250, 856, 1.0, '#c08aff') + coral(1360, 866, 0.8, '#ff7a8a');
    s += starfish(190, 872, 0.7, '#ff9a6b', 10) + starfish(1180, 880, 0.6, '#ffd23a', -20);
    // 寶箱（右下）
    s += '<g transform="translate(1450 880)"><rect x="-40" y="-34" width="80" height="34" rx="5" fill="#c98a4a" stroke="#6a4020" stroke-width="3.5"/><path d="M-40 -34 Q-40 -64 0 -64 Q40 -64 40 -34Z" fill="#e0a05a" stroke="#6a4020" stroke-width="3.5"/><rect x="-7" y="-44" width="14" height="16" rx="3" fill="#ffd23a" stroke="#6a4020" stroke-width="2.5"/></g>';
    return '<defs>' + defs + '</defs>' + s;
  }

  function bg6(p) {   // 日月光：寫實黃昏——夕陽、滿月、星空、雲層、遠山、海面
    var s = '', i, j, r = rng(606), HZ = 640, SX = 340, SY = 548, MX = 1385, MY = 165;
    var defs =
      lg(p + 'sky', 0, 0, 0, 1, [[0, '#141a52'], [0.16, '#2c2a7a'], [0.34, '#6d3a8c'], [0.5, '#c4506f'], [0.66, '#f08a4c'], [0.8, '#ffc77a'], [1, '#ffe6a6']]) +
      rg(p + 'sg', 0.5, 0.5, 0.5, [[0, '#fff4c8', 1], [0.12, '#ffe09a', 0.9], [0.35, '#ffa850', 0.45], [0.7, '#ff7a45', 0.14], [1, '#ff7a45', 0]]) +
      rg(p + 'sc', 0.5, 0.5, 0.5, [[0, '#ffffff', 1], [0.55, '#fff6d0', 1], [0.85, '#ffe39a', 0.9], [1, '#ffd070', 0]]) +
      rg(p + 'mh', 0.5, 0.5, 0.5, [[0.25, '#dfe4ff', 0.5], [0.5, '#b8c4ff', 0.2], [1, '#9aa8ff', 0]]) +
      rg(p + 'mb', 0.4, 0.36, 0.66, [[0, '#fffdf4'], [0.6, '#efe9da'], [0.9, '#cfc8bb'], [1, '#a9a395']]) +
      rg(p + 'mt', 0.5, 0.5, 0.5, [[0.7, '#000', 0], [1, '#10122e', 0.5]]) +
      rg(p + 'fl', 0.5, 0.5, 0.5, [[0, '#fff0c0', 0.5], [0.6, '#ffc880', 0.18], [1, '#ffc880', 0]]) +
      lg(p + 'ray', 0.5, 1, 0.5, 0, [[0, '#ffe2a0', 0.4], [1, '#ffe2a0', 0]]) +
      lg(p + 'sea', 0, 0, 0, 1, [[0, '#f6b878'], [0.12, '#c9708a'], [0.45, '#5a3f84'], [1, '#1c1c4e']]) +
      lg(p + 'glit', 0, 0, 0, 1, [[0, '#fff0b8', 0.75], [1, '#ffb868', 0.05]]) +
      lg(p + 'cl', 0, 0, 0, 1, [[0, '#ffd6a8'], [0.5, '#f0a0a0'], [1, '#7a4a8c']]) +
      lg(p + 'cn', 0, 0, 0, 1, [[0, '#a98cd0'], [1, '#4a3a86']]) +
      lg(p + 'm1', 0, 0, 0, 1, [[0, '#d9889e'], [1, '#f2a890']]) +
      lg(p + 'm2', 0, 0, 0, 1, [[0, '#8c5c94'], [1, '#c0708c']]) +
      lg(p + 'm3', 0, 0, 0, 1, [[0, '#3a2a62'], [1, '#5a3a72']]) +
      '<filter id="' + p + 'bl" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>' +
      '<filter id="' + p + 'bl2" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>' +
      '<filter id="' + p + 'bs" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>' +
      '<filter id="' + p + 'mf" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="7" result="n"/>' +
      '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.41  0 0 0 0 0.46  0 0 0 1.9 -0.78" result="t"/><feComposite in="t" in2="SourceAlpha" operator="in"/></filter>' +
      '<filter id="' + p + 'cf" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="2" seed="3" result="n"/>' +
      '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.34  0 0 0 0 0.38  0 0 0 2.4 -1.25" result="t"/><feComposite in="t" in2="SourceAlpha" operator="in"/></filter>' +
      '<clipPath id="' + p + 'mc"><circle cx="' + MX + '" cy="' + MY + '" r="74"/></clipPath>';
    s += '<rect width="1600" height="900" fill="url(#' + p + 'sky)"/>';
    // 星空（愈靠地平線愈淡）
    for (i = 0; i < 170; i++) {
      var x = r() * 1600, y = Math.pow(r(), 1.3) * 430, op = Math.max(0, 0.95 * (1 - y / 440)) * (0.35 + r() * 0.65), rad = r() < 0.08 ? 1.9 : 0.6 + r() * 1.0;
      if (op < 0.06) continue;
      s += '<circle cx="' + n2(x) + '" cy="' + n2(y) + '" r="' + n2(rad) + '" fill="' + (r() < 0.2 ? '#ffe6c8' : '#e8eeff') + '" opacity="' + n2(op) + '"/>';
    }
    // 月暈 + 月亮
    s += '<circle cx="' + MX + '" cy="' + MY + '" r="260" fill="url(#' + p + 'mh)"/>';
    s += '<circle cx="' + MX + '" cy="' + MY + '" r="74" fill="url(#' + p + 'mb)"/>';
    s += '<circle cx="' + MX + '" cy="' + MY + '" r="74" fill="#fff" filter="url(#' + p + 'mf)" opacity="0.9"/>';
    s += '<g clip-path="url(#' + p + 'mc)">' +
      '<g fill="#7d7a86" opacity="0.38" filter="url(#' + p + 'bs)"><ellipse cx="1362" cy="140" rx="22" ry="17"/><ellipse cx="1398" cy="128" rx="17" ry="13"/><ellipse cx="1376" cy="178" rx="26" ry="14" transform="rotate(-18 1376 178)"/><ellipse cx="1420" cy="168" rx="14" ry="11"/></g>' +
      '<g fill="none" stroke="#6f6c78" stroke-width="1.3" opacity="0.45"><circle cx="1424" cy="206" r="9"/><circle cx="1350" cy="204" r="6.5"/><circle cx="1408" cy="132" r="5"/><circle cx="1332" cy="168" r="4"/></g>' +
      '<g fill="#8a8794" opacity="0.4"><circle cx="1424" cy="206" r="8"/><circle cx="1350" cy="204" r="5.5"/><circle cx="1442" cy="170" r="4"/><circle cx="1388" cy="226" r="4.5"/></g>' +
      '<g stroke="#fffdf4" stroke-width="1.4" opacity="0.35"><path d="M1424 206 L1478 250 M1424 206 L1396 262 M1424 206 L1470 168"/></g></g>';
    s += '<circle cx="' + MX + '" cy="' + MY + '" r="74" fill="url(#' + p + 'mt)"/>';
    // 夕陽光暈、光芒
    s += '<circle cx="' + SX + '" cy="' + SY + '" r="520" fill="url(#' + p + 'sg)"/>';
    var rays = '';
    for (i = 0; i < 9; i++) {
      var ang = -165 + i * 18 + (r() - 0.5) * 6, wd = 14 + r() * 26;
      rays += '<polygon transform="translate(' + SX + ' ' + SY + ') rotate(' + n2(ang + 90) + ')" points="-3,0 3,0 ' + n2(wd) + ',-760 ' + n2(-wd) + ',-760" fill="url(#' + p + 'ray)" opacity="' + n2(0.12 + r() * 0.16) + '"/>';
    }
    s += '<g filter="url(#' + p + 'bs)">' + rays + '</g>';
    // 遠雲層（天空中段，兩側）
    function cloudBank(cx, cy, w, h, fillId, seed, op) {
      var rr = rng(seed), o = '', k;
      for (k = 0; k < 9; k++) {
        var ex = cx + (rr() - 0.5) * w, ey = cy + (rr() - 0.5) * h * 0.7, erx = w * (0.12 + rr() * 0.16), ery = h * (0.28 + rr() * 0.3);
        o += '<ellipse cx="' + n2(ex) + '" cy="' + n2(ey) + '" rx="' + n2(erx) + '" ry="' + n2(ery) + '"/>';
      }
      return '<g fill="url(#' + p + fillId + ')" opacity="' + op + '" filter="url(#' + p + 'bl)">' + o + '</g>';
    }
    s += cloudBank(130, 300, 420, 70, 'cn', 11, 0.7) + cloudBank(1440, 400, 480, 80, 'cn', 12, 0.65) + cloudBank(820, 130, 520, 50, 'cn', 13, 0.35);
    s += cloudBank(420, 470, 520, 60, 'cl', 14, 0.85) + cloudBank(1230, 520, 600, 66, 'cl', 15, 0.85) + cloudBank(60, 560, 300, 40, 'cl', 16, 0.8);
    // 被夕陽照亮的雲底與細長雲絲
    s += '<g filter="url(#' + p + 'bl)" opacity="0.85" fill="#ffb060"><ellipse cx="470" cy="500" rx="170" ry="9"/><ellipse cx="90" cy="582" rx="110" ry="7"/><ellipse cx="1180" cy="548" rx="150" ry="7" fill="#ff9a60"/></g>';
    s += '<g filter="url(#' + p + 'bl)" opacity="0.5" fill="#ffe0b0"><ellipse cx="330" cy="420" rx="230" ry="6"/><ellipse cx="1400" cy="470" rx="200" ry="6"/><ellipse cx="1520" cy="330" rx="120" ry="5"/></g>';
    // 太陽本體
    s += '<circle cx="' + SX + '" cy="' + SY + '" r="150" fill="url(#' + p + 'fl)"/>';
    s += '<circle cx="' + SX + '" cy="' + SY + '" r="46" fill="url(#' + p + 'sc)"/>';
    // 鏡頭光斑（只在左側斜線上）
    var fls = [[0.16, 22, 0.14], [0.3, 12, 0.18], [0.46, 34, 0.1], [0.62, 16, 0.14]];
    for (i = 0; i < fls.length; i++) {
      s += '<circle cx="' + n2(SX + 420 * fls[i][0]) + '" cy="' + n2(SY - 330 * fls[i][0]) + '" r="' + fls[i][1] + '" fill="#ffe2a8" opacity="' + fls[i][2] + '"/>';
    }
    // 山脈（三層大氣透視）：中央降低、兩側隆起；遠山在太陽處留谷
    function ridge(base, amp, seed, fill, dip) {
      var rr = rng(seed), pts = [], x, yv, d = 'M0 ' + HZ + ' ', ph1 = rr() * 6, ph2 = rr() * 6, ph3 = rr() * 6;
      for (x = 0; x <= 1600; x += 16) {
        var side = Math.min(1, Math.abs(x - 800) / 520), hh = (Math.sin(x / 130 + ph1) * 0.5 + Math.sin(x / 57 + ph2) * 0.3 + Math.sin(x / 23 + ph3) * 0.14 + 0.6) * amp * (0.15 + 0.85 * side);
        yv = base - hh;
        if (dip) yv += Math.max(0, 1 - Math.abs(x - SX) / 190) * 70;
        d += 'L' + x + ' ' + n2(yv) + ' ';
      }
      return '<path d="' + d + 'L1600 ' + HZ + 'Z" fill="url(#' + p + fill + ')"/>';
    }
    s += ridge(HZ - 6, 150, 21, 'm1', true);
    s += ridge(HZ - 2, 120, 22, 'm2', false);
    s += ridge(HZ + 4, 82, 23, 'm3', false);
    // 海面與日光倒影
    s += '<rect y="' + (HZ + 4) + '" width="1600" height="' + (900 - HZ) + '" fill="url(#' + p + 'sea)"/>';
    s += '<polygon points="' + (SX - 34) + ',' + (HZ + 4) + ' ' + (SX + 34) + ',' + (HZ + 4) + ' ' + (SX + 120) + ',900 ' + (SX - 120) + ',900" fill="url(#' + p + 'glit)" filter="url(#' + p + 'bl)" opacity="0.7"/>';
    for (i = 0; i < 70; i++) {
      var gy = HZ + 8 + Math.pow(r(), 1.4) * (880 - HZ), spread = 30 + (gy - HZ) * 0.42, gx = SX + (r() - 0.5) * 2 * spread * (0.4 + r() * 0.6);
      s += '<ellipse cx="' + n2(gx) + '" cy="' + n2(gy) + '" rx="' + n2(5 + r() * (10 + (gy - HZ) * 0.06)) + '" ry="' + n2(0.9 + r() * 1.2) + '" fill="#fff4cc" opacity="' + n2(0.35 + r() * 0.5) + '"/>';
    }
    // 月光在右側海面的淡淡倒影
    for (i = 0; i < 18; i++) {
      var my = HZ + 14 + r() * 230;
      s += '<ellipse cx="' + n2(MX + (r() - 0.5) * 70) + '" cy="' + n2(my) + '" rx="' + n2(4 + r() * 9) + '" ry="1.1" fill="#dfe6ff" opacity="' + n2(0.12 + r() * 0.22) + '"/>';
    }
    // 近岸水平微光與暗角
    s += '<rect y="' + (HZ + 4) + '" width="1600" height="3" fill="#ffd9a0" opacity="0.45"/>';
    return '<defs>' + defs + '</defs>' + s;
  }

  var BGS = [bg0, bg1, bg2, bg3, bg4, bg5, bg6];
  Art.themeBgSVG = function (themeId) {
    var id = (themeId >= 0 && themeId < BGS.length) ? themeId : 0;
    return svgWrap('0 0 1600 900', BGS[id]('bg' + id + '-'), 'preserveAspectRatio="xMidYMid slice"');
  };

  // ───────────── 7. 標誌 ─────────────
  Art.logoSVG = function () {
    var p = 'lg-', rc = ['#ff5c7a', '#ff9a3c', '#ffcf3a', '#46d37f', '#4aa8ff', '#a678ff'], i, s = '';
    var defs =
      lg(p + 'txt', 0, 0, 0, 1, [[0, '#fff7a0'], [0.45, '#ffcf3a'], [1, '#ff8a3c']]) +
      lg(p + 'rb', 0, 0, 1, 0, [[0, '#ff5c7a'], [0.2, '#ff9a3c'], [0.4, '#ffcf3a'], [0.6, '#46d37f'], [0.8, '#4aa8ff'], [1, '#a678ff']]) +
      rg(p + 'bub', 0.35, 0.3, 0.85, [[0, '#fff', 0.95], [0.5, '#bfe8ff', 0.55], [1, '#6ab8ff', 0.6]]);
    // 彩虹拱
    for (i = 0; i < 6; i++) {
      s += '<path d="M' + (96 + i * 9) + ' 92 A' + (164 - i * 9) + ' ' + (164 - i * 9) + ' 0 0 1 ' + (424 - i * 9) + ' 92" fill="none" stroke="' + rc[i] + '" stroke-width="10.5" stroke-linecap="butt" transform="translate(' + (i * 0) + ' 0)" opacity="0.95"/>';
    }
    s = '<g transform="translate(0 4)">' + s + '</g>';
    s += cloudMini(100, 100) + cloudMini(420, 100);
    // 文字：陰影 → 白邊 → 填色
    var tx = '<text x="260" y="168" text-anchor="middle" font-family=\'' + FONT + '\' font-size="82" font-weight="900" textLength="400" lengthAdjust="spacingAndGlyphs"';
    s += tx + ' fill="#5a2a9a" stroke="#5a2a9a" stroke-width="22" stroke-linejoin="round" transform="translate(0 6)">彩虹泡泡砲</text>';
    s += tx + ' fill="#fff" stroke="#fff" stroke-width="15" stroke-linejoin="round">彩虹泡泡砲</text>';
    s += tx + ' fill="url(#' + p + 'txt)" stroke="#d9569a" stroke-width="3" stroke-linejoin="round">彩虹泡泡砲</text>';
    s += tx + ' fill="none" stroke="#fff" stroke-width="2" opacity="0.0">彩虹泡泡砲</text>';
    // 泡泡裝飾
    function bub(x, y, r) {
      return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#' + p + 'bub)" stroke="#4a86d8" stroke-width="2.6"/><ellipse cx="' + n2(x - r * 0.35) + '" cy="' + n2(y - r * 0.4) + '" rx="' + n2(r * 0.3) + '" ry="' + n2(r * 0.18) + '" transform="rotate(-35 ' + n2(x - r * 0.35) + ' ' + n2(y - r * 0.4) + ')" fill="#fff"/>';
    }
    s += bub(30, 150, 20) + bub(44, 70, 11) + bub(486, 56, 14) + bub(490, 150, 22) + bub(18, 108, 6) + bub(506, 104, 7);
    s += sparkle(160, 38, 9) + sparkle(372, 34, 8);
    function cloudMini(x, y) {
      return '<g transform="translate(' + x + ' ' + y + ') scale(0.5)" fill="#fff" stroke="#9db4d4" stroke-width="5"><ellipse cx="0" cy="6" rx="70" ry="22"/><circle cx="-30" cy="-8" r="26"/><circle cx="10" cy="-20" r="32"/><circle cx="44" cy="-4" r="22"/></g>' +
        '<g transform="translate(' + x + ' ' + y + ') scale(0.5)" fill="#fff"><ellipse cx="0" cy="6" rx="70" ry="22"/><circle cx="-30" cy="-8" r="26"/><circle cx="10" cy="-20" r="32"/><circle cx="44" cy="-4" r="22"/></g>';
    }
    return svgWrap('0 0 520 200', '<defs>' + defs + '</defs>' + s);
  };

  // ───────────── 8. 介面圖示 ─────────────
  function gearPath() {
    var d = '', i, a;
    for (i = 0; i < 8; i++) {
      a = i * Math.PI / 4;
      d += 'M' + n2(12 + Math.cos(a) * 7.6) + ' ' + n2(12 + Math.sin(a) * 7.6) + ' L' + n2(12 + Math.cos(a) * 10.4) + ' ' + n2(12 + Math.sin(a) * 10.4) + ' ';
    }
    return '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.4"/><path d="' + d + '"/>';
  }
  var ICONS = {
    gear: gearPath(),
    home: '<path d="M3 11.5 12 3.5l9 8"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chat: '<path d="M4 5h16v11H10l-4.5 4v-4H4z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
    crown: '<path d="M3 8l4.5 5L12 5l4.5 8L21 8v10H3z"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    eye: '<path d="M2 12c3-6 17-6 20 0-3 6-17 6-20 0z"/><circle cx="12" cy="12" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    sound: '<path d="M4 9.5h3.5L13 5v14l-5.5-4.5H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
    vibrate: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4.5 8v8M19.5 8v8M1.8 10.5v3M22.2 10.5v3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><path d="M12 17h.01"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="3.8" r="1.2"/><path d="M9 12.5v2M15 12.5v2M9.5 17h5M3 12v4M21 12v4"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    trophy: '<path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/><path d="M12 15v3M8 21h8M9 18h6"/>',
    swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M15.5 4.8a3.2 3.2 0 0 1 0 6.4M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z"/>',
    heart: '<path d="M12 20C5 15 3 11.5 3 8.8 3 6.2 5 4.5 7.3 4.5c1.9 0 3.7 1 4.7 2.8 1-1.8 2.8-2.8 4.7-2.8C19 4.5 21 6.2 21 8.8c0 2.7-2 6.2-9 11.2z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>'
  };
  Art.ICON_NAMES = Object.keys(ICONS);
  Art.icon = function (name, size) {
    var sz = size || 24;
    var body = ICONS[name] || '<circle cx="12" cy="12" r="8"/>';
    return '<svg ' + NS + ' width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Art;
})(typeof self !== 'undefined' ? self : this);
