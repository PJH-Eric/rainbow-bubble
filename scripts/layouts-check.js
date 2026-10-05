/* 地圖模組檢查腳本：node scripts/layouts-check.js [--show] [--show8]
 * --show  印出每張手設圖的 ASCII 預覽（欄數 10）
 * --show8 同上，欄數 8
 * 失敗時 process.exit(1)。
 */
'use strict';
var path = require('path');
var Layouts = require(path.join(__dirname, '..', 'public', 'js', 'layouts.js'));

var fails = [];
function fail(msg) { fails.push(msg); }

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cells(rows) { return rows.join('').replace(/\./g, '').length; }
function preview(rows) {
  return rows.map(function (s, i) { return (i % 2 ? ' ' : '') + s.split('').join(' ').replace(/\./g, '·'); }).join('\n');
}

var P = Layouts.PATTERNS, F = Layouts.FAMILIES;
var args = process.argv.slice(2);

if (P.length < 40) fail('PATTERNS 只有 ' + P.length + ' 張，需 >= 40');
if (F.length < 8) fail('FAMILIES 只有 ' + F.length + ' 種，需 >= 8');

if (args.indexOf('--show') >= 0 || args.indexOf('--show8') >= 0) {
  var showCols = args.indexOf('--show8') >= 0 ? 8 : 10;
  P.forEach(function (p) {
    var rows = showCols === 10 ? p.rows : Layouts.resample(p.rows, showCols);
    console.log('--- ' + p.id + ' ' + p.name + ' [' + p.group + '] 格數 ' + cells(rows));
    console.log(preview(rows));
  });
}

// 手設圖逐張檢查
var ids = {}, groups = {}, xCount = 0, spCount = 0;
P.forEach(function (p) {
  if (ids[p.id]) fail('id 重複：' + p.id);
  ids[p.id] = true;
  groups[p.group] = (groups[p.group] || 0) + 1;
  var v = Layouts.validate(p.rows, 10);
  if (!v.ok) fail(p.id + ' 原樣驗證失敗：' + v.problems.join('；'));
  var n = cells(p.rows);
  if (n < 25 || n > 70) fail(p.id + ' 非空格數 ' + n + ' 不在 25～70');
  if (p.rows.length < 5 || p.rows.length > 10) fail(p.id + ' 列數 ' + p.rows.length + ' 不在 5～10');
  var slots = {};
  p.rows.join('').toLowerCase().split('').forEach(function (ch) { if (/[a-f]/.test(ch)) slots[ch] = 1; });
  if (Object.keys(slots).length > 4) fail(p.id + ' 用了超過 4 個顏色槽');
  var hasX = p.rows.join('').indexOf('X') >= 0;
  var hasSp = /[A-F*+]/.test(p.rows.join(''));
  if (hasX !== p.obstacle) fail(p.id + ' obstacle 旗標與內容不符');
  if (hasSp !== p.special) fail(p.id + ' special 旗標與內容不符');
  if (hasX) xCount++;
  if (hasSp) spCount++;
});
Layouts.list().forEach(function (e) { if (!e.id || !e.name) fail('list 項目缺欄位'); });

// 各欄數壓力測試
var minCells = { pattern: 999, family: 999 };
[8, 10, 11, 12, 14, 16].forEach(function (cols) {
  P.forEach(function (p) {
    for (var s = 1; s <= 200; s++) {
      var res = Layouts.resolve(p.id, { cols: cols, rng: mulberry32(s * 7919 + cols) });
      var v = Layouts.validate(res.rows, res.cols);
      if (!v.ok) { fail('resolve(' + p.id + ', ' + cols + ') 失敗：' + v.problems.join('；')); break; }
      if (s === 1) minCells.pattern = Math.min(minCells.pattern, cells(res.rows));
      var vn = Layouts.resolve(p.id, { cols: cols, rng: mulberry32(s), noObstacles: true });
      if (vn.rows.join('').indexOf('X') >= 0) { fail(p.id + ' noObstacles 仍含 X'); break; }
      if (!Layouts.validate(vn.rows, cols).ok) { fail(p.id + ' noObstacles 後驗證失敗'); break; }
    }
  });
  F.forEach(function (f) {
    for (var s = 1; s <= 200; s++) {
      var res = Layouts.resolve(f.id, { cols: cols, rng: mulberry32(s * 104729 + cols) });
      var v = Layouts.validate(res.rows, res.cols);
      if (!v.ok) { fail('family ' + f.id + ' cols=' + cols + ' seed=' + s + ' 失敗：' + v.problems.join('；')); break; }
      var n = cells(res.rows);
      minCells.family = Math.min(minCells.family, n);
      if (n < 25) { fail('family ' + f.id + ' 格數 ' + n + ' < 25'); break; }
      if (res.rows.length > 12) { fail('family ' + f.id + ' 列數過多'); break; }
    }
  });
  // 隨機挑圖
  var pickKinds = { pattern: 0, family: 0 };
  for (var s = 1; s <= 600; s++) {
    var noObs = s % 2 === 0;
    var res = Layouts.resolve('random', { cols: cols, rng: mulberry32(s * 31 + cols), noObstacles: noObs });
    var v = Layouts.validate(res.rows, res.cols);
    if (!v.ok) { fail('random cols=' + cols + ' seed=' + s + ' 失敗：' + v.problems.join('；')); break; }
    if (noObs && res.rows.join('').indexOf('X') >= 0) { fail('random noObstacles 含 X'); break; }
    if (noObs) {
      var pp = P.filter(function (q) { return q.id === res.id; })[0];
      if (pp && pp.obstacle) { fail('random noObstacles 挑中 obstacle 地圖 ' + pp.id); break; }
    }
    pickKinds[res.id.indexOf('gen-') === 0 ? 'family' : 'pattern']++;
  }
  var ratio = pickKinds.pattern / (pickKinds.pattern + pickKinds.family);
  if (ratio < 0.62 || ratio > 0.78) fail('cols=' + cols + ' 手設比例 ' + ratio.toFixed(2) + ' 偏離 70%');
  console.log('cols=' + cols + ' 隨機挑圖 600 次：手設 ' + pickKinds.pattern + '、程序 ' + pickKinds.family + '（' + (ratio * 100).toFixed(1) + '% 手設）');
});

// 決定性：同 seed 結果相同
[8, 10, 12].forEach(function (cols) {
  for (var s = 1; s <= 100; s++) {
    var a = JSON.stringify(Layouts.resolve('random', { cols: cols, rng: mulberry32(s) }));
    var b = JSON.stringify(Layouts.resolve('random', { cols: cols, rng: mulberry32(s) }));
    if (a !== b) { fail('同 seed 結果不同 cols=' + cols + ' seed=' + s); break; }
  }
  F.forEach(function (f) {
    var a = JSON.stringify(Layouts.resolve(f.id, { cols: cols, rng: mulberry32(5) }));
    var b = JSON.stringify(Layouts.resolve(f.id, { cols: cols, rng: mulberry32(5) }));
    if (a !== b) fail('family ' + f.id + ' 同 seed 結果不同');
  });
});

// validate 本身要能抓錯
if (Layouts.validate(['aaaaaaaaaa', 'a........', '..........', '.........', 'a.........'], 10).ok) fail('validate 沒抓到孤立格');
if (Layouts.validate(['aaaa', 'aaa'], 10).ok) fail('validate 沒抓到列長錯誤');
if (Layouts.validate(['aaaaaaaaaa', 'aaaaaaaaz'], 10).ok) fail('validate 沒抓到非法字元');

// 統計
console.log('PATTERNS ' + P.length + ' 張，FAMILIES ' + F.length + ' 種');
console.log('含 X 的比例：' + xCount + '/' + P.length + ' = ' + (xCount / P.length * 100).toFixed(1) + '%');
console.log('含特殊標記的比例：' + spCount + '/' + P.length + ' = ' + (spCount / P.length * 100).toFixed(1) + '%');
console.log('各 group 數量：' + Object.keys(groups).map(function (g) { return g + ' ' + groups[g]; }).join('、'));
console.log('重採樣／生成後最少非空格數：手設 ' + minCells.pattern + '、家族 ' + minCells.family);

if (fails.length) {
  console.log('\n失敗 ' + fails.length + ' 項：');
  fails.slice(0, 60).forEach(function (m) { console.log(' - ' + m); });
  process.exit(1);
}
console.log('\n全部通過');
