/* 彩虹泡泡砲 — 地圖資料模組（layouts.js）
 * 規格：docs/介面規格.md 第 2、3 節。
 * 瀏覽器掛 root.Layouts；Node 用 module.exports。零依賴，亂數一律使用傳入的 rng。
 *
 * 地圖字元：. 空格；a~f 顏色槽；A~F 帶星星標記；# 隨機色；* 隨機色＋星星；+ 隨機色＋獎勵；X 雲朵磚
 * 版面：偶數列長 = 欄數，奇數列長 = 欄數-1（六角交錯，奇數列向右偏半格）
 */
(function (root) {
  'use strict';

  var LEGAL = '.abcdefABCDEF#*+X';
  var X_MAX_RATIO = 0.2; // X 佔非空格的比例上限

  // ---------- 基本工具 ----------
  function rowLen(r, cols) { return r % 2 === 0 ? cols : cols - 1; }

  // 六角交錯的相鄰格：偶數列第 c 格的上下相鄰是奇數列的 c-1、c；奇數列第 c 格的上下相鄰是偶數列的 c、c+1
  function neighbors(r, c, lens) {
    var out = [];
    if (c > 0) out.push([r, c - 1]);
    if (c < lens[r] - 1) out.push([r, c + 1]);
    var d, cs, i;
    for (d = -1; d <= 1; d += 2) {
      var rr = r + d;
      if (rr < 0 || rr >= lens.length) continue;
      cs = (r % 2 === 0) ? [c - 1, c] : [c, c + 1];
      for (i = 0; i < 2; i++) {
        if (cs[i] >= 0 && cs[i] < lens[rr]) out.push([rr, cs[i]]);
      }
    }
    return out;
  }

  // 從第 0 列的非空格出發，回傳可到達的格子集合（key = r*100+c）
  function reachable(rows) {
    var lens = rows.map(function (s) { return s.length; });
    var seen = {};
    var queue = [];
    var c, k;
    for (c = 0; c < rows[0].length; c++) {
      if (rows[0].charAt(c) !== '.') { seen[c] = true; queue.push([0, c]); }
    }
    while (queue.length) {
      var cur = queue.pop();
      var ns = neighbors(cur[0], cur[1], lens);
      for (k = 0; k < ns.length; k++) {
        var nr = ns[k][0], nc = ns[k][1];
        var key = nr * 100 + nc;
        if (seen[key] || rows[nr].charAt(nc) === '.') continue;
        seen[key] = true;
        queue.push([nr, nc]);
      }
    }
    return seen;
  }

  function countCells(rows) {
    var n = 0, r, c;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) if (rows[r].charAt(c) !== '.') n++;
    }
    return n;
  }

  function countChar(rows, ch) {
    var n = 0, r, c;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) if (rows[r].charAt(c) === ch) n++;
    }
    return n;
  }

  function setChar(s, i, ch) { return s.substring(0, i) + ch + s.substring(i + 1); }

  // 補救：刪掉孤立格、去掉尾端空列、第 0 列全空時補一格、X 過多時換成 #
  function prune(rows, cols) {
    var out = rows.slice();
    var r, c;
    var any = false;
    for (c = 0; c < out[0].length; c++) if (out[0].charAt(c) !== '.') any = true;
    if (!any) out[0] = setChar(out[0], Math.floor(out[0].length / 2), 'a');
    var seen = reachable(out);
    for (r = 0; r < out.length; r++) {
      for (c = 0; c < out[r].length; c++) {
        if (out[r].charAt(c) !== '.' && !seen[r * 100 + c]) out[r] = setChar(out[r], c, '.');
      }
    }
    while (out.length > 1 && /^\.*$/.test(out[out.length - 1])) out.pop();
    var total = countCells(out);
    var xs = countChar(out, 'X');
    for (r = out.length - 1; r >= 0 && xs > total * X_MAX_RATIO; r--) {
      for (c = out[r].length - 1; c >= 0 && xs > total * X_MAX_RATIO; c--) {
        if (out[r].charAt(c) === 'X') { out[r] = setChar(out[r], c, '#'); xs--; }
      }
    }
    return out;
  }

  // 非空格太少時，從第 0 列往下整列填滿，直到數量足夠（整列填滿必定連通）
  function ensureMin(rows, cols, minCells, slot) {
    var out = rows.slice();
    var r = 0;
    while (countCells(out) < minCells && r < 12) {
      if (r >= out.length) out.push(new Array(rowLen(r, cols) + 1).join('.'));
      var s = '', c;
      for (c = 0; c < out[r].length; c++) s += (out[r].charAt(c) === '.' ? slot : out[r].charAt(c));
      out[r] = s;
      r++;
    }
    return out;
  }

  // ---------- 驗證 ----------
  function validate(rows, cols) {
    var problems = [];
    if (!Array.isArray(rows) || rows.length < 1) {
      return { ok: false, problems: ['rows 必須是至少一列的字串陣列'] };
    }
    var r, c;
    for (r = 0; r < rows.length; r++) {
      var s = rows[r];
      if (typeof s !== 'string') { problems.push('第 ' + r + ' 列不是字串'); continue; }
      var want = rowLen(r, cols);
      if (s.length !== want) problems.push('第 ' + r + ' 列長度 ' + s.length + '，應為 ' + want);
      for (c = 0; c < s.length; c++) {
        if (LEGAL.indexOf(s.charAt(c)) < 0) { problems.push('第 ' + r + ' 列第 ' + c + ' 格有非法字元「' + s.charAt(c) + '」'); break; }
      }
    }
    if (problems.length) return { ok: false, problems: problems };

    var first = false;
    for (c = 0; c < rows[0].length; c++) if (rows[0].charAt(c) !== '.') first = true;
    if (!first) { problems.push('第 0 列沒有任何非空格'); return { ok: false, problems: problems }; }

    var seen = reachable(rows);
    var lost = 0;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) {
        if (rows[r].charAt(c) !== '.' && !seen[r * 100 + c]) lost++;
      }
    }
    if (lost > 0) problems.push('有 ' + lost + ' 格沒有連回第 0 列');

    var total = countCells(rows);
    var xs = countChar(rows, 'X');
    if (xs > total * X_MAX_RATIO) problems.push('X 共 ' + xs + ' 格，超過非空格 ' + total + ' 的 20%');
    return { ok: problems.length === 0, problems: problems };
  }

  // ---------- 重採樣（W=10 → 其他欄數，用相對 x 位置取最近格） ----------
  function resample(rows, cols) {
    var srcCols = rows[0].length;
    var out = [];
    var r, c;
    for (r = 0; r < rows.length; r++) {
      var src = rows[r];
      var tl = rowLen(r, cols);
      var s = '';
      for (c = 0; c < tl; c++) {
        // 格子中心的相對位置（偶數列中心在 c+0.5，奇數列在 c+1，單位為格寬）
        var rel = (r % 2 === 0 ? c + 0.5 : c + 1) / cols;
        var idx = r % 2 === 0 ? rel * srcCols - 0.5 : rel * srcCols - 1;
        var i = Math.floor(idx + 0.5);
        if (i < 0) i = 0;
        if (i > src.length - 1) i = src.length - 1;
        s += src.charAt(i);
      }
      out.push(s);
    }
    return prune(out, cols);
  }

  // ---------- 手設地圖 ----------
  var PATTERNS = [];
  function P(id, name, group, rows) {
    var joined = rows.join('');
    PATTERNS.push({
      id: id, name: name, group: group, rows: rows,
      obstacle: joined.indexOf('X') >= 0,
      special: /[A-F*+]/.test(joined)
    });
  }

  // 用函式一次產生整張圖的小幫手（只用在規律圖案）
  function grid(cols, n, fn) {
    var rows = [], r, c;
    for (r = 0; r < n; r++) {
      var s = '', tl = rowLen(r, cols);
      for (c = 0; c < tl; c++) s += fn(r, c, c + (r % 2 ? 0.5 : 0));
      rows.push(s);
    }
    return rows;
  }

  // ===== 動物 =====
  P('cat', '貓咪臉', '動物', [
    'aa......aa',
    'aaa...aaa',
    'aaaaaaaaaa',
    'acaaaaaca',
    'aaaaBbaaaa',
    '.aaaaaaa.',
    '..aaaaaa..'
  ]);
  P('rabbit', '小兔子', '動物', [
    '..aa..aa..',
    '..ab.ba..',
    '..ab..ba..',
    '..aaaaa..',
    '.aaaaaaaa.',
    '.acaaaca.',
    '.aaaaBaaa.',
    '..aaaaa..'
  ]);
  P('fish', '小魚', '動物', [
    '##########',
    '##.aaaa.a',
    '.aacaaaaaa',
    '#.aaaaa.a',
    '###....###'
  ]);
  P('butterfly', '蝴蝶', '動物', [
    'aaa.bb.aaa',
    'aaaabaaaa',
    'aaCabbacaa',
    'aaaabaaaa',
    '.aaabbaaa.',
    '..aabaa..'
  ]);
  P('bird', '小鳥', '動物', [
    'X.aaaa...X',
    '.acaaaaa.',
    'bbaaaaaaaa',
    '.aaaaaaa.',
    '..aaaaaa..',
    '...aaaa..',
    '....b.b...'
  ]);
  P('turtle', '烏龜', '動物', [
    '..aaaaaa..',
    '.acacaca.',
    'bbaaaaaaab',
    '.b.aaaa.b',
    '.bb....bb.'
  ]);
  P('panda', '熊貓', '動物', [
    'aaa....aaa',
    'aabbbbbaa',
    'bbaabbaabb',
    'bbbbbbbbb',
    'bbbbaabbbb',
    '.bbbbbbb.',
    '..bbbbbb..'
  ]);
  P('chick', '小雞', '動物', [
    '...aaaa...',
    '..acaaca.',
    '..aaBbaa..',
    '.aaaaaaa.',
    'aaaaaaaaaa',
    '.aaaaaaa.',
    '..aaaaaa..',
    '...b..b..'
  ]);
  P('dolphin', '海豚', '動物', [
    'X########X',
    '##.aaaa.a',
    '.aaaaaaaa.',
    'aacaaaaa.',
    'aa..aaaa..'
  ]);
  P('frog', '青蛙', '動物', [
    'aaa....aaa',
    'acaaaaaca',
    'aaaaaaaaaa',
    'abbb+bbba',
    'aaaaaaaaaa',
    '.aaaaaaa.',
    '.aa....aa.'
  ]);
  P('jellyfish', '水母', '動物', [
    '#X######X#',
    '##.aaaa.#',
    '.aaaaaaaa.',
    '.c.c.c.c.',
    '..c.c.c...',
    '.c.c.c...'
  ]);
  P('crab', '螃蟹', '動物', [
    'aa.c..c.aa',
    'a..c..c.a',
    'aaaaaaaaaa',
    'aaaaaaaaa',
    'Xa.aaaa.aX'
  ]);
  P('bee', '小蜜蜂', '動物', [
    '..cc..cc..',
    '..aaaaa..',
    '.abbabbaa.',
    '.abbabba.',
    '..aabbaa..',
    '....b....'
  ]);

  // ===== 形狀 =====
  P('heart', '愛心', '形狀', [
    '.aaa..aaa.',
    'abaaaaaaa',
    '.aaaaaaaa.',
    '.aaa+aaa.',
    '..aaaaaa..',
    '..aaaaa..',
    '...aaaa...',
    '...aaa...',
    '....aa....'
  ]);
  P('star', '星星', '形狀', [
    '....aa....',
    '...aaa...',
    'aaaaaaaaaa',
    '.aaaAaaa.',
    '..aaaaaa..',
    '..aaaaa..',
    '.aaa..aaa.',
    '.aa...aa.'
  ]);
  P('smile', '笑臉', '形狀', [
    '..aaaaaa..',
    '.aaaaaaa.',
    'aaacaacaaa',
    'aaaaaaaaa',
    'aabaaaabaa',
    '.aabbbba.',
    '..aaaaaa..'
  ]);
  P('moon', '彎彎月亮', '形狀', [
    '..aaaaa.b.',
    '.aaaa....',
    'aaaa......',
    'aaa......',
    'aaaa......',
    '.aaaa....',
    '..aaaaa...'
  ]);
  P('sun', '太陽公公', '形狀', [
    'X.b.bb.b.X',
    '.b.aaaa.b',
    '.baaaaaab.',
    '..aaa*aa.',
    '..baaaab..',
    '...b...b.'
  ]);
  P('cloud', '下雨雲朵', '形狀', [
    '..aa.aaa..',
    '.aaaaaaa.',
    'aaXaaaaXaa',
    '.b.b.b.b.',
    '..b.b.b...'
  ]);
  P('flower', '花朵', '形狀', [
    '...cccc...',
    '...ccc...',
    '...cccc...',
    '..aaaaa..',
    '.aaabbaaa.',
    '..aa*aa..',
    '...aaaa...'
  ]);
  P('gem', '鑽石', '形狀', [
    '.aaaaaaaa.',
    '.aabbbbaa',
    '..abbccba.',
    '...abcba.',
    '....aaaa..',
    '.....aa..'
  ]);
  P('crown', '皇冠', '形狀', [
    '.c..cc..c.',
    '.aa.aa.aa',
    'aaaaaaaaaa',
    'aabaabaab',
    'aaaaaaaaaa'
  ]);

  // ===== 物品 =====
  P('house', '小房子', '物品', [
    '....aa..X.',
    '...aaaa..',
    '..aaaaaa..',
    '.aaaaaaa.',
    'aaaaaaaaaa',
    '.bcbbbcb.',
    '.bbbccbb..',
    '.bbbccbb.'
  ]);
  P('icecream', '冰淇淋', '物品', [
    '..aa+aaa..',
    '.aaaaaaa.',
    '.bbbbbbbb.',
    '.ccccccc.',
    '..cccccc..',
    '..ccccc..',
    '...cccc...',
    '...ccc...',
    '....cc....'
  ]);
  P('balloon', '三顆氣球', '物品', [
    'X.a..b..cX',
    '..a..b..c',
    '.aa.bb.cc.',
    'aaab+bccc',
    '.aa.bb.cc.',
    '..a..b..c'
  ]);
  P('rocket', '火箭', '物品', [
    '....aa....',
    '...aaa...',
    '...bbbb...',
    '...bCb...',
    '...bbbb...',
    '..bbbbb..',
    '..a.bb.a..',
    '...ccc...',
    '....XX....'
  ]);
  P('umbrella', '雨傘', '物品', [
    '.abababab.',
    'ababababa',
    'ababababab',
    'a.a.a.a.a',
    '....c.....',
    '....c....',
    '....c.....',
    '...cc....'
  ]);
  P('castle', '城堡', '物品', [
    'a.a.aa.a.a',
    'aaaaaaaaa',
    'aacaaaacaa',
    'aXaaaaaXa',
    'aaaabbaaaa',
    'aaaabbaaa'
  ]);
  P('boat', '小帆船', '物品', [
    '##X####X##',
    '###cc.###',
    '.#.ccc.#..',
    '..cccc...',
    '..aaaaaa..',
    '...aaaa..'
  ]);
  P('cake', '生日蛋糕', '物品', [
    '..c..c..c.',
    '.aaaaaaa.',
    'aaaaaaaaaa',
    'bbbbbbbbb',
    'bbbb*bbbbb',
    '.aaaaaaa.'
  ]);
  P('mushroom', '蘑菇', '物品', [
    '..aaaaaa..',
    '.acaaaca.',
    'aaaCaaaaca',
    '...bbb...',
    '...bbbb...',
    '...bbb...',
    '..bbbbbb..'
  ]);
  P('tree', '蘋果樹', '物品', [
    '...aaaa...',
    '.aaaaaaa.',
    '.aacaaaaa.',
    'aaaaaaaaa',
    'aaaaaaacaa',
    '.aaaaaaa.',
    '....bb....',
    '....b....',
    '....bb....'
  ]);
  P('apple', '紅蘋果', '物品', [
    '....bb.cc.',
    '.aaabaaaa',
    'aaaaaaaaaa',
    'aaaaaaaaa',
    'aaaaaaaaaa',
    '.aaaaaaa.',
    '..aaaaaa..',
    '...aaaa..'
  ]);
  P('snowman', '雪人', '物品', [
    '....bb....',
    '...bbbb..',
    '.bbbbbbbb.',
    '..aaaaa..',
    '..abaaba..',
    '..ccccc..',
    '..aaaaaa..',
    '.aaabaaa.',
    '.aaaaaaaa.',
    '..aaaaaa.'
  ]);

  // ===== 圖案 =====
  P('rainbow', '彩虹拱門', '圖案', [
    'abc.XX.cba',
    'abc.X.cba',
    '.abc..cba.',
    '..abccba.',
    '...abba...',
    '....aa...'
  ]);
  P('stripes', '彩色橫條', '圖案', [
    'aaaaaaaaaa',
    'bbbbbbbbb',
    'cccccccccc',
    'aaaaaaaaa',
    'bbbbbbbbbb',
    'ccccccccc'
  ]);
  P('checker', '彩色格子', '圖案', [
    'aabbccaabb',
    'aabbccaab',
    'bbccaabbcc',
    'bbccaabbc',
    'ccaabbccaa',
    'ccaabbcca'
  ]);
  P('zigzag', '鋸齒波浪', '圖案', grid(10, 7, function (r, c, x) {
    var tri = [0, 1, 2, 1][r % 4]; // 0 1 2 1 來回折返
    var k = Math.floor((x + tri * 1.5) / 1.5);
    return 'abc'.charAt(((k % 3) + 3) % 3);
  }));
  P('pyramid', '金字塔', '圖案', [
    '....aa....',
    '...aaa...',
    '...bbbb...',
    '..bbbbb..',
    '..cccccc..',
    '.ccccccc.',
    '.aaaaaaaa.',
    'XaaaaaaaX'
  ]);
  P('hourglass', '沙漏', '圖案', [
    'XbbbbbbbbX',
    '.baaaaab.',
    '..baaaab..',
    '...bab...',
    '....aa....',
    '...bab...',
    '..baaaab..',
    '.baaaaab.',
    'XbbbbbbbbX'
  ]);
  P('donut', '甜甜圈', '圖案', [
    '..bbbbbb..',
    '.bbcbbCb.',
    'bbc....cbb',
    'bcb...bcb',
    'aaa....aaa',
    '.aaabaaa.',
    '..aaaaaa..'
  ]);
  P('cross', '十字', '圖案', [
    '...aaaa...',
    '...abba..',
    'aaaaaaaaaa',
    'aaaabaaaa',
    '...aaaa...',
    '...aaaa..',
    '...aaaa...'
  ]);
  P('target', '彩色靶心', '圖案', grid(10, 7, function (r, c, x) {
    var dx = x - 4.5, dy = r * 0.866;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 5.6) return '.';
    return 'abc'.charAt(Math.floor(d / 1.4) % 3);
  }));

  // ---------- 程序生成家族 ----------
  function ri(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); } // 含頭尾的整數

  function pickSlots(rng, k) {
    var s = ['a', 'b', 'c'], i, j, t;
    for (i = 2; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = s[i]; s[i] = s[j]; s[j] = t; }
    return s.slice(0, k);
  }

  function pmod(n, m) { return ((n % m) + m) % m; }

  // 收尾：補救連通 → 保底數量 → 撒上特殊標記
  function finish(rows, cols, rng, slots) {
    var out = prune(rows, cols);
    out = ensureMin(out, cols, 25, slots[0]);
    out = prune(out, cols);
    if (rng() < 0.5) {
      var cnt = ri(rng, 1, 3), t;
      for (t = 0; t < cnt; t++) {
        var r = ri(rng, 0, out.length - 1), c = ri(rng, 0, out[r].length - 1);
        var ch = out[r].charAt(c);
        var kind = rng();
        if (ch === '.' || ch === 'X') continue;
        var rep = kind < 0.4 ? '+' : (kind < 0.7 ? '*' : (/[a-f]/.test(ch) ? ch.toUpperCase() : '*'));
        out[r] = setChar(out[r], c, rep);
      }
    }
    return out;
  }

  var FAMILIES = [
    {
      id: 'gen-stripes', name: '彩色條紋',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 10), th = ri(rng, 1, 2), k = ri(rng, 2, 3), o = ri(rng, 0, 2);
        var sl = pickSlots(rng, k);
        var rows = grid(cols, n, function (r, c, x) {
          var v = o === 0 ? Math.floor(r / th) : (o === 1 ? Math.floor(x / (th + 1)) : Math.floor((x + r) / (th + 1)));
          return sl[pmod(v, k)];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-rings', name: '同心彩環',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), k = ri(rng, 2, 3), th = [1, 1.5, 2][ri(rng, 0, 2)];
        var sl = pickSlots(rng, k);
        var cx = (cols - 1) / 2, R = n * 0.866 - 0.2 + rng() * 0.8;
        var rows = grid(cols, n, function (r, c, x) {
          var d = Math.sqrt((x - cx) * (x - cx) + (r * 0.866) * (r * 0.866));
          return d > R ? '.' : sl[Math.floor(d / th) % k];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-checker', name: '彩色棋盤',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), sz = ri(rng, 1, 2), k = ri(rng, 2, 3);
        var sl = pickSlots(rng, k);
        var rows = grid(cols, n, function (r, c, x) {
          return sl[pmod(Math.floor(r / sz) + Math.floor(x / sz), k)];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-spiral', name: '彩虹旋渦',
      gen: function (rng, cols) {
        var n = ri(rng, 7, 10), arms = ri(rng, 2, 3), k = ri(rng, 2, 3), th = 1.5 + rng();
        var sl = pickSlots(rng, k);
        var cx = (cols - 1) / 2, cy = (n - 1) * 0.43;
        var rows = grid(cols, n, function (r, c, x) {
          var dx = x - cx, dy = (r - cy) * 0.866;
          var v = Math.atan2(dy, dx) / (2 * Math.PI) * arms + Math.sqrt(dx * dx + dy * dy) / th;
          return sl[pmod(Math.floor(v * 2), k)];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-wave', name: '波浪鋸齒',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), amp = ri(rng, 1, 2), th = ri(rng, 1, 2), k = ri(rng, 2, 3);
        var zig = ri(rng, 0, 1), freq = 0.5 + rng() * 0.6, ph = rng() * 6;
        var sl = pickSlots(rng, k);
        var rows = grid(cols, n, function (r, c, x) {
          var w;
          if (zig) { var t = pmod(x * freq * 2 + ph, 4); w = t < 2 ? t - 1 : 3 - t; } // 三角波
          else w = Math.sin(x * freq + ph);
          return sl[pmod(Math.floor((r + amp * w) / th), k)];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-diamond', name: '菱形花紋',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), th = ri(rng, 1, 2), k = ri(rng, 2, 3);
        var sl = pickSlots(rng, k);
        var cx = (cols - 1) / 2, cy = ri(rng, 1, n - 2);
        var rows = grid(cols, n, function (r, c, x) {
          return sl[Math.floor((Math.abs(x - cx) + Math.abs(r - cy)) / th) % k];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-mirror', name: '對稱團塊',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), k = ri(rng, 2, 3);
        var sl = pickSlots(rng, k);
        var rows = [], prev = null, r, c;
        for (r = 0; r < n; r++) {
          var tl = rowLen(r, cols), half = Math.ceil(tl / 2), cur = [];
          var p = Math.max(0.4, 0.97 - r * 0.07);
          for (c = 0; c < half; c++) {
            // 參考上方相鄰格（盡量沿用顏色，形成團塊）
            var up = null;
            if (prev) {
              var uc = (r % 2 === 0) ? [c - 1, c] : [c, c + 1];
              var u = uc[ri(rng, 0, 1)];
              if (u >= 0 && u < prev.length && prev[u] !== '.') up = prev[u];
            }
            var has = r === 0 ? rng() < 0.9 : (rng() < p || (up && rng() < p + 0.25));
            if (!has) { cur.push('.'); continue; }
            cur.push(up && rng() < 0.6 ? up : sl[ri(rng, 0, k - 1)]);
          }
          var full = [];
          for (c = 0; c < tl; c++) full.push(c < half ? cur[c] : cur[tl - 1 - c]);
          rows.push(full.join(''));
          prev = full;
        }
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-triangle', name: '倒三角',
      gen: function (rng, cols) {
        var n = ri(rng, 7, 10), k = ri(rng, 2, 3), th = ri(rng, 1, 2), diag = ri(rng, 0, 1);
        var sl = pickSlots(rng, k);
        var cx = (cols - 1) / 2;
        var step = (cols / 2 - 0.4) / (n - 1) * (0.9 + rng() * 0.3);
        var rows = grid(cols, n, function (r, c, x) {
          if (Math.abs(x - cx) > cols / 2 - 0.5 - r * step) return '.';
          var v = diag ? Math.floor((x + r) / (th + 1)) : Math.floor(r / th);
          return sl[pmod(v, k)];
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-bars', name: '長短直條',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 10), k = ri(rng, 2, 3), c;
        var sl = pickSlots(rng, k);
        var H = [];
        for (c = 0; c < cols; c++) H.push(ri(rng, 2, n));
        H[ri(rng, 0, cols - 1)] = n;
        var rows = grid(cols, n, function (r, cc, x) {
          var h = r % 2 === 0 ? H[cc] : Math.max(H[cc], H[cc + 1]);
          return r < h ? sl[Math.floor(x) % k] : '.';
        });
        return finish(rows, cols, rng, sl);
      }
    },
    {
      id: 'gen-chevron', name: '山形條紋',
      gen: function (rng, cols) {
        var n = ri(rng, 6, 9), k = ri(rng, 2, 3), th = ri(rng, 1, 2), up = ri(rng, 0, 1);
        var sl = pickSlots(rng, k);
        var cx = (cols - 1) / 2;
        var rows = grid(cols, n, function (r, c, x) {
          var d = Math.abs(x - cx) + (up ? (n - 1 - r) : r);
          return sl[Math.floor(d / th) % k];
        });
        return finish(rows, cols, rng, sl);
      }
    }
  ];

  // ---------- 對外介面 ----------
  function list() {
    var out = [], i;
    for (i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      out.push({ id: p.id, name: p.name, group: p.group, obstacle: p.obstacle, special: p.special, kind: 'pattern' });
    }
    for (i = 0; i < FAMILIES.length; i++) {
      var f = FAMILIES[i];
      out.push({ id: f.id, name: f.name, group: '程序生成', obstacle: false, special: true, kind: 'family' });
    }
    return out;
  }

  function findPattern(id) {
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].id === id) return PATTERNS[i];
    return null;
  }
  function findFamily(id) {
    for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i].id === id) return FAMILIES[i];
    return null;
  }

  // 沒傳 rng 時使用固定種子的簡單亂數（不使用 Math.random，保持可重現）
  function fallbackRng() {
    var a = 20240601;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resolve(idOrRandom, opt) {
    opt = opt || {};
    var cols = opt.cols || 10;
    var rng = opt.rng || fallbackRng();
    var noObs = !!opt.noObstacles;
    var pat = null, fam = null;

    if (idOrRandom && idOrRandom !== 'random') {
      pat = findPattern(idOrRandom);
      if (!pat) fam = findFamily(idOrRandom);
    }
    if (!pat && !fam) {
      var pool = [], i;
      for (i = 0; i < PATTERNS.length; i++) if (!noObs || !PATTERNS[i].obstacle) pool.push(PATTERNS[i]);
      var roll = rng();
      var pick = rng();
      if (roll < 0.7 && pool.length) pat = pool[Math.floor(pick * pool.length)];
      else fam = FAMILIES[Math.floor(pick * FAMILIES.length)];
    }

    var rows, id, name;
    if (pat) { rows = resample(pat.rows, cols); id = pat.id; name = pat.name; }
    else { rows = fam.gen(rng, cols); id = fam.id; name = fam.name; }

    if (noObs) rows = rows.map(function (s) { return s.replace(/X/g, '#'); });
    if (!validate(rows, cols).ok) rows = prune(rows, cols); // 理論上不會發生，保底
    return { id: id, name: name, cols: cols, rows: rows };
  }

  var api = {
    PATTERNS: PATTERNS,
    FAMILIES: FAMILIES,
    list: list,
    resolve: resolve,
    resample: resample,
    validate: validate
  };

  root.Layouts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
