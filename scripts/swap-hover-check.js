/* ===== scripts/swap-hover-check.js — 滑鼠移到「交換泡泡」按鈕上的樣式（Playwright） =====
 * 用法：node scripts/swap-hover-check.js    檢查：移上去 hoverSwap 變 true、游標變手指、畫面真的不一樣；移開恢復；觸控不會誤觸 hover。 */
'use strict';
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const { chromium } = require(fs.existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fail = 0;
const ok = (c, n, x) => { console.log((c ? '  ok  ' : '  FAIL ') + n + (c || !x ? '' : '  ' + x)); if (!c) fail++; };
(async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3197' }), stdio: 'ignore' });
  const base = 'http://127.0.0.1:3197';
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) { /* 等 */ } await new Promise(r => setTimeout(r, 150)); }
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript('window.__GO_IN = ' + (Number(process.env.GAME_GO_IN) || 3000));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(base + '/'); await pg.waitForSelector('.home-menu');
  await pg.click('text=一個人玩'); await pg.waitForSelector('.sticky-cta');
  await pg.evaluate(() => { App.store.solo.opponents = 0; App.store.solo.mode = 'race'; App.store.solo.level = 'normal'; App.go('solo'); });
  await pg.click('text=開始遊戲'); await pg.waitForSelector('.bslot.mine canvas');
  await pg.waitForFunction(() => App.game && App.game.mt() > 300);
  const bb = await (await pg.$('.bslot.mine canvas')).boundingBox();
  const get = () => pg.evaluate(() => { const g = App.game, v = g.views[g.slot]; return { h: v.hoverSwap, c: v.canvas.style.cursor }; });
  await pg.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.3);
  ok(!(await get()).h, '一般位置沒有 hover');
  const snap = () => pg.screenshot({ clip: { x: bb.x, y: bb.y + bb.height * 0.8, width: bb.width, height: bb.height * 0.2 } });
  const before = await snap();
  fs.writeFileSync(path.join(SHOTS, 'swap-normal.png'), before);
  let hit = null;
  for (let y = 0.97; y >= 0.8 && !hit; y -= 0.02) for (let x = 0.5; x <= 0.95 && !hit; x += 0.02) {
    await pg.mouse.move(bb.x + bb.width * x, bb.y + bb.height * y);
    if ((await get()).h) hit = { x, y };
  }
  ok(!!hit, '滑鼠移到交換按鈕上會進入 hover', JSON.stringify(hit));
  if (hit) {
    ok((await get()).c === 'pointer', '游標變成手指');
    await pg.waitForTimeout(200);
    const after = await snap();
    fs.writeFileSync(path.join(SHOTS, 'swap-hover.png'), after);
    ok(!before.equals(after), 'hover 時畫面和平常不一樣（粉紫色風格）');
    await pg.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.3);
    ok(!(await get()).h && (await get()).c === '', '移開後恢復');
    await pg.mouse.move(bb.x + bb.width * hit.x, bb.y + bb.height * hit.y);
    await pg.mouse.move(bb.x - 20, bb.y - 20);
    ok(!(await get()).h, '滑鼠離開棋盤後也會恢復');
  }
  ok(errs.length === 0, '沒有 JS 錯誤', errs.join('|'));
  await br.close(); child.kill();
  console.log(fail ? '\n有失敗' : '\n全部通過'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
