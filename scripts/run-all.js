/* ===== scripts/run-all.js — 全部測試，分兩條線同時跑（預設快速模式，目標 3 分鐘內） =====
 * 用法：node scripts/run-all.js            快速模式（倒數縮成 0.4 秒、抽樣減量、瀏覽器只測 3 種尺寸）
 *       node scripts/run-all.js --full      完整模式（抽樣全開、5 種尺寸、倒數照原本）
 * A 線：規則 → 房間 → 伺服器 → 線上 → 網路同步（純 Node，不開瀏覽器）
 * B 線：單機瀏覽器版面 → 交換按鈕 hover → 線上瀏覽器（Playwright）
 * 兩條線各用不同埠，每條線依序跑，輸出各自存檔，最後一起列出，有任何失敗就以 1 結束。 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const env = Object.assign({}, process.env);
if (process.argv.includes('--full')) env.FULL = '1';
/* 只有瀏覽器那條線縮短倒數（A 線的測試本來就假設 3 秒倒數） */
const envB = Object.assign({}, env);
if (!env.FULL && !env.GAME_GO_IN) { envB.GAME_GO_IN = '400'; envB.GAME_DURATION_SCALE = '0.2'; }
const LANES = {
  A: ['tests/verify.js', 'tests/rooms.js', 'tests/server.js', 'scripts/online-check.js', 'scripts/netcode-check.js'],
  B: ['scripts/browser-check.js', 'scripts/swap-hover-check.js', 'scripts/timer-row-check.js', 'scripts/online-browser-check.js']
};
const t0 = Date.now();
const run = (file, e) => new Promise(res => {
  const t = Date.now(); let out = '';
  const p = spawn(process.execPath, [file], { cwd: ROOT, env: e });
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('close', code => res({ file, code, sec: (Date.now() - t) / 1000, out }));
});
(async () => {
  const lane = async (files, e) => { const r = []; for (const f of files) r.push(await run(f, e)); return r; };
  const [a, b] = await Promise.all([lane(LANES.A, env), lane(LANES.B, envB)]);
  let bad = 0;
  for (const r of a.concat(b)) {
    const last = r.out.split('\n').filter(l => /通過|FAIL|失敗|✗/.test(l)).slice(-3).join(' | ');
    console.log((r.code ? 'FAIL ' : 'ok   ') + r.file.padEnd(30) + r.sec.toFixed(0).padStart(4) + 's  ' + last);
    if (r.code) { bad++; console.log(r.out.split('\n').filter(l => /FAIL|✗|Error|失敗/.test(l)).slice(0, 8).join('\n')); }
  }
  console.log('\n總耗時 ' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒（A 線 ' + a.reduce((s, r) => s + r.sec, 0).toFixed(0) + 's、B 線 ' + b.reduce((s, r) => s + r.sec, 0).toFixed(0) + 's）' + (bad ? '，' + bad + ' 項失敗' : '，全部通過'));
  process.exit(bad ? 1 : 0);
})();
