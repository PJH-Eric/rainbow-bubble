/* ===== tests/i18n.js — 字典完整性測試（不需要瀏覽器） =====
 * 1. zh-Hant 與 en 的 key 集合完全一致，沒有空字串；en 不可夾中文
 * 2. 兩邊同一個 key 的 {param} 完全一致
 * 3. 原始碼（public/js、index.html、lib）用到的 key 都存在字典裡（含動態組出來的 key 家族）
 * 4. 伺服器送出的代碼（sys.*、err.*、note.*）在字典裡都有翻譯
 * 執行：node tests/i18n.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
}

/* ---- 讀字典：用假的 I18N.register 把兩份字典抓出來 ---- */
const dicts = {};
const sandbox = { I18N: { register(lang, d) { dicts[lang] = d; return this; } } };
sandbox.window = sandbox;
vm.runInNewContext(read('public/js/locales.js'), sandbox, { filename: 'locales.js' });
const zh = dicts['zh-Hant'], en = dicts.en;
ok(zh && en, '兩份字典都有註冊');
const zk = Object.keys(zh), ek = Object.keys(en);

/* 1. key 集合 */
ok(zk.length === ek.length, 'key 數量一致', zk.length + ' vs ' + ek.length);
zk.filter(k => !(k in en)).forEach(k => ok(false, 'en 缺 key：' + k));
ek.filter(k => !(k in zh)).forEach(k => ok(false, 'zh-Hant 缺 key：' + k));
const CJK = /[㐀-鿿]/;
const params = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
zk.forEach(k => {
  if (!(k in en)) return;
  ok(typeof zh[k] === 'string' && zh[k].trim() !== '', 'zh-Hant 不可為空：' + k);
  ok(typeof en[k] === 'string' && en[k].trim() !== '', 'en 不可為空：' + k);
  ok(!CJK.test(en[k]), 'en 不可夾中文：' + k, en[k]);
  ok(params(zh[k]) === params(en[k]), '{param} 不一致：' + k, params(zh[k]) + ' vs ' + params(en[k]));
});
const has = k => k in zh && k in en;

/* 3. 原始碼用到的 key */
const files = fs.readdirSync(path.join(ROOT, 'public/js')).filter(f => /\.js$/.test(f) && f !== 'locales.js' && f !== 'i18n.js').map(f => 'public/js/' + f);
files.push('public/index.html');
const used = new Set(), prefixes = new Set();
const CALL = /(?:\bT|\btr|I18N\.t|\bt)\(\s*'([\w.\-]+)'(\s*\+)?/g;
files.forEach(f => {
  const src = read(f);
  let m;
  while ((m = CALL.exec(src))) { (m[2] ? prefixes : used).add(m[1]); }
  const attrRe = /data-i18n(?:-html|-title|-content)?="([\w.\-]+)"/g;
  while ((m = attrRe.exec(src))) used.add(m[1]);
  const aRe = /data-i18n-attr="([^"]+)"/g;
  while ((m = aRe.exec(src))) m[1].split(';').forEach(p => { const kv = p.split('='); if (kv[1]) used.add(kv[1].trim()); });
});
used.forEach(k => ok(has(k), '原始碼用到但字典沒有：' + k));
prefixes.forEach(p => ok(zk.some(k => k.indexOf(p) === 0), '動態 key 前綴在字典裡找不到：' + p));

/* 動態 key 家族逐一驗 */
['baby', 'easy', 'normal', 'hard'].forEach(l => ['level.', 'level.hint.', 'ai.hint.'].forEach(p => ok(has(p + l), '缺 ' + p + l)));
['race', 'duel'].forEach(m => ok(has('mode.' + m), '缺 mode.' + m));
const dragons = (read('public/js/art-dragons.js').match(/\{ id: '(\w+)',\s+name: '/g) || []).map(s => s.match(/'(\w+)'/)[1]);
ok(dragons.length === 8, '讀到 8 隻龍', String(dragons.length));
dragons.forEach(d => ['dragon.', 'dragon.short.'].forEach(p => ok(has(p + d), '缺 ' + p + d)));
const themes = (read('public/js/art-world.js').match(/\{ id: \d+, name: '[^']+', sky:/g) || []).length;
ok(themes === 7, '讀到 7 個主題', String(themes));
for (let i = 0; i < themes; i++) ok(has('theme.' + i), '缺 theme.' + i);
for (let i = 0; i < 10; i++) ok(has('adj.' + i), '缺 adj.' + i);
['rainbow', 'star', 'starmark', 'laser', 'coin', 'cloud'].forEach(n => ['.n', '.d'].forEach(s => ok(has('help.sp.' + n + s), '缺 help.sp.' + n + s)));
['q1', 'q2', 'q3', 'q4'].forEach(q => ok(has('chat.' + q), '缺 chat.' + q));
['animal', 'shape', 'thing', 'pattern', 'gen'].forEach(g => ok(has('layout.group.' + g), '缺 layout.group.' + g));
const Layouts = require(path.join(ROOT, 'public/js/layouts.js'));
const L = Layouts.Layouts || Layouts;
L.list().forEach(x => ok(has('layout.' + x.id), '缺地圖名稱 layout.' + x.id));
['abs', 'mixed'].forEach(c => ok(has('cfg.err.' + c), '缺 cfg.err.' + c));
['room', 'countdown', 'playing'].forEach(p => ok(has('phase.' + p), '缺 phase.' + p));
['invalid', 'revoked', 'expired', 'closed'].forEach(r => ok(has('inv.' + r), '缺 inv.' + r));

/* 4. 伺服器代碼 */
const srv = read('lib/rooms.js');
let m;
const sysRe = /'(sys\.\w+)'/g;
let nSys = 0;
while ((m = sysRe.exec(srv))) { nSys++; ok(has(m[1]), '伺服器用到的 ' + m[1] + ' 字典沒有'); }
ok(nSys >= 10, '伺服器有附 sys 代碼', String(nSys));
const errRe = /err\([^,]+,\s*'(\w+)'/g;
while ((m = errRe.exec(srv))) ok(has('err.' + m[1]), '伺服器錯誤碼 ' + m[1] + ' 字典沒有');
const startErr = /return \['(\w+)',/g;
while ((m = startErr.exec(srv))) ok(has('err.' + m[1]), '開局錯誤碼 ' + m[1] + ' 字典沒有');
const nkRe = /nk: '(\w+)'/g;
while ((m = nkRe.exec(srv))) ok(has('note.' + m[1]), '提示代碼 ' + m[1] + ' 字典沒有');
ok(used.size > 150, '原始碼掃到的 key 數量合理', String(used.size));
ok(has('note.inGame') && has('note.full') && has('note.noRoom'), '加入提示三種代碼齊全');
ok(has('closed.empty') && has('kicked.you'), '房間關閉／被請出的翻譯齊全');

console.log((fail ? 'FAIL ' : 'OK ') + 'i18n：通過 ' + pass + ' 項，失敗 ' + fail + ' 項（字典 ' + zk.length + ' 個 key）');
process.exit(fail ? 1 : 0);
