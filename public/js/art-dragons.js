/* 彩虹泡泡砲 — art-dragons.js
 * 8 隻原創可愛龍的向量 SVG（全部程式拼字串，零外部資源）。
 *
 * 介面：
 *   Art.DRAGONS                 [{ id, name, accent }]  共 8 隻，順序固定
 *   Art.dragonSVG(id, pose)     viewBox 0 0 200 200；pose = idle | shoot | cheer | sad
 *   Art.dragonFaceSVG(id)       頭像，viewBox 0 0 100 100
 *
 * 做法：共通的「身體／頭／手／腳／尾巴／翅膀」寫成函式，
 * 每隻龍只用一份設定（配色、角、頭飾、翅膀、尾巴、斑紋）去組合，再補特色部件。
 * 注意：不畫背脊尖刺，不用綠／藍身體＋奶油肚＋橘背刺的配色。
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 資料
  var DRAGONS = [
    { id: 'rainbow', name: '彩虹龍', accent: '#ff7eb6' },
    { id: 'cloud',   name: '雲朵龍', accent: '#b49cf2' },
    { id: 'candy',   name: '糖果龍', accent: '#5fe0b8' },
    { id: 'sun',     name: '太陽龍', accent: '#ffb02e' },
    { id: 'moon',    name: '月亮龍', accent: '#ffd84a' },
    { id: 'blossom', name: '花花龍', accent: '#ff7fa8' },
    { id: 'frost',   name: '冰晶龍', accent: '#7fd3f0' },
    { id: 'forest',  name: '森林龍', accent: '#7cc95a' }
  ];

  var RAINBOW = ['#ff6b8b', '#ffa24a', '#ffd84a', '#5fd88a', '#5aaeff', '#a47cff'];

  // 每隻龍的設定。body/belly = [亮, 中, 暗]（belly 為 [亮, 暗]）
  var SPEC = {
    rainbow: {
      body: ['#fffdf6', '#fff0d4', '#f0cfa6'], belly: ['#ffffff', '#fff4dc'],
      line: '#a9745a', toe: '#ffd9e6', cheek: '#ff9bb5', eye: '#4a2f3a',
      muzzle: '#fffaf0', mouth: '#a9745a',
      horn: 'rainbow', ear: 'point', earColor: '#ffc2d8',
      wing: 'sweep', tail: 'rainbow', tip: 'none', pattern: 'none'
    },
    cloud: {
      body: ['#fdfbff', '#e9e1fb', '#c4b5ee'], belly: ['#ffffff', '#f4efff'],
      line: '#7f6ab8', toe: '#ffffff', cheek: '#ffa8cc', eye: '#4a3a7a',
      muzzle: '#ffffff', mouth: '#7f6ab8',
      horn: 'cloud', ear: 'fluff', earColor: '#f4efff',
      wing: 'cloud', tail: 'plain', tip: 'cloud', pattern: 'none', eyeIdle: 'smile'
    },
    candy: {
      body: ['#ffd0e4', '#ff92c2', '#e25a9c'], belly: ['#ffe9f3', '#ffd2e7'],
      line: '#a8306c', toe: '#ffe4f0', cheek: '#ff6fa6', eye: '#6a1f46',
      muzzle: '#ffe9f3', mouth: '#a8306c',
      horn: 'lolly', ear: 'round', earColor: '#ffd0e4',
      wing: 'round', tail: 'candy', tip: 'bow', pattern: 'candy'
    },
    sun: {
      body: ['#ffe78a', '#ffb42e', '#e07a10'], belly: ['#fff4bd', '#ffd96a'],
      line: '#a0500c', toe: '#fff0b0', cheek: '#ff5f4e', eye: '#5a2a08',
      muzzle: '#fff1b4', mouth: '#a0500c',
      horn: 'mane', ear: null, earColor: '#ffd23f',
      wing: 'rays', tail: 'plain', tip: 'flame', pattern: 'none',
      cheekBig: true, face: [0.58, 82]
    },
    moon: {
      body: ['#9a89ec', '#6050bb', '#3d2e88'], belly: ['#b5a8f4', '#8470d6'],
      line: '#20186a', toe: '#b5a8f4', cheek: '#ff9ec4', eye: '#2a1a66',
      muzzle: '#b5a8f4', mouth: '#20186a', brow: '#d8ceff', closed: '#ffe066',
      horn: 'crescent', ear: 'point', earColor: '#8470d6',
      wing: 'sweep', tail: 'plain', tip: 'star', pattern: 'moon', eyeIdle: 'moon'
    },
    blossom: {
      body: ['#ffd9c2', '#ff9f88', '#e56a5c'], belly: ['#fff0e4', '#ffd6c0'],
      line: '#a8453c', toe: '#ffe2d2', cheek: '#ff6f8f', eye: '#5a2630',
      muzzle: '#fff0e4', mouth: '#a8453c',
      horn: 'none', ear: 'round', earColor: '#ffd6c0', collar: true,
      wing: 'leaf', tail: 'plain', tip: 'flower', pattern: 'none', face: [0.62, 80]
    },
    frost: {
      body: ['#f6fdff', '#d6f1f9', '#a8d9ea'], belly: ['#ffffff', '#ecf9ff'],
      line: '#5a9bb8', toe: '#ffffff', cheek: '#ffa8c4', eye: '#2f5470',
      muzzle: '#ffffff', mouth: '#5a9bb8',
      horn: 'crystal', ear: 'point', earColor: '#bfeaff',
      wing: 'crystal', tail: 'plain', tip: 'snow', pattern: 'frost'
    },
    forest: {
      body: ['#e2b184', '#bd804c', '#8a5530'], belly: ['#fff5dc', '#f2dcb0'],
      line: '#5a3519', toe: '#f2dcb0', cheek: '#ff8a70', eye: '#33200f',
      muzzle: '#f6e4bc', mouth: '#5a3519', brow: '#5a3519',
      horn: 'antler', ear: 'round', earColor: '#f2dcb0', mushroom: true,
      wing: 'feather', tail: 'plain', tip: 'leaves', pattern: 'forest'
    }
  };

  // ---------------------------------------------------------------- 基本工具
  var SW = 3; // 統一描邊粗細

  function r1(n) { return Math.round(n * 100) / 100; }

  function stopsStr(stops) {
    var o = '';
    for (var i = 0; i < stops.length; i++) {
      o += '<stop offset="' + stops[i][0] + '" stop-color="' + stops[i][1] + '"' +
        (stops[i][2] != null ? ' stop-opacity="' + stops[i][2] + '"' : '') + '/>';
    }
    return o;
  }

  // 硬色塊（條紋）漸層的 stop
  function hardStops(colors) {
    var st = [], n = colors.length;
    for (var i = 0; i < n; i++) {
      st.push([r1(i / n), colors[i]]);
      st.push([r1((i + 1) / n), colors[i]]);
    }
    return st;
  }

  function Ctx(prefix) {
    this.p = prefix;
    this.defs = [];
  }
  Ctx.prototype.rad = function (n, stops, cx, cy, r) {
    var id = this.p + n;
    this.defs.push('<radialGradient id="' + id + '" cx="' + (cx == null ? 0.38 : cx) +
      '" cy="' + (cy == null ? 0.3 : cy) + '" r="' + (r || 0.85) + '">' + stopsStr(stops) + '</radialGradient>');
    return 'url(#' + id + ')';
  };
  // 線性漸層；abs 有值時用 userSpaceOnUse，座標為絕對座標，否則是 0~1 的物件比例
  Ctx.prototype.lin = function (n, x1, y1, x2, y2, stops, abs) {
    var id = this.p + n;
    this.defs.push('<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"' +
      (abs ? ' gradientUnits="userSpaceOnUse"' : '') + '>' + stopsStr(stops) + '</linearGradient>');
    return 'url(#' + id + ')';
  };

  function stroke(c, w) {
    return ' stroke="' + c + '" stroke-width="' + (w == null ? SW : w) + '" stroke-linejoin="round" stroke-linecap="round"';
  }
  function E(cx, cy, rx, ry, fill, line, tr, op) {
    return '<ellipse cx="' + r1(cx) + '" cy="' + r1(cy) + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '" fill="' + fill + '"' +
      (line ? stroke(line) : '') + (tr ? ' transform="' + tr + '"' : '') + (op != null ? ' opacity="' + op + '"' : '') + '/>';
  }
  function C(cx, cy, r, fill, line, op, sw) {
    return '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '" fill="' + fill + '"' +
      (line ? stroke(line, sw) : '') + (op != null ? ' opacity="' + op + '"' : '') + '/>';
  }
  function P(d, fill, line, op, sw) {
    return '<path d="' + d + '" fill="' + fill + '"' + (line ? stroke(line, sw) : '') +
      (op != null ? ' opacity="' + op + '"' : '') + '/>';
  }
  function L(x1, y1, x2, y2, col, w, op) {
    return '<path d="M' + r1(x1) + ',' + r1(y1) + ' L' + r1(x2) + ',' + r1(y2) + '" fill="none"' + stroke(col, w) +
      (op != null ? ' opacity="' + op + '"' : '') + '/>';
  }
  function G(tr, inner) { return '<g transform="' + tr + '">' + inner + '</g>'; }
  // 左右對稱：內容畫左半，右半用鏡射複製
  function sym(inner) { return inner + G('translate(200 0) scale(-1 1)', inner); }

  // 一團圓（雲朵）：先畫一圈粗描邊再填色，邊緣就會連成一個整體
  function blob(cs, fill, line, hl) {
    var o = '', i;
    for (i = 0; i < cs.length; i++) o += C(cs[i][0], cs[i][1], cs[i][2], line, line, null, SW * 2);
    for (i = 0; i < cs.length; i++) o += C(cs[i][0], cs[i][1], cs[i][2], fill);
    if (hl) for (i = 0; i < cs.length; i++) o += C(cs[i][0] - cs[i][2] * 0.28, cs[i][1] - cs[i][2] * 0.33, cs[i][2] * 0.3, '#ffffff', null, 0.65);
    return o;
  }

  // 葉片／花瓣／光芒（尖端朝上，ang 為順時針角度）
  function leaf(x, y, ang, len, w, fill, line, vein) {
    var d = 'M0,0 C' + w + ',' + r1(-len * 0.3) + ' ' + r1(w * 0.9) + ',' + r1(-len * 0.8) + ' 0,' + (-len) +
      ' C' + r1(-w * 0.9) + ',' + r1(-len * 0.8) + ' ' + (-w) + ',' + r1(-len * 0.3) + ' 0,0Z';
    return G('translate(' + r1(x) + ' ' + r1(y) + ') rotate(' + ang + ')',
      P(d, fill, line) + (vein ? L(0, -3, 0, -len * 0.78, vein, 1.6, 0.55) : ''));
  }

  function star5(cx, cy, r, fill, line, sw) {
    var pts = [], i, a, rr;
    for (i = 0; i < 10; i++) {
      a = -Math.PI / 2 + i * Math.PI / 5;
      rr = (i % 2 === 0) ? r : r * 0.48;
      pts.push(r1(cx + Math.cos(a) * rr) + ',' + r1(cy + Math.sin(a) * rr));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '"' + (line ? stroke(line, sw || 1.6) : '') + '/>';
  }

  function sparkle(x, y, r, col) {
    return P('M' + x + ',' + (y - r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y + ' Q' + x + ',' + y + ' ' + x + ',' + (y + r) +
      ' Q' + x + ',' + y + ' ' + (x - r) + ',' + y + ' Q' + x + ',' + y + ' ' + x + ',' + (y - r) + 'Z', col, null);
  }

  // ---------------------------------------------------------------- 尾巴
  function bez(p, t) {
    var u = 1 - t;
    return [
      u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
      u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]
    ];
  }
  // 沿尾巴取一段（t 範圍）、橫向取一段（fa~fb，-1~1）的多邊形
  function tailPoly(p, w0, w1, ta, tb, fa, fb) {
    var N = 18, left = [], right = [], i, t, c, c1, c2, dx, dy, d, nx, ny, half;
    for (i = 0; i <= N; i++) {
      t = ta + (tb - ta) * i / N;
      c = bez(p, t);
      c1 = bez(p, Math.max(0, t - 0.01));
      c2 = bez(p, Math.min(1, t + 0.01));
      dx = c2[0] - c1[0]; dy = c2[1] - c1[1];
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / d; ny = dx / d;
      half = (w0 + (w1 - w0) * t) / 2;
      left.push(r1(c[0] + nx * half * fa) + ',' + r1(c[1] + ny * half * fa));
      right.push(r1(c[0] + nx * half * fb) + ',' + r1(c[1] + ny * half * fb));
    }
    return 'M' + left.join(' L') + ' L' + right.reverse().join(' L') + 'Z';
  }

  function snowflake(x, y, r, col, line) {
    var o = '', k, a, ex, ey, bx, by, bl = r * 0.38, parts = '';
    for (k = 0; k < 3; k++) {
      a = k * Math.PI / 3;
      ex = Math.cos(a) * r; ey = Math.sin(a) * r;
      parts += 'M' + r1(x - ex) + ',' + r1(y - ey) + ' L' + r1(x + ex) + ',' + r1(y + ey);
      [1, -1].forEach(function (sg) {
        bx = x + Math.cos(a) * r * 0.62 * sg; by = y + Math.sin(a) * r * 0.62 * sg;
        [-1, 1].forEach(function (sd) {
          var aa = a + (sg > 0 ? 0 : Math.PI) + sd * 0.75;
          parts += 'M' + r1(bx) + ',' + r1(by) + ' L' + r1(bx + Math.cos(aa) * bl) + ',' + r1(by + Math.sin(aa) * bl);
        });
      });
    }
    o += '<path d="' + parts + '" fill="none"' + stroke(line, 4.2) + '/>';
    o += '<path d="' + parts + '" fill="none"' + stroke(col, 2) + '/>';
    return o;
  }

  function tailTip(kind, x, y, s) {
    var o = '', i;
    if (kind === 'cloud') {
      o = blob([[x, y - 3, 9], [x + 9, y + 2, 7], [x - 8, y + 3, 7], [x + 1, y + 8, 6]], '#f4efff', s.line, true);
    } else if (kind === 'snow') {
      o = snowflake(x, y - 2, 13, '#ffffff', s.line);
    } else if (kind === 'bow') {
      o = P('M' + x + ',' + y + ' L' + (x - 17) + ',' + (y - 10) + ' L' + (x - 17) + ',' + (y + 10) + 'Z', '#8ff0cc', s.line) +
        P('M' + x + ',' + y + ' L' + (x + 17) + ',' + (y - 10) + ' L' + (x + 17) + ',' + (y + 10) + 'Z', '#8ff0cc', s.line) +
        C(x, y, 6, '#ffe46b', s.line);
    } else if (kind === 'flame') {
      o = leaf(x, y + 2, -32, 24, 8, '#ff9a2e', s.line) + leaf(x, y + 2, 32, 24, 8, '#ff9a2e', s.line) +
        leaf(x, y + 2, 0, 32, 10, '#ffd23f', s.line);
    } else if (kind === 'star') {
      o = star5(x, y - 2, 13, '#ffe066', s.line, 2.6);
    } else if (kind === 'flower') {
      for (i = 0; i < 5; i++) {
        var a = i * 2 * Math.PI / 5 - Math.PI / 2;
        o += C(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6, '#ff8fb4', s.line, null, 2.4);
      }
      o += C(x, y, 5, '#ffe066', s.line, null, 2.4);
    } else if (kind === 'leaves') {
      o = leaf(x, y + 2, -38, 24, 8, '#7cc95a', s.line, '#3f7a2a') + leaf(x, y + 2, 38, 24, 8, '#7cc95a', s.line, '#3f7a2a') +
        leaf(x, y + 2, 0, 30, 9, '#9be070', s.line, '#3f7a2a');
    }
    return o;
  }

  function tail(c, s, pose) {
    var p = pose === 'sad' ? [[124, 160], [146, 181], [162, 183], [170, 173]]
      : pose === 'cheer' ? [[124, 156], [156, 170], [186, 156], [178, 124]]
        : [[124, 158], [156, 174], [184, 160], [178, 128]];
    var w0 = 22, w1 = s.tail === 'rainbow' ? 10 : 8, o = '', i, cols, N;
    o += '<path d="' + tailPoly(p, w0, w1, 0, 1, 1, -1) + '" fill="' + s.line + '"' + stroke(s.line, SW * 2) + '/>';
    if (s.tail === 'rainbow') {
      N = RAINBOW.length;
      for (i = 0; i < N; i++) o += '<path d="' + tailPoly(p, w0, w1, i / N, (i + 1) / N + (i < N - 1 ? 0.01 : 0), 1, -1) + '" fill="' + RAINBOW[i] + '"/>';
    } else if (s.tail === 'candy') {
      N = 6;
      for (i = 0; i < N; i++) o += '<path d="' + tailPoly(p, w0, w1, i / N, (i + 1) / N + (i < N - 1 ? 0.01 : 0), 1, -1) + '" fill="' + (i % 2 ? '#fff4f9' : s.body[1]) + '"/>';
    } else {
      o += '<path d="' + tailPoly(p, w0, w1, 0, 1, 1, -1) + '" fill="' + c.lin('tl', 0, 0, 0, 1, [[0, s.body[0]], [0.55, s.body[1]], [1, s.body[2]]]) + '"/>';
    }
    o += '<path d="' + tailPoly(p, w0, w1, 0.05, 0.9, -0.75, -0.38) + '" fill="#ffffff" opacity="0.4"/>';
    var e = p[3];
    return o + tailTip(s.tip, e[0], e[1], s);
  }

  // ---------------------------------------------------------------- 翅膀（左邊畫，右邊鏡射）
  function wingLeft(c, s) {
    var k = s.wing, o = '';
    if (k === 'sweep') {
      var fill = s.id === 'moon' ? c.lin('wg', 0, 0, 1, 1, [[0, '#a898f0'], [1, '#6b59c8']]) :
        c.lin('wg', 78, 126, 30, 88, hardStops(['#ffb3d1', '#ffe7a0', '#b5e3ff']), true);
      o = P('M78,128 C58,130 34,118 28,88 C42,96 52,94 60,86 C60,100 68,110 82,114Z', fill, s.line);
      if (s.id === 'moon') o += star5(50, 108, 5, '#ffe066', null);
    } else if (k === 'cloud') {
      o = blob([[50, 112, 13], [38, 100, 11], [56, 98, 12], [44, 88, 9]], '#f4efff', s.line, true);
    } else if (k === 'round') {
      o = E(50, 108, 24, 15, '#a8f0d6', s.line, 'rotate(-38 50 108)') +
        C(42, 100, 3.6, '#fff3a0') + C(54, 112, 3.2, '#fff3a0') + C(36, 112, 2.6, '#ffffff');
    } else if (k === 'rays') {
      o = leaf(76, 124, -86, 46, 10, '#ff9a2e', s.line) + leaf(76, 124, -62, 52, 11, '#ffd23f', s.line) + leaf(76, 124, -38, 46, 10, '#ff9a2e', s.line);
    } else if (k === 'leaf') {
      o = leaf(78, 126, -74, 44, 14, '#6fcf63', s.line, '#2f7a30') + leaf(78, 126, -46, 62, 18, '#9be070', s.line, '#2f7a30');
    } else if (k === 'crystal') {
      o = P('M80,124 L48,122 L24,92 L62,104Z', '#cdeefb', s.line) + L(80, 124, 28, 94, '#ffffff', 2, 0.8) +
        P('M78,128 L52,142 L38,124 L68,120Z', '#e6f8ff', s.line) + P('M62,104 L50,86 L74,98Z', '#ffffff', s.line, 0.9);
    } else if (k === 'feather') {
      o = leaf(78, 124, -84, 48, 12, '#d9a56c', s.line, '#8a5530') + leaf(78, 124, -62, 56, 13, '#e8c08a', s.line, '#8a5530') +
        leaf(78, 124, -40, 50, 12, '#d9a56c', s.line, '#8a5530');
    }
    return o;
  }

  // ---------------------------------------------------------------- 角／頭飾
  function hornsBack(c, s) {
    var k = s.horn, o = '', i;
    if (k === 'rainbow') {
      var f = c.lin('hr', 0, 1, 0, 0, hardStops(['#ff6b8b', '#ffa24a', '#ffd84a', '#5fd88a', '#5aaeff']));
      o = sym(G('translate(80 54) rotate(-24)', P('M-12,0 Q-11,-28 0,-46 Q11,-28 12,0Z', f, s.line)));
    } else if (k === 'cloud') {
      o = sym(blob([[72, 44, 10], [61, 40, 8], [82, 38, 8], [70, 32, 8.5]], '#fbf9ff', s.line, true));
    } else if (k === 'lolly') {
      var sp = '', th, rr;
      for (i = 0; i <= 40; i++) {
        th = i * 0.55; rr = 1 + th * 0.55;
        sp += (i ? ' L' : 'M') + r1(62 + Math.cos(th) * rr) + ',' + r1(25 + Math.sin(th) * rr);
      }
      o = sym(L(81, 54, 67, 34, s.line, 8) + L(81, 54, 67, 34, '#fff7ee', 3.4) +
        C(62, 25, 14, '#d4fbea', s.line) + '<path d="' + sp + '" fill="none"' + stroke('#3fcfa0', 3) + '/>' + C(56, 18, 2.6, '#ffffff', null, 0.9));
    } else if (k === 'mane') {
      var n = 14, cx = 100, cy = 82, a, long, col;
      for (i = 0; i < n; i++) {
        a = i * 360 / n;
        long = (i % 2 === 0);
        col = long ? '#ff9a2e' : '#ffd23f';
        o += leaf(cx + Math.sin(a * Math.PI / 180) * 42, cy - Math.cos(a * Math.PI / 180) * 38, a, long ? 36 : 28, long ? 13 : 11, col, s.line);
      }
    } else if (k === 'crescent') {
      var cg = c.lin('cr', 0, 0, 1, 1, [[0, '#fff3b0'], [1, '#ffcf4a']]);
      o = sym(G('translate(80 54) rotate(-10)', P('M8,2 C-2,-8 -2,-30 -20,-42 C-2,-46 14,-30 14,-10Z', cg, s.line)));
    } else if (k === 'crystal') {
      var kg = c.lin('kr', 0, 0, 1, 1, [[0, '#ffffff'], [1, '#9fdcf5']]);
      var one = function (x, y, a, sc) {
        return G('translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + sc + ')',
          P('M-9,0 L-11,-22 L0,-42 L11,-22 L9,0Z', kg, s.line) +
          P('M-11,-22 L0,-42 L0,0 L-9,0Z', '#ffffff', null, 0.55) + L(-11, -22, 11, -22, s.line, 1.6, 0.5));
      };
      o = sym(one(78, 54, -24, 1)) + one(100, 46, 0, 0.62);
    } else if (k === 'antler') {
      o = sym(L(82, 56, 66, 30, s.line, 8) + L(82, 56, 66, 30, '#9a6034', 4) + L(74, 42, 60, 42, s.line, 7) + L(74, 42, 60, 42, '#9a6034', 3) +
        leaf(66, 32, -22, 26, 9, '#7cc95a', s.line, '#3f7a2a') + leaf(62, 42, -78, 22, 8, '#7cc95a', s.line, '#3f7a2a') +
        leaf(72, 40, 8, 20, 7, '#9be070', s.line, '#3f7a2a'));
    }
    return o;
  }

  function ears(c, s) {
    var o = '';
    if (s.ear === 'round') {
      o = sym(E(54, 62, 12, 14, s.body[1], s.line, 'rotate(-30 54 62)') + E(54, 63, 6, 8, s.earColor, null, 'rotate(-30 54 62)'));
    } else if (s.ear === 'point') {
      o = sym(leaf(56, 70, -68, 30, 11, s.body[1], s.line) + leaf(56, 70, -68, 20, 6, s.earColor, null));
    } else if (s.ear === 'fluff') {
      o = sym(blob([[50, 72, 9], [43, 84, 8], [53, 90, 8]], '#f4efff', s.line, true));
    }
    return o;
  }

  function headFront(c, s) {
    var o = '', i, a, rad, x, y;
    if (s.collar) {
      // 一圈花瓣頭飾
      var cols = ['#ff8fb4', '#fff4f8'];
      for (i = -4; i <= 4; i++) {
        a = i * 17;
        x = 100 + Math.sin(a * Math.PI / 180) * 48; y = 80 - Math.cos(a * Math.PI / 180) * 41;
        if (i === 0) continue;
        o += leaf(x, y, a, 20, 9, cols[Math.abs(i) % 2], s.line);
      }
      for (i = 0; i < 5; i++) {
        a = i * 72;
        o += leaf(100 + Math.sin(a * Math.PI / 180) * 3, 43 - Math.cos(a * Math.PI / 180) * 3, a, 17, 8, '#ff7aa5', s.line);
      }
      o += C(100, 43, 5.5, '#ffe066', s.line, null, 2.4);
    }
    if (s.mushroom) {
      o += P('M108,50 L108,41 Q112,38 116,41 L116,50Z', '#fff5dc', s.line) +
        P('M96,43 Q112,18 128,43 Q112,47 96,43Z', '#ee7a52', s.line) +
        C(106, 35, 2.6, '#fff5dc') + C(117, 32, 2.8, '#fff5dc') + C(122, 40, 2, '#fff5dc');
    }
    return o;
  }

  // ---------------------------------------------------------------- 臉
  function eyeDark(x, y, s, big) {
    var o = E(x, y, 9.5, 11, s.eye, null) + C(x - 3.2, y - 4, big ? 4.2 : 3.4, '#ffffff') + C(x + 3.4, y + 3.8, 1.8, '#ffffff', null, 0.95);
    return o;
  }
  function eyeMoon(x, y, s, big) {
    return E(x, y, 12, 13, '#ffd84a', s.line) + E(x, y + 1, 6.4, 8.4, s.eye, null) +
      C(x - 3, y - 3.6, big ? 3.8 : 3, '#ffffff') + C(x + 2.8, y + 4.2, 1.6, '#ffffff', null, 0.95);
  }
  function eyeClosed(x, y, col) {
    return '<path d="M' + (x - 9) + ',' + (y + 3) + ' Q' + x + ',' + (y - 10) + ' ' + (x + 9) + ',' + (y + 3) + '" fill="none"' + stroke(col, 3.6) + '/>';
  }

  function face(c, s, pose) {
    var o = '', ex = [76, 124], ey = 86, i;
    // 嘴鼻部
    o += E(100, 104, 23, 15, s.muzzle, null, null, 0.92);
    o += C(94, 98.5, 1.7, s.mouth, null, 0.55) + C(106, 98.5, 1.7, s.mouth, null, 0.55);
    // 腮紅
    var cw = s.cheekBig ? 12 : 9.5, ch = s.cheekBig ? 8.5 : 6.5;
    o += E(62, 103, cw, ch, s.cheek, null, null, s.cheekBig ? 0.9 : 0.75) + E(138, 103, cw, ch, s.cheek, null, null, s.cheekBig ? 0.9 : 0.75);
    o += E(58, 101, 3.2, 1.8, '#ffffff', null, null, 0.5) + E(134, 101, 3.2, 1.8, '#ffffff', null, null, 0.5);
    // 眼睛
    var moon = s.eyeIdle === 'moon';
    var closedCol = s.closed || s.eye;
    for (i = 0; i < 2; i++) {
      var x = ex[i], y = ey;
      if (pose === 'cheer' || (pose === 'idle' && s.eyeIdle === 'smile')) {
        o += eyeClosed(x, y, closedCol);
      } else if (pose === 'sad') {
        o += moon ? eyeMoon(x, y + 2, s, true) : eyeDark(x, y + 2, s, true);
      } else {
        o += moon ? eyeMoon(x, y, s) : eyeDark(x, y, s);
      }
    }
    // 眉毛與淚光
    if (pose === 'sad') {
      var bc = s.brow || s.line;
      o += L(65, 75, 85, 68, bc, 3.2) + L(135, 75, 115, 68, bc, 3.2);
      o += '<path d="M64,102 Q60,110 64,114 Q69,110 64,102Z" fill="#cdeeff" opacity="0.9"' + stroke('#7fbfe6', 1.6) + '/>' +
        C(63, 110, 1.3, '#ffffff') +
        '<path d="M136,102 Q132,110 136,114 Q141,110 136,102Z" fill="#cdeeff" opacity="0.9"' + stroke('#7fbfe6', 1.6) + '/>' +
        C(135, 110, 1.3, '#ffffff');
    }
    // 嘴
    if (pose === 'shoot') {
      o += E(100, 109, 8.5, 9.5, '#7d2e4a', s.mouth) + E(100, 114, 5.2, 3.6, '#ff8fa8', null);
    } else if (pose === 'cheer') {
      o += P('M87,102 Q100,132 113,102Z', '#7d2e4a', s.mouth) + E(100, 112, 6.5, 4, '#ff8fa8', null);
    } else if (pose === 'sad') {
      o += '<path d="M92,112 Q100,105 108,112" fill="none"' + stroke(s.mouth, 3) + '/>';
    } else {
      o += '<path d="M91,105 Q95.5,111 100,106 Q104.5,111 109,105" fill="none"' + stroke(s.mouth, 3) + '/>';
    }
    return o;
  }

  // 頭上／身上的斑紋
  function headMarks(c, s) {
    var o = '';
    if (s.pattern === 'candy') {
      o += C(71, 55, 4, '#7ee8c4', null, 0.95) + C(129, 58, 4, '#ffe46b', null, 0.95) + C(100, 47, 3.4, '#c9a8ff', null, 0.95);
    } else if (s.pattern === 'moon') {
      o += star5(100, 52, 5.5, '#ffe066', null) + star5(126, 60, 3.6, '#ffe066', null) + star5(74, 62, 3.6, '#ffe066', null);
    } else if (s.pattern === 'frost') {
      o += snowflake(100, 52, 6, '#ffffff', 'rgba(90,155,184,0.0)');
    } else if (s.pattern === 'forest') {
      o += E(78, 56, 4, 2.6, '#e9c9a0', null, null, 0.8) + E(122, 54, 3.6, 2.4, '#e9c9a0', null, null, 0.8) + E(100, 50, 3, 2, '#e9c9a0', null, null, 0.8);
    }
    return o;
  }

  function bodyMarks(c, s) {
    var o = '', i, th, rr, sp;
    if (s.pattern === 'candy') {
      sp = '';
      for (i = 0; i <= 46; i++) {
        th = i * 0.45; rr = 1.5 + th * 1.0;
        sp += (i ? ' L' : 'M') + r1(100 + Math.cos(th) * rr * 1.0) + ',' + r1(150 + Math.sin(th) * rr * 1.05);
      }
      o += '<path d="' + sp + '" fill="none"' + stroke('#4fd9ad', 3.2) + '/>';
      o += C(72, 140, 5, '#7ee8c4', null, 0.95) + C(129, 150, 4.6, '#ffe46b', null, 0.95) + C(73, 160, 4, '#c9a8ff', null, 0.95) + C(127, 130, 3.6, '#ffffff', null, 0.8);
    } else if (s.pattern === 'moon') {
      o += star5(74, 138, 5.5, '#ffe066', null) + star5(128, 152, 4.6, '#ffe066', null) + star5(80, 162, 3.6, '#ffe066', null) + star5(126, 130, 3.6, '#ffe066', null);
    } else if (s.pattern === 'frost') {
      o += snowflake(75, 140, 5, '#ffffff', 'rgba(90,155,184,0.0)') + snowflake(127, 152, 4.2, '#ffffff', 'rgba(90,155,184,0.0)');
    } else if (s.pattern === 'forest') {
      o += E(76, 140, 4, 2.8, '#e9c9a0', null, null, 0.8) + E(126, 134, 3.6, 2.4, '#e9c9a0', null, null, 0.8) + E(128, 158, 3.4, 2.4, '#e9c9a0', null, null, 0.8);
    }
    return o;
  }

  // ---------------------------------------------------------------- 手腳
  function arm(s, sx, sy, hx, hy, scale) {
    var W = 14, dx = hx - sx, dy = hy - sy, d = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / d, uy = dy / d, px = -uy, py = ux;
    var hr = 9 * (scale || 1), o = '', k;
    o += L(sx, sy, hx, hy, s.line, W + 6);
    for (k = -1; k <= 1; k++) o += C(hx + ux * hr * 0.75 + px * k * hr * 0.62, hy + uy * hr * 0.75 + py * k * hr * 0.62, hr * 0.42, s.toe, s.line, null, 2.4);
    o += C(hx, hy, hr, s.body[1], s.line);
    o += L(sx, sy, hx, hy, s.body[1], W);
    o += L(sx + px * 3, sy + py * 3, hx + px * 3 - ux * 2, hy + py * 3 - uy * 2, '#ffffff', 2.6, 0.35);
    return o;
  }

  function foot(x, y, s, g) {
    var o = '', k;
    for (k = -1; k <= 1; k++) o += C(x + k * 10, y + 8.5 + (k === 0 ? 3 : 0), 5.3, s.toe, s.line, null, 2.6);
    o += E(x, y, 17, 11, g, s.line);
    o += E(x - 5, y - 4, 6, 3, '#ffffff', null, 'rotate(-12 ' + (x - 5) + ' ' + (y - 4) + ')', 0.4);
    return o;
  }

  // ---------------------------------------------------------------- 組裝
  function build(id, pose, faceOnly) {
    var s = SPEC[id] || SPEC.rainbow;
    s.id = SPEC[id] ? id : 'rainbow';
    var meta = DRAGONS.filter(function (d) { return d.id === s.id; })[0];
    var c = new Ctx(faceOnly ? 'drf-' + s.id + '-' : 'drg-' + s.id + '-' + pose + '-');
    if (faceOnly) pose = 'idle';

    var gHead = c.rad('hd', [[0, s.body[0]], [0.55, s.body[1]], [1, s.body[2]]], 0.36, 0.28, 0.85);
    var gBody = c.rad('bd', [[0, s.body[0]], [0.55, s.body[1]], [1, s.body[2]]], 0.4, 0.3, 0.9);
    var gBelly = c.rad('bl', [[0, s.belly[0]], [1, s.belly[1]]], 0.5, 0.35, 0.8);
    var gFoot = c.rad('ft', [[0, s.body[0]], [0.6, s.body[1]], [1, s.body[2]]], 0.4, 0.25, 0.9);

    var head = '';
    head += hornsBack(c, s) + ears(c, s);
    head += E(100, 82, 52, 44, gHead, s.line);
    head += E(76, 56, 15, 7, '#ffffff', null, 'rotate(-28 76 56)', 0.5) + C(60, 66, 2.6, '#ffffff', null, 0.55);
    head += headMarks(c, s) + face(c, s, pose) + headFront(c, s);

    if (faceOnly) {
      var f = s.face || [0.68, 72];
      var sc = f[0], cy = f[1];
      var tx = r1(50 - 100 * sc), ty = r1(50 - cy * sc);
      return svgWrap('0 0 100 100', 100, meta.name + '頭像', c, G('translate(' + tx + ' ' + ty + ') scale(' + sc + ')', head));
    }

    // 身體
    var bodyG = '';
    bodyG += tail(c, s, pose);
    bodyG += sym(wingLeft(c, s));
    bodyG += E(100, 143, 37, 33, gBody, s.line);
    bodyG += E(100, 148, 23, 25, gBelly, null);
    bodyG += E(84, 126, 9, 5, '#ffffff', null, 'rotate(-25 84 126)', 0.35);
    bodyG += bodyMarks(c, s);
    bodyG += foot(80, 168, s, gFoot) + foot(120, 168, s, gFoot);

    // 手的位置：依姿勢
    var armsFront = '', armsBack = '';
    if (pose === 'shoot') {
      armsFront = arm(s, 68, 130, 89, 140, 1.2) + arm(s, 132, 130, 111, 140, 1.2);
    } else if (pose === 'cheer') {
      armsBack = arm(s, 68, 128, 42, 78, 1.1) + arm(s, 132, 128, 158, 78, 1.1);
    } else if (pose === 'sad') {
      armsFront = arm(s, 66, 130, 62, 154, 1) + arm(s, 134, 130, 138, 154, 1);
    } else {
      armsFront = arm(s, 66, 130, 55, 152, 1) + arm(s, 134, 130, 145, 152, 1);
    }

    var inner = bodyG + armsBack + head + armsFront;
    var shadow = E(100, 184, pose === 'cheer' ? 40 : 52, 6, s.line, null, null, 0.16);
    var extra = '';
    if (pose === 'cheer') {
      inner = G('translate(0 -5)', inner);
      extra = sparkle(24, 52, 7, '#ffd84a') + sparkle(176, 46, 8, meta.accent) + sparkle(22, 124, 6, '#ff8fb4') +
        sparkle(180, 118, 6, '#7fd3f0') + C(40, 28, 2.6, '#ff8fb4') + C(162, 24, 2.6, '#ffd84a') + C(184, 82, 2.4, '#7fe0b8');
    } else if (pose === 'shoot') {
      extra =
        L(30, 112, 40, 116, meta.accent, 3.4) + L(26, 126, 38, 126, meta.accent, 3.4) + L(30, 140, 40, 136, meta.accent, 3.4) +
        L(170, 112, 160, 116, meta.accent, 3.4) + L(174, 126, 162, 126, meta.accent, 3.4) + L(170, 140, 160, 136, meta.accent, 3.4);
    }
    return svgWrap('0 0 200 200', 200, meta.name, c, shadow + inner + extra);
  }

  function svgWrap(vb, size, label, c, body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + size + '" height="' + size +
      '" role="img" aria-label="' + label + '"><defs>' + c.defs.join('') + '</defs>' + body + '</svg>';
  }

  // ---------------------------------------------------------------- 對外介面
  root.Art = root.Art || {};
  root.Art.DRAGONS = DRAGONS;
  root.Art.dragonSVG = function (id, pose) {
    if (pose !== 'shoot' && pose !== 'cheer' && pose !== 'sad') pose = 'idle';
    return build(id, pose, false);
  };
  root.Art.dragonFaceSVG = function (id) {
    return build(id, 'idle', true);
  };
})(typeof self !== 'undefined' ? self : this);
