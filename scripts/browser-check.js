/* ===== scripts/browser-check.js — 單機流程與版面檢查（Playwright） =====
 * 用法：node scripts/browser-check.js [網址，預設自己啟動本機伺服器 3198]
 * 檢查：多種裝置尺寸 × 1～4 人的對局版面（無水平溢出、盤面夠大、沒有 JS 錯誤）、
 *       設定彈窗、暫停選單、結算 overlay 三個按鈕，截圖放在 shots/。
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require(fs.existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); } };

const VIEWS = [
  { name: 'desktop', w: 1366, h: 768 },
  { name: 'tablet-land', w: 1180, h: 820 },
  { name: 'tablet-port', w: 820, h: 1180 },
  { name: 'phone-port', w: 390, h: 844 },
  { name: 'phone-land', w: 844, h: 390 }
];

async function waitHealth(base) {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) { /* 等待 */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('伺服器沒有起來');
}

(async () => {
  let base = process.argv[2], child = null;
  if (!base) {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3198' }), stdio: 'ignore' });
    base = 'http://127.0.0.1:3198';
  }
  await waitHealth(base);
  const br = await chromium.launch();
  const errs = [];
  const mk = async (v) => {
    const ctx = await br.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.name.startsWith('phone') || v.name.startsWith('tablet') });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(v.name + ' PAGEERR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(v.name + ' CONSOLE ' + m.text()); });
    return { ctx, pg };
  };
  const overflow = pg => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);

  for (const v of VIEWS) {
    console.log('\n[' + v.name + ' ' + v.w + '×' + v.h + ']');
    const { ctx, pg } = await mk(v);
    await pg.goto(base + '/');
    await pg.waitForSelector('.home-menu');
    ok(!(await overflow(pg)), '首頁沒有水平溢出');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-home.png') });
    /* 單機設定頁 */
    await pg.click('text=一個人玩');
    await pg.waitForSelector('.sticky-cta');
    ok(!(await overflow(pg)), '單機設定沒有水平溢出');
    /* 逐一測 1、2、4 人 */
    for (const opp of [0, 1, 3]) {
      await pg.evaluate(n => { App.store.solo.opponents = n; App.store.solo.mode = n ? 'duel' : 'race'; App.store.solo.level = 'normal'; App.store.solo.duration = 120000; App.go('solo'); }, opp);
      await pg.click('text=開始遊戲');
      await pg.waitForSelector('.bslot canvas');
      await pg.waitForFunction(() => App.game && App.game.mt() > 300, null, { timeout: 8000 });
      const info = await pg.evaluate(() => Array.from(document.querySelectorAll('.bslot')).map(el => { const r = el.querySelector('canvas').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), mine: el.classList.contains('mine') }; }));
      ok(info.length === opp + 1, '盤面數量 = ' + (opp + 1), JSON.stringify(info));
      const mine = info.find(x => x.mine);
      const minMine = v.w < 500 ? 150 : 200;
      ok(mine && mine.w >= minMine && mine.h >= 250, '自己的盤面夠大 ' + (mine ? mine.w + '×' + mine.h : ''), JSON.stringify(info));
      ok(info.every(x => x.w >= 55 && x.h >= 70), '所有盤面可辨識（最小 ' + Math.min.apply(null, info.map(x => x.w)) + 'px 寬）');
      ok(!(await overflow(pg)), '對局沒有水平溢出');
      /* 打幾發 */
      const cv = await pg.$('.bslot.mine canvas');
      const bb = await cv.boundingBox();
      for (let i = 0; i < 4; i++) { await pg.mouse.click(bb.x + bb.width * (0.25 + 0.17 * i), bb.y + bb.height * 0.35); await pg.waitForTimeout(330); }
      await pg.waitForTimeout(700);
      const shots = await pg.evaluate(() => App.game.m.boards[0].shots);
      ok(shots >= 3, '點擊棋盤真的會發射（' + shots + ' 發）');
      await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-game' + (opp + 1) + 'p.png') });
      if (opp === 3 || (opp === 1 && v.name === 'phone-port')) { /* 資訊欄開關 */
        if (await pg.locator('.side-toggle').isVisible()) await pg.click('.side-toggle');
        await pg.waitForTimeout(350);
        await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-game' + (opp + 1) + 'p-side.png') });
        ok(!(await overflow(pg)), '開啟資訊欄後沒有水平溢出');
      }
      await pg.evaluate(() => App.go('home'));
    }
    /* 設定彈窗與暫停 */
    await pg.evaluate(() => { App.store.solo.opponents = 1; App.go('solo'); });
    await pg.click('text=開始遊戲');
    await pg.waitForSelector('.bslot canvas');
    await pg.waitForTimeout(3300);
    await pg.click('#gear');
    await pg.waitForSelector('.dialog');
    ok(await pg.evaluate(() => !!document.querySelector('.dialog .sw') && !!document.querySelector('.dialog .vol')), '設定彈窗含音樂／音效開關與音量滑桿');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-settings.png') });
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => !document.querySelector('.dialog')), 'Esc 可關閉設定彈窗');
    await pg.click('.hud .icon-btn[aria-label="暫停"]');
    await pg.waitForSelector('.dialog');
    const t1 = await pg.evaluate(() => App.game.mt());
    await pg.waitForTimeout(800);
    const t2 = await pg.evaluate(() => App.game.mt());
    ok(Math.abs(t2 - t1) < 5, '暫停時對局時鐘停止');
    await pg.click('text=繼續玩');
    await pg.waitForTimeout(400);
    /* 結算 overlay：把時間縮短到 3 秒 */
    await pg.evaluate(() => { App.game.cfg.duration = 1; App.game.m.duration = 1; });
    await pg.waitForSelector('.result-card', { timeout: 6000 });
    await pg.waitForTimeout(600);
    const btns = await pg.evaluate(() => Array.from(document.querySelectorAll('.result-card .result-actions .btn')).map(b => b.textContent.trim()));
    ok(btns.join('|') === '再來一局|回到房間|回到首頁', '結算 overlay 三個按鈕：' + btns.join('、'));
    ok(await pg.evaluate(() => !!document.querySelector('.bslot canvas')), '結算 overlay 疊在棋盤上方（棋盤仍在）');
    ok(!(await overflow(pg)), '結算沒有水平溢出');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-result.png') });
    await pg.click('text=再來一局');
    await pg.waitForSelector('.bslot canvas');
    ok(await pg.evaluate(() => !document.querySelector('.result-card')), '再來一局：重新開始新局');
    await pg.evaluate(() => { App.game.cfg.duration = 1; App.game.m.duration = 1; });
    await pg.waitForSelector('.result-card', { timeout: 8000 });
    await pg.click('text=回到房間');
    await pg.waitForSelector('.sticky-cta');
    ok(true, '回到房間 → 單機設定頁');
    await pg.click('text=開始遊戲');
    await pg.waitForSelector('.bslot canvas');
    await pg.evaluate(() => { App.game.cfg.duration = 1; App.game.m.duration = 1; });
    await pg.waitForSelector('.result-card', { timeout: 8000 });
    await pg.click('text=回到首頁');
    await pg.waitForSelector('.home-menu');
    ok(true, '回到首頁');
    await ctx.close();
  }
  await br.close();
  if (child) child.kill();
  ok(errs.length === 0, '沒有 JS 錯誤 / console error', errs.slice(0, 5).join(' || '));
  console.log('\n' + (fail ? fail + ' 項失敗' : '全部通過') + '（通過 ' + pass + ' 項）');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
