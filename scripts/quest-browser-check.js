/* ===== scripts/quest-browser-check.js — 闖關模式瀏覽器實測（Playwright） =====
 * 用法：node scripts/quest-browser-check.js [網址，預設自己啟動本機伺服器 3197]
 * 流程（每種裝置尺寸各跑一次）：首頁闖關入口 → 四段難度 → 選關 → 目標卡 → 開局提示 → 真的打完一關 →
 *   結算（星等、存檔、下一關）→ 暫停選單 → 失敗結算 → 關主關 → 英文介面無中文殘留；全程檢查無水平溢出與 JS 錯誤。
 * 截圖放在 shots/quest-*.png（已被 .gitignore 排除）。 */
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
const FULL = !!process.env.FULL;
const ALL_VIEWS = [
  { name: 'desktop', w: 1366, h: 768 },
  { name: 'tablet-land', w: 1180, h: 820 },
  { name: 'tablet-port', w: 820, h: 1180 },
  { name: 'phone-port', w: 390, h: 844 },
  { name: 'phone-land', w: 844, h: 390 }
];
const ONLY = (process.env.VIEWS || '').split(',').filter(Boolean);
const VIEWS = ONLY.length ? ALL_VIEWS.filter(v => ONLY.includes(v.name)) : FULL ? ALL_VIEWS : ALL_VIEWS.filter(v => ['desktop', 'tablet-port', 'phone-port'].includes(v.name));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHealth(base) {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) { /* 等待 */ } await sleep(150); }
  throw new Error('伺服器沒有起來');
}

/** 用目標導向的電腦在瀏覽器裡把這一關打完（透過 GameScreen.fire，和玩家點擊走同一條路） */
async function playOut(pg, maxShots) {
  return pg.evaluate(async (max) => {
    const g = App.game;
    const brain = AI.createBrain('normal', 5);
    brain.p = Object.assign({}, brain.p, { step: 300 });
    let n = 0;
    while (!g.over && n < max) {
      while (!g.canAct() && !g.over) await new Promise(r => setTimeout(r, 60));
      if (g.over) break;
      const d = AI.decide(g.m.boards[0], brain, 'quest');
      if (d.swap) g.swap();
      g.fire(d.a);
      n++;
      await new Promise(r => setTimeout(r, 300));
    }
    return { over: g.over, shots: g.m.boards[0].shots, reason: g.m.result && g.m.result.reason };
  }, maxShots);
}

(async () => {
  let base = process.argv[2], child = null;
  if (!base) {
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3197' }), stdio: 'ignore' });
    base = 'http://127.0.0.1:3197';
  }
  await waitHealth(base);
  const br = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errs = [];
  const overflow = pg => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  const cjk = pg => pg.evaluate(() => /[㐀-鿿]/.test(document.getElementById('app').innerText));

  for (const v of VIEWS) {
    console.log('\n[' + v.name + ' ' + v.w + '×' + v.h + ']');
    const ctx = await br.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.name.startsWith('phone') || v.name.startsWith('tablet') });
    await ctx.addInitScript('window.__GO_IN = 300');
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(v.name + ' PAGEERR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(v.name + ' CONSOLE ' + m.text()); });
    const shot = n => pg.screenshot({ path: path.join(SHOTS, 'quest-' + v.name + '-' + n + '.png') });

    /* 1. 首頁 → 闖關入口，並確認兩種返回操作 */
    await pg.goto(base + '/');
    await pg.waitForSelector('.home-menu');
    ok(await pg.locator('.home-menu .quest-entry').count() === 1, '首頁直接提供闖關入口');
    ok(!(await overflow(pg)), '首頁沒有水平溢出（含闖關入口）');
    if (v.name === 'phone-land') {
      for (const lang of ['zh-Hant', 'zh-Hans', 'en']) {
        await pg.evaluate(lang => I18N.setLang(lang), lang);
        const visible = await pg.locator('.home-menu .btn').evaluateAll(buttons => buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        }));
        ok(visible, lang + ' 手機橫向首頁按鈕完整顯示');
      }
      await pg.evaluate(() => I18N.setLang('zh-Hant'));
      await pg.evaluate(() => {
        App.store.stats.solo = { win: 9, play: 10 };
        App.store.stats.online = { win: 9, play: 10 };
        App.go('home');
      });
      const clearOfSettings = await pg.evaluate(() => {
        const button = document.querySelector('.home-menu .btn').getBoundingClientRect();
        const settings = document.getElementById('gear').getBoundingClientRect();
        return button.right <= settings.left || button.left >= settings.right || button.top >= settings.bottom || button.bottom <= settings.top;
      });
      ok(clearOfSettings, '手機橫向首頁戰績不會讓選單與設定鈕重疊');
    }
    await shot('1-home-entry');
    await pg.click('.home-menu .quest-entry');
    await pg.waitForSelector('.q-lvl-card');
    await pg.locator('[data-screen=quest] .topbar button').click();
    ok(await pg.locator('[data-screen=home]').count() === 1, '難度頁返回按鈕回首頁');
    await pg.click('.home-menu .quest-entry');
    await pg.waitForSelector('.q-lvl-card');
    await pg.goBack();
    await pg.waitForSelector('[data-screen=home]');
    ok(await pg.locator('[data-screen=home]').count() === 1, '難度頁瀏覽器返回鍵回首頁');
    await pg.click('.home-menu .btn-pink');
    ok(await pg.locator('[data-screen=solo] .quest-entry').count() === 0, '單機設定不再顯示闖關入口');
    await pg.goBack();
    await pg.waitForSelector('[data-screen=home]');
    await pg.click('.home-menu .quest-entry');
    await pg.waitForSelector('.q-lvl-card');
    ok((await pg.$$('.q-lvl-card')).length === 4, '四段難度卡片');
    ok(!(await overflow(pg)), '難度選擇沒有水平溢出');
    await shot('2-levels');

    /* 2. 選關 */
    await pg.click('.q-lvl-card.lv-easy');
    await pg.waitForSelector('.q-cell');
    ok((await pg.$$('.q-cell')).length === 100, '選關有 100 格');
    ok((await pg.$$('.q-cell:not([disabled])')).length === 1, '全新存檔只有第 1 關解鎖');
    ok((await pg.$$('.q-cell.boss')).length === 10, '10 個關主關格');
    ok(!(await overflow(pg)), '選關沒有水平溢出');
    await shot('3-select');

    /* 3. 目標卡 → 開局 */
    await pg.click('.q-cell[data-no="1"]');
    await pg.waitForSelector('.dialog-quest');
    const introText = await pg.innerText('.dialog-quest');
    ok(/清光所有泡泡/.test(introText) && /發射數上限/.test(introText), '目標卡有目標與發射數上限', introText.replace(/\n/g, '|'));
    ok(/額外小目標/.test(introText), '目標卡有額外小目標');
    await shot('4-intro');
    await pg.click('.dialog-quest .btn-pink');
    await pg.waitForSelector('.game .boards');
    await pg.waitForSelector('.q-hint');
    ok(/三顆同色/.test(await pg.innerText('.q-hint')), '第 1 關開局出現操作提示');
    ok(await pg.$('.q-goal') !== null, '資訊欄有目標區');
    ok(!(await overflow(pg)), '對局沒有水平溢出');
    await shot('5-game-hint');
    const hud = await pg.innerText('.board-timer');
    ok(/剩 \d+ 發/.test(hud), '計時牌顯示剩餘發射數', hud);

    /* 4. 打完這一關 */
    const out = await playOut(pg, 200);
    ok(out.over, '電腦把第 1 關打到結束', JSON.stringify(out));
    await pg.waitForSelector('.quest-result', { timeout: 8000 });
    await sleep(900);
    await shot('6-result');
    const won = (await pg.innerText('.quest-result .head')).includes('過關');
    ok(won, '第 1 關過關結算', await pg.innerText('.quest-result .head'));
    const stars = (await pg.$$('.quest-result .q-star.on')).length;
    ok(stars >= 1 && stars <= 3, '結算顯示 ' + stars + ' 顆星');
    ok(/用了 \d+ 發/.test(await pg.innerText('.quest-result')), '結算顯示用了幾發');
    const saved = await pg.evaluate(() => App.store.quest.easy.stars[0]);
    ok(saved === stars, '星等寫進存檔', saved + ' vs ' + stars);
    ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('rainbow-bubble')).quest.easy.stars[0]) === stars, 'localStorage 真的存了');
    ok(!(await overflow(pg)), '結算沒有水平溢出');

    /* 5. 下一關 → 目標卡（第 2 關不再出現第 1 關的提示；第 2 關有新提示） */
    await pg.click('.quest-result .btn-pink');
    await pg.waitForSelector('.dialog-quest');
    ok(/第 2 關/.test(await pg.innerText('.dialog-quest .dialog-title')), '下一關：開出第 2 關目標卡');
    await shot('7-next-intro');
    await pg.click('.dialog-quest .btn-pink');
    await pg.waitForSelector('.game .boards');
    await pg.waitForSelector('.q-hint');
    ok(/牆壁/.test(await pg.innerText('.q-hint')), '第 2 關提示是反彈（新機制）');
    /* 5b. 暫停選單：第三顆鍵是「回選關」 */
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('.dialog-pause');
    ok(/回選關/.test(await pg.innerText('.dialog-pause')), '暫停選單第三顆鍵為回選關');
    await shot('8-pause');
    await pg.click('.dialog-pause .btn-ghost');
    await pg.waitForSelector('.q-cell');
    ok((await pg.$$('.q-cell:not([disabled])')).length === 2, '過了第 1 關後解鎖到第 2 關');
    ok((await pg.$$('.q-cell.done')).length === 1, '第 1 關標示為已過關');

    /* 6. 再玩第 1 關：提示只出現一次 */
    await pg.click('.q-cell[data-no="1"]');
    await pg.waitForSelector('.dialog-quest');
    await pg.click('.dialog-quest .btn-pink');
    await pg.waitForSelector('.game .boards');
    await sleep(400);
    ok(await pg.$('.q-hint') === null, '看過的提示不再出現');

    /* 7. 失敗結算：發射數只有 1 */
    await pg.evaluate(() => {
      const def = Object.assign({}, Quests.get('easy', 2), { shots: 1, goal: { type: 'color', color: 1, n: 999 } });
      App.beginQuest(def);
    });
    await pg.waitForSelector('.game .boards');
    await pg.evaluate(async () => { const g = App.game; while (!g.canAct()) await new Promise(r => setTimeout(r, 50)); g.fire(9000); });
    await pg.waitForSelector('.quest-result', { timeout: 8000 });
    await sleep(500);
    const lose = await pg.innerText('.quest-result');
    ok(/差一點點/.test(lose) && /發射數用完了/.test(lose), '失敗結算顯示原因', lose.replace(/\n/g, '|'));
    ok((await pg.$$('.quest-result .q-star.on')).length === 0, '失敗沒有星星');
    ok(/再試一次/.test(lose) && /回選關/.test(lose), '失敗結算有再試一次與回選關');
    ok(await pg.evaluate(() => App.store.quest.easy.stars[1] | 0) === 0, '失敗不會解鎖或記錄星等');
    await shot('9-fail');
    await pg.click('.quest-result .btn-ghost');
    await pg.waitForSelector('.q-cell');

    /* 8. 關主關（把前 9 關設成已過關） */
    await pg.evaluate(() => { App.store.quest.easy.stars = [3, 3, 3, 3, 3, 3, 3, 3, 3]; Store.save(App.store); App.go('questLevels', { level: 'easy' }); });
    await pg.waitForSelector('.q-cell.boss:not([disabled])');
    await pg.click('.q-cell[data-no="10"]');
    await pg.waitForSelector('.dialog-quest .q-boss');
    await shot('10-boss-intro');
    await pg.click('.dialog-quest .btn-pink');
    await pg.waitForSelector('.game .boards');
    await sleep(900);
    await shot('11-boss-game');
    ok(!(await overflow(pg)), '關主關對局沒有水平溢出');
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('.dialog-pause');
    await pg.click('.dialog-pause .btn-ghost');
    await pg.waitForSelector('.q-cell');

    /* 9. 英文介面 */
    await pg.evaluate(() => I18N.setLang('en'));
    await sleep(200);
    ok(!(await cjk(pg)), '英文選關畫面沒有中文殘留');
    await pg.evaluate(() => App.go('quest'));
    await pg.waitForSelector('.q-lvl-card');
    ok(!(await cjk(pg)), '英文難度選擇沒有中文殘留');
    await pg.evaluate(() => { App.store.quest.normal.stars = [2]; App.go('questLevels', { level: 'normal' }); });
    await pg.waitForSelector('.q-cell');
    await pg.click('.q-cell[data-no="2"]');
    await pg.waitForSelector('.dialog-quest');
    const en = await pg.innerText('.dialog-quest');
    ok(!/[㐀-鿿]/.test(en.replace(/[–·・]/g, '')), '英文目標卡沒有中文', en.replace(/\n/g, '|').slice(0, 120));
    await shot('12-en');
    await pg.evaluate(() => I18N.setLang('zh-Hant'));
    await ctx.close();
  }

  await br.close();
  if (child) child.kill();
  ok(errs.length === 0, '沒有 JS 錯誤', errs.slice(0, 5).join(' / '));
  console.log('\n' + pass + ' 項通過，' + fail + ' 項失敗');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
