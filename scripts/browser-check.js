/* ===== scripts/browser-check.js — 單機流程與版面檢查（Playwright） =====
 * 用法：node scripts/browser-check.js
 * 檢查：多種裝置尺寸的單人盤面（無水平溢出、盤面夠大、沒有 AI／對手 UI 或 JS 錯誤）、
 *       設定彈窗、暫停選單、結算 overlay 三個按鈕，截圖放在 shots/。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require(fs.existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');

const ROOT = path.join(__dirname, '..');
const GAME_URL = pathToFileURL(path.join(ROOT, 'public', 'index.html')).href;
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); } };

const GO = Number(process.env.GAME_GO_IN) || 3000;   /* 倒數毫秒；快速測試用環境變數縮短 */
const FULL = !!process.env.FULL;
const ALL_VIEWS = [
  { name: 'desktop', w: 1366, h: 768 },
  { name: 'tablet-land', w: 1180, h: 820 },
  { name: 'tablet-port', w: 820, h: 1180 },
  { name: 'phone-port', w: 390, h: 844 },
  { name: 'phone-land', w: 844, h: 390 }
];
/* 快速模式（預設）：桌機、平板直向、手機直向三個尺寸；FULL=1 才跑全部 5 種 */
const ONLY = (process.env.VIEWS || '').split(',').filter(Boolean);
const VIEWS = ONLY.length ? ALL_VIEWS.filter(v => ONLY.includes(v.name)) : FULL ? ALL_VIEWS : ALL_VIEWS.filter(v => ['desktop', 'tablet-port', 'phone-port'].includes(v.name));

(async () => {
  const br = await chromium.launch();
  const errs = [];
  const mk = async (v) => {
    const ctx = await br.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.name.startsWith('phone') || v.name.startsWith('tablet') });
    await ctx.addInitScript('window.__GO_IN = ' + GO);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(v.name + ' PAGEERR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(v.name + ' CONSOLE ' + m.text()); });
    return { ctx, pg };
  };
  const overflow = pg => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);

  /* 各裝置尺寸各開一個 context 並行跑；輸出先收集，跑完依尺寸順序一次印出 */
  const reports = await Promise.all(VIEWS.map(async v => {
    const lines = ['\n[' + v.name + ' ' + v.w + '×' + v.h + ']'];
    const ok = (c, name, extra) => { if (c) { pass++; lines.push('  ok  ' + name); } else { fail++; lines.push('  FAIL ' + name + (extra ? '  ' + extra : '')); } };
    const { ctx, pg } = await mk(v);
    await pg.goto(GAME_URL);
    await pg.waitForSelector('.home-menu');
    ok(!(await overflow(pg)), '首頁沒有水平溢出');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-home.png') });
    /* 單機設定頁 */
    await pg.click('text=一個人玩');
    await pg.waitForSelector('.sticky-cta');
    ok(!(await overflow(pg)), '單機設定沒有水平溢出');
    /* 載入舊設定，確認移除的對手選項會在遷移時清掉 */
    await pg.evaluate(() => {
      localStorage.setItem('rainbow-bubble', JSON.stringify(Object.assign({}, App.store, {
        solo: Object.assign({}, App.store.solo, { mode: 'duel', opponents: 3, aiLevels: ['easy', 'normal', 'hard'] })
      })));
      App.store = Store.load();
      App.go('solo');
    });
    await pg.waitForSelector('.sticky-cta');
    ok(await pg.evaluate(() => !('opponents' in App.store.solo) && !('aiLevels' in App.store.solo) && !('mode' in App.store.solo)), '舊存檔中的電腦對手設定已移除');
    for (const lang of ['zh-Hant', 'zh-Hans', 'en']) {
      await pg.evaluate(lang => I18N.setLang(lang), lang);
      const text = await pg.locator('[data-screen="solo"]').innerText();
      ok(!/電腦|對手|computer opponent|\bbots?\b|\bopponents?\b/i.test(text), lang + ' 單機設定沒有對手文案');
    }
    await pg.evaluate(() => { I18N.setLang('zh-Hant'); App.store.solo.level = 'normal'; App.store.solo.duration = 120000; App.go('solo'); });
    await pg.click('text=開始遊戲');
    await pg.waitForSelector('.bslot canvas', { timeout: 8000 }).catch(async error => {
      console.error('單機開局診斷', JSON.stringify(await pg.evaluate(() => ({ screen: App.screen, game: !!App.game, text: document.querySelector('#app').innerText.slice(0, 600) }))));
      console.error('瀏覽器錯誤', errs.join(' | '));
      throw error;
    });
    await pg.waitForFunction(() => App.game && App.game.mt() > 300, null, { timeout: 8000 });
    const info = await pg.evaluate(() => ({
      boards: document.querySelectorAll('.bslot').length,
      players: App.game.m.players.length,
      logicalBoards: App.game.m.boards.length,
      hasOpponentUi: !!document.querySelector('.ai-row,.ai-faces,.opp-col,.rank-row')
    }));
    ok(info.boards === 1 && info.players === 1 && info.logicalBoards === 1, '單人對局只有一位玩家與一個盤面', JSON.stringify(info));
    ok(!info.hasOpponentUi, '遊戲中沒有 AI、對手欄或排名元件');
    const mine = await pg.$eval('.bslot.mine canvas', el => {
      const rect = node => { const r = node.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      const wrap = el.closest('.board-wrap');
      const slot = el.closest('.bslot'), wrapStyle = getComputedStyle(wrap), slotStyle = getComputedStyle(slot);
      const px = value => parseFloat(value) || 0;
      return {
        canvas: rect(el), bar: rect(wrap.querySelector('.board-bar')), wrap: Object.assign(rect(wrap), { clientHeight: wrap.clientHeight, inlineCanvasHeight: el.style.height, inset: wrapStyle.inset, ctop: wrapStyle.getPropertyValue('--ctop'), offsetParent: wrap.offsetParent && wrap.offsetParent.className }),
        available: { w: Math.round(slot.clientWidth - px(wrapStyle.left) - px(wrapStyle.right)), h: Math.round(slot.clientHeight - px(wrapStyle.top) - px(wrapStyle.bottom)) },
        slot: Object.assign(rect(slot), { className: slot.className, tbar: slotStyle.getPropertyValue('--tbar'), position: slotStyle.position }),
        boards: rect(el.closest('.boards')), main: rect(el.closest('.game-main'))
      };
    });
    const canvas = mine.canvas;
    const minMine = v.w < 500 ? 150 : 200;
    ok(canvas.w >= minMine && canvas.h >= 250, '單人盤面尺寸足夠 ' + canvas.w + '×' + canvas.h);
    const fill = Math.max(canvas.w / mine.available.w, canvas.h / mine.available.h);
    ok(fill >= 0.95 && fill <= 1.02, '盤面盡量填滿可用區域（' + Math.round(fill * 100) + '%）', JSON.stringify(mine));
    ok(mine.bar.bottom <= canvas.top + 2, '計時列位於盤面上緣', JSON.stringify(mine));
    ok(canvas.top >= 0 && canvas.bottom <= v.h + 1, '盤面完整顯示於視窗內', JSON.stringify(mine));
    ok(!(await overflow(pg)), '對局沒有水平溢出');
    const cv = await pg.$('.bslot.mine canvas');
    const bb = await cv.boundingBox();
    for (let i = 0; i < 4; i++) { await pg.mouse.click(bb.x + bb.width * (0.25 + 0.17 * i), bb.y + bb.height * 0.35); await pg.waitForTimeout(330); }
    await pg.waitForTimeout(700);
    const shots = await pg.evaluate(() => App.game.m.boards[0].shots);
    ok(shots >= 3, '點擊棋盤真的會發射（' + shots + ' 發）');
    const pixels = await pg.evaluate(() => {
      const v = App.game.views[0], canvas = v.canvas;
      const ctx = canvas.getContext('2d'), points = [[8, 8], [canvas.width >> 1, canvas.height >> 1], [canvas.width - 8, canvas.height - 8]];
      const before = points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
      return { size: [canvas.width, canvas.height], alpha: before, mounted: App.game.mounted, connected: App.game.root.isConnected, shown: !!v.shown };
    });
    ok(pixels.alpha.some(alpha => alpha > 0), '盤面 canvas 有繪製內容', JSON.stringify(pixels));
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-game-solo.png') });
    if (await pg.locator('.side-toggle').isVisible()) {
      await pg.click('.side-toggle');
      await pg.waitForTimeout(350);
      await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-game-side.png') });
      ok(!(await overflow(pg)), '開啟資訊欄後沒有水平溢出');
    }
    await pg.evaluate(() => App.go('home'));
    /* 設定彈窗與暫停 */
    await pg.evaluate(() => App.go('solo'));
    await pg.click('text=開始遊戲');
    await pg.waitForSelector('.bslot canvas');
    await pg.waitForTimeout(GO + 300);
    await pg.click('#gear');
    await pg.waitForSelector('.dialog');
    ok(await pg.evaluate(() => !!document.querySelector('.dialog .sw') && !!document.querySelector('.dialog .vol')), '設定彈窗含音樂／音效開關與音量滑桿');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-settings.png') });
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => !document.querySelector('.dialog')), 'Esc 可關閉設定彈窗');
    await pg.click('.board-bar .board-pause');
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
    ok(btns.join('|') === '再來一局|回到設定|回到首頁', '結算 overlay 三個按鈕：' + btns.join('、'));
    ok(await pg.evaluate(() => !!document.querySelector('.bslot canvas')), '結算 overlay 疊在棋盤上方（棋盤仍在）');
    ok(!(await overflow(pg)), '結算沒有水平溢出');
    await pg.screenshot({ path: path.join(SHOTS, 'rwd-' + v.name + '-result.png') });
    await pg.click('text=再來一局');
    await pg.waitForSelector('.bslot canvas');
    ok(await pg.evaluate(() => !document.querySelector('.result-card')), '再來一局：重新開始新局');
    await pg.evaluate(() => { App.game.cfg.duration = 1; App.game.m.duration = 1; });
    await pg.waitForSelector('.result-card', { timeout: 8000 });
    await pg.click('text=回到設定');
    await pg.waitForSelector('.sticky-cta');
  ok(true, '回到設定 → 單機設定頁');
    await pg.click('text=開始遊戲');
    await pg.waitForSelector('.bslot canvas');
    await pg.evaluate(() => { App.game.cfg.duration = 1; App.game.m.duration = 1; });
    await pg.waitForSelector('.result-card', { timeout: 8000 });
    await pg.click('text=回到首頁');
    await pg.waitForSelector('.home-menu');
    ok(true, '回到首頁');
    await ctx.close();
    return lines;
  }));
  reports.forEach(lines => lines.forEach(l => console.log(l)));
  await br.close();
  ok(errs.length === 0, '沒有 JS 錯誤 / console error', errs.slice(0, 5).join(' || '));
  console.log('\n' + (fail ? fail + ' 項失敗' : '全部通過') + '（通過 ' + pass + ' 項）');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
