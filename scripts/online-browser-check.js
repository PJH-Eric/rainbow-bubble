/* 線上畫面瀏覽器檢查：啟動 server.js（PORT=3199），用 Playwright 開三個獨立 context
 *（房主、受邀玩家、觀戰者）跑完整流程：建房 → 邀請連結 → 改暱稱加入 → 準備／開始 → 射擊對帳 →
 * 觀戰 → 中途離開結算 → 回房間 → 零真人關房。並檢查沒有 pageerror／console error，截圖到 shots/online-*.png。
 * 執行：node scripts/online-browser-check.js */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.OB_PORT) || 3199;
const BASE = 'http://127.0.0.1:' + PORT;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const LAND = { width: 1180, height: 820 }, PORT_VP = { width: 390, height: 844 };
const errors = [];

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch (e) { /* 等 */ }
    await wait(200);
  }
  throw new Error('server 沒起來');
}
function track(page, tag) {
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
}
const btn = (page, name) => page.getByRole('button', { name, exact: true }).first();
const shot = (page, name) => page.screenshot({ path: path.join(ROOT, 'shots', 'online-' + name + '.png') });
async function overflowX(page) {
  return page.evaluate(() => {
    const bad = [];
    const vw = document.documentElement.clientWidth;
    document.querySelectorAll('.screen *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') bad.push((el.className || el.tagName) + ':' + Math.round(r.right)); });
    return { scroll: document.querySelector('.screen') ? document.querySelector('.screen').scrollWidth - document.querySelector('.screen').clientWidth : 0, bad: bad.slice(0, 5) };
  });
}
const cleared = page => page.$$eval('.bslot', els => els.map(e => e.querySelector('.bt-name').textContent.trim().replace(/\s*🤖/, '') + '=' + e.querySelector('.bt-n').textContent.trim()).sort());

async function ctxPage(browser, vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'zh-TW' });
  const page = await ctx.newPage();
  track(page, tag);
  return { ctx, page };
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write(d));
  let browser;
  try {
    await waitHealth();
    browser = await chromium.launch();

    /* ---- 0. 沒有伺服器設定／無效邀請 ---- */
    console.log('設定錯誤與無效邀請');
    {
      const { ctx, page } = await ctxPage(browser, LAND, 'bad');
      await page.goto(BASE + '/?server=notaurl');
      await btn(page, '跟別人玩').click();
      ok(await page.getByText('還沒設定線上伺服器').isVisible(), 'server URL 無效時顯示需要設定伺服器的說明');
      await btn(page, '回首頁').click();
      ok(await page.locator('[data-screen=home]').count() === 1, '按鈕可回首頁');
      await ctx.close();
      const c2 = await ctxPage(browser, LAND, 'badinv');
      await c2.page.goto(BASE + '/?room=ZZZZ&t=bogusbogus12');
      await c2.page.waitForSelector('.invite-card');
      await c2.page.getByText('這個邀請不能用').waitFor({ timeout: 5000 });
      ok(true, '假邀請顯示「這個邀請不能用」');
      await c2.ctx.close();
    }

    /* ---- 1. 房主建房 ---- */
    console.log('房主建立房間');
    const A = await ctxPage(browser, LAND, 'A');
    const a = A.page;
    await a.goto(BASE + '/');
    await btn(a, '跟別人玩').click();
    await a.waitForSelector('.status:not(.bad):not(.warn)', { timeout: 15000 });
    ok(true, '大廳連線成功');
    await shot(a, 'lobby-landscape');
    await a.locator('input[aria-label="暱稱"]').fill('房主甲');
    await btn(a, '建立房間').click();
    await a.locator('input[aria-label="房間名稱"]').fill('測試房');
    await btn(a, '建立').click();
    await a.waitForSelector('[data-screen=room]');
    await a.getByText('正在同步房間資料').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await a.waitForFunction(() => document.querySelector('.room-head h2').textContent === '測試房');
    const code = (await a.locator('.room-meta .pill').first().textContent()).replace('代號', '').trim();
    ok(/^[A-Z]{4}$/.test(code), '房間代碼 ' + code);
    ok(await a.getByText('你是房主').first().isVisible(), '顯示你是房主');
    ok(await btn(a, '開始遊戲').isDisabled(), '人數不足時開始鈕停用');

    await btn(a, '玩家連結').click();
    await a.waitForSelector('.invite-item[data-role=player] code');
    await btn(a, '觀戰連結').click();
    await a.waitForSelector('.invite-item[data-role=spectator] code');
    const pUrl = await a.locator('.invite-item[data-role=player] code').first().textContent();
    const sUrl = await a.locator('.invite-item[data-role=spectator] code').first().textContent();
    ok(pUrl.startsWith(BASE + '/?room=' + code + '&t='), '玩家邀請連結格式 ' + pUrl.replace(/t=.*/, 't=…'));
    ok(sUrl.includes('room=' + code) && sUrl !== pUrl, '觀戰邀請連結不同於玩家連結');
    await btn(a, '玩家連結').focus();
    // 設定：模式／時間存在
    ok(await a.locator('.rules-panel').count() === 1, '房主看得到規則面板');

    /* ---- 2. 受邀玩家 ---- */
    console.log('受邀玩家');
    const B = await ctxPage(browser, LAND, 'B');
    const b = B.page;
    await b.goto(pUrl);
    await b.waitForSelector('.invite-card');
    await b.getByText('你會是玩家').waitFor({ timeout: 15000 });
    ok(await b.getByText('測試房').first().isVisible(), '邀請卡顯示房名');
    ok(await b.locator('.invite-card input[aria-label="暱稱"]').inputValue() !== '', '邀請卡暱稱欄有預設值');
    await shot(b, 'invite-landscape');
    ok(await a.locator('[data-screen=room]').count() === 1 && (await a.locator('.seat:not(.empty)').count()) === 1, '確認前 B 還沒入房');
    await b.locator('.invite-card input[aria-label="暱稱"]').fill('小乙');
    await btn(b, '加入遊戲').click();
    await b.waitForSelector('[data-screen=room]');
    await b.waitForFunction(() => document.querySelector('.room-head h2').textContent === '測試房');
    ok(!/room=|t=/.test(b.url()), '加入後網址已移除邀請參數：' + b.url());
    ok(await b.getByText('你是玩家').first().isVisible(), 'B 顯示你是玩家');
    await a.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 2);
    ok((await a.locator('.seat-name').allTextContents()).includes('小乙'), 'A 看到 B 用編輯後的暱稱「小乙」');
    ok(await b.locator('.seat .pill', { hasText: '房主' }).count() === 1, '房主徽章只有一個');
    ok(await b.getByRole('button', { name: '請出 房主甲' }).count() === 0, '非房主沒有踢人鈕');
    ok(await a.getByRole('button', { name: '請出 小乙' }).count() === 1, '房主有踢人鈕');

    /* ---- 3. 觀戰者（先在房間裡） ---- */
    console.log('觀戰者');
    const S = await ctxPage(browser, LAND, 'S');
    const s = S.page;
    await s.goto(sUrl);
    await s.getByText('你會是觀戰者').waitFor({ timeout: 15000 });
    await s.locator('.invite-card input[aria-label="暱稱"]').fill('看戲');
    await btn(s, '進去觀戰').click();
    await s.waitForSelector('[data-screen=room]');
    await s.waitForFunction(() => document.querySelector('.room-head h2').textContent === '測試房');
    ok(await s.getByText('你是觀戰者').first().isVisible(), 'S 顯示你是觀戰者');
    await a.getByText('看戲').first().waitFor({ timeout: 5000 });
    ok(true, '房主看到觀戰席有「看戲」');

    /* ---- 聊天：輸入中不被重畫 ---- */
    const chatIn = b.locator('.room-chat input');
    await chatIn.click(); await chatIn.type('你好呀', { delay: 20 });
    await btn(a, '玩家連結').click(); // 觸發 A 的房間更新，B 也會收到 room
    await a.locator('.room-chat input').fill('嗨');
    await wait(300);
    ok(await chatIn.inputValue() === '你好呀' && await chatIn.evaluate(e => e === document.activeElement), '其他人更新房間時，聊天輸入框保留文字與焦點');
    await chatIn.press('Enter');
    await a.waitForFunction(() => document.querySelector('.room-chat .chat-log').textContent.includes('你好呀'));
    await s.waitForFunction(() => document.querySelector('.room-chat .chat-log').textContent.includes('你好呀'));
    ok(true, '聊天訊息 B → A、S 都收到');
    await shot(a, 'room-landscape');

    /* ---- 4. 準備、開始 ---- */
    await a.getByRole('radio', { name: '2 分', exact: true }).click();
    await b.locator('.chips .pill', { hasText: '2 分鐘' }).waitFor({ timeout: 5000 });
    ok(true, '房主改成 2 分鐘，B 的唯讀摘要同步顯示');
    await btn(b, '我準備好了').click();
    await a.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('開始遊戲')); return b && !b.disabled; });
    ok(true, '全部準備好後房主「開始遊戲」才可按');
    // 縮小視窗截圖（直向）
    await b.setViewportSize(PORT_VP); await wait(300);
    await shot(b, 'room-portrait');
    ok((await overflowX(b)).scroll <= 1, 'B 房間畫面 390 寬沒有橫向溢出 ' + JSON.stringify(await overflowX(b)));
    await b.setViewportSize(LAND);
    await btn(a, '開始遊戲').click();
    for (const p of [a, b, s]) await p.waitForSelector('.game', { timeout: 10000 });
    ok(true, '三個人都進入對局畫面');
    await wait(3600);
    ok(await a.locator('.bslot').count() === 2 && await s.locator('.bslot').count() === 2, '玩家與觀戰者都看到 2 塊盤面');
    ok(await s.locator('.bslot.mine').count() === 0 && await s.getByText('觀戰中').count() >= 1, '觀戰者沒有自己的盤面、顯示觀戰中');

    /* ---- 5. 射擊與對帳 ---- */
    console.log('射擊對帳');
    async function fire(page, n, seed) {
      const box = await page.locator('.bslot.mine canvas').boundingBox();
      for (let i = 0; i < n; i++) {
        const fx = 0.15 + 0.7 * ((i * 0.37 + seed) % 1);
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.25);
        await wait(330);
      }
    }
    await Promise.all([fire(a, 12, 0.1), fire(b, 12, 0.6)]);
    await wait(2600);
    const ca = await cleared(a), cb = await cleared(b), cs = await cleared(s);
    console.log('    cleared A=' + ca + ' B=' + cb + ' S=' + cs);
    ok(ca.length === 2 && ca.join() === cb.join() && ca.join() === cs.join(), '玩家 A、B 與觀戰者看到相同的消除數');
    await shot(a, 'game-landscape');
    await shot(s, 'game-spectator-landscape');
    await b.setViewportSize(PORT_VP); await wait(500);
    await shot(b, 'game-portrait');
    await b.setViewportSize(LAND); await wait(300);
    // 聊天（對局側欄）
    await a.waitForFunction(() => document.querySelector('.game .chat-log').textContent.includes('你好呀'));
    ok(true, '對局側欄聊天室帶入房間裡的聊天紀錄');

    /* ---- 6. B 中途離開 → 結算 ---- */
    console.log('中途離開與結算');
    if (await b.locator('.result-card').count()) {
      console.log('    （這局有人先清光盤面，已提早結算；B 改按結算畫面的「回到首頁」）');
      await b.locator('.result-card').getByRole('button', { name: '回到首頁', exact: true }).click();
      await b.waitForSelector('[data-screen=home]', { timeout: 5000 });
      ok(true, 'B 從結算畫面回到首頁');
    } else {
      await b.getByRole('button', { name: '離開對局' }).click();
      await b.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    }
    if (!(await b.locator('[data-screen=home]').count())) {
      await b.waitForSelector('[data-screen=lobby]', { timeout: 5000 });
      ok(true, 'B 離開對局回到大廳房間列表');
    }
    console.log('    （等候 2 分鐘賽程結束…）');
    await a.waitForSelector('.result-card', { timeout: 160000 });
    await s.waitForSelector('.result-card', { timeout: 15000 });
    ok(true, 'A 與觀戰者都出現結算畫面');
    await shot(a, 'result-landscape');
    await wait(1200);
    ok(await a.locator('.result-card').count() === 1 && await a.locator('.game').count() === 1, '房間回到等待中時結算畫面仍在，不被強制切走');
    await s.locator('.result-card').getByRole('button', { name: '回到房間', exact: true }).click();
    await s.waitForSelector('[data-screen=room]');
    await a.locator('.result-card').getByRole('button', { name: '再來一局', exact: true }).click();
    await a.waitForSelector('[data-screen=room]');
    ok(await a.locator('[data-screen=room]').count() === 1, '再來一局 → 回到房間');
    await a.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 1);
    ok(true, 'B 離開後座位清空');

    /* ---- 7. 房主離開 → 零真人 → 觀戰者收到關閉 ---- */
    console.log('零真人關房');
    await btn(a, '離開房間').click();
    await a.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    await a.waitForSelector('[data-screen=lobby]');
    ok(true, '房主離開後回大廳');
    await s.getByText('房間結束了').waitFor({ timeout: 6000 });
    ok(await s.getByText('所有玩家都離開了').isVisible(), '觀戰者看到「房間結束了」說明');
    await btn(s, '回到大廳').click();
    await s.waitForSelector('[data-screen=lobby]');
    ok(true, '觀戰者按回到大廳');
    await shot(s, 'lobby-after-landscape');
    await s.setViewportSize(PORT_VP); await wait(300);
    await shot(s, 'lobby-portrait');
    ok((await overflowX(s)).scroll <= 1, '大廳 390 寬沒有橫向溢出 ' + JSON.stringify(await overflowX(s)));

    /* ---- 8. 重連：房間內斷線再連回 ---- */
    console.log('重連');
    await btn(a, '建立房間').click();
    await btn(a, '建立').click();
    await a.waitForSelector('[data-screen=room]');
    await a.waitForFunction(() => document.querySelector('.room-head h2').textContent !== '進入房間中…');
    await A.ctx.setOffline(true); await wait(500); await A.ctx.setOffline(false);
    await a.evaluate(() => Net.close());
    await a.evaluate(() => Net.open());
    await a.waitForFunction(() => Net.connected, null, { timeout: 15000 });
    await wait(500);
    ok(await a.locator('[data-screen=room]').count() === 1 && await a.locator('.room-head h2').textContent() !== '進入房間中…', '重連後仍在房間畫面且資料還在');

    /* ---- 9. 代碼加入、大廳列表觀戰、對局中零真人關房 ---- */
    console.log('代碼加入／列表觀戰／對局中關房');
    const code2 = (await a.locator('.room-meta .pill').first().textContent()).replace('代號', '').trim();
    await b.setViewportSize(LAND); await s.setViewportSize(LAND);
    if (!(await b.locator('[data-screen=lobby]').count())) await btn(b, '跟別人玩').click();   /* B 中途離開後本來就在大廳 */
    await b.waitForSelector('.status:not(.bad):not(.warn)', { timeout: 15000 });
    await b.locator('input[aria-label="房間代碼"]').fill(code2.toLowerCase());
    ok(await b.locator('input[aria-label="房間代碼"]').inputValue() === code2, '房間代碼輸入自動轉大寫');
    await btn(b, '加入').click();
    await b.waitForSelector('[data-screen=room]');
    await b.waitForFunction(() => document.querySelector('.room-head h2').textContent !== '進入房間中…');
    ok(await b.getByText('你是玩家').first().isVisible(), '用代碼加入成為玩家');
    await s.locator('.room-item', { hasText: code2 }).getByRole('button', { name: '觀戰', exact: true }).click();
    await s.waitForSelector('[data-screen=room]');
    ok(await s.getByText('你是觀戰者').first().isVisible(), '從大廳列表按「觀戰」成為觀戰者');
    await btn(b, '我準備好了').click();
    await a.waitForFunction(() => { const x = [...document.querySelectorAll('button')].find(y => y.textContent.includes('開始遊戲')); return x && !x.disabled; });
    await btn(a, '開始遊戲').click();
    for (const p of [a, b, s]) await p.waitForSelector('.game', { timeout: 10000 });
    await wait(1500);
    await a.getByRole('button', { name: '離開對局' }).click();
    await a.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    await a.waitForSelector('[data-screen=lobby]');
    ok(await s.locator('.game').count() === 1, '還有一位玩家時觀戰者繼續看');
    await b.getByRole('button', { name: '離開對局' }).click();
    await b.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    await s.getByText('房間結束了').waitFor({ timeout: 6000 });
    ok(true, '對局中最後一位玩家離開 → 觀戰者在對局畫面收到「房間結束了」');
    await btn(s, '回到大廳').click();
    await s.waitForSelector('[data-screen=lobby]');
    ok(true, '觀戰者回到大廳');

    /* ---- 10. 線上加入電腦 ---- */
    console.log('線上加入電腦');
    await s.setViewportSize(LAND);
    await btn(s, '建立房間').click();
    await btn(s, '建立').click();
    await s.waitForSelector('[data-screen=room]');
    await s.waitForFunction(() => document.querySelector('.room-head h2').textContent !== '進入房間中…');
    const code3 = (await s.locator('.room-meta .pill').first().textContent()).replace('代號', '').trim();
    ok(await btn(s, '開始遊戲').isDisabled(), '只有 1 位真人時開始鈕停用');
    ok(await s.locator('.seat.empty.can-add').count() === 3, '房主的空位上直接有「加入電腦」可點（共 3 個空位）');
    await s.locator('.seat.empty.can-add').first().click();
    await s.waitForSelector('.seat.ai');
    ok(await s.locator('.ai-pick').count() === 0 && await s.locator('.dialog').count() === 0, '點空位直接加入，沒有彈窗');
    await s.waitForTimeout(100);
    await s.waitForSelector('.seat.ai');
    ok(await s.locator('.seat.ai').count() === 1 && /・電腦/.test(await s.locator('.seat.ai .seat-name').textContent()) && (await s.locator('.seat.ai .seat-tags').textContent()).includes('🤖'), '席位出現電腦：名字「・電腦」＋🤖 標記');
    ok((await s.locator('.seat.ai .dd-cur').textContent()).trim() === '簡單', '電腦席位有等級選單，預設跟房間難度「簡單」');
    ok(await btn(s, '開始遊戲').isEnabled(), '1 位真人 + 1 位電腦就能開始（電腦自動準備）');
    await shot(s, 'room-ai-landscape');
    /* 另一位玩家用代碼加入：電腦席位唯讀 */
    if (!(await b.locator('[data-screen=lobby]').count())) await btn(b, '跟別人玩').click();
    await b.waitForSelector('.status:not(.bad):not(.warn)', { timeout: 15000 });
    await b.locator('input[aria-label="房間代碼"]').fill(code3);
    await btn(b, '加入').click();
    await b.waitForSelector('[data-screen=room]');
    await b.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 3);
    ok(await b.locator('.seat.ai').count() === 1 && (await b.locator('.seat.ai .seat-tags').textContent()).includes('簡單'), '非房主看得到電腦席位與等級（唯讀）');
    ok(await b.locator('.seat.ai .dd').count() === 0 && await b.locator('.seat.ai .icon-btn').count() === 0 && await b.getByRole('button', { name: '加入電腦' }).count() === 0, '非房主沒有換等級／移除／加入電腦的控制項');
    await b.setViewportSize(PORT_VP); await wait(300);
    await shot(b, 'room-ai-portrait');
    ok((await overflowX(b)).scroll <= 1, '含電腦席位的房間 390 寬沒有橫向溢出 ' + JSON.stringify(await overflowX(b)));
    await b.setViewportSize(LAND);
    /* 加到滿：2 真人 + 1 電腦 → 再加 1 個 → 滿 4 位，按鈕停用且有原因 */
    await s.locator('.seat.empty.can-add').first().click();
    await s.waitForFunction(() => document.querySelectorAll('.seat.ai').length === 2);
    await s.waitForFunction(() => document.querySelectorAll('.seat.ai').length === 2);
    ok(await s.locator('.seat.empty.can-add').count() === 0 && await s.locator('.seat:not(.empty)').count() === 4, '席位滿了：沒有空位，也就沒有可點的「加入電腦」');
    await s.locator('.seat.ai').last().getByRole('button', { name: /^移除 / }).click();
    await s.waitForFunction(() => document.querySelectorAll('.seat.ai').length === 1);
    ok(await s.locator('.seat.empty.can-add').count() === 1, '移除一個電腦後，空位上又可以點「加入電腦」');
    /* b 離開、1 真人 + 1 電腦開局 */
    await btn(b, '離開房間').click();
    await b.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    await b.waitForSelector('[data-screen=lobby]');
    await s.waitForFunction(() => document.querySelectorAll('.seat:not(.empty)').length === 2);
    await btn(s, '開始遊戲').click();
    await s.waitForSelector('.game', { timeout: 10000 });
    await wait(3600);
    ok(await s.locator('.bslot').count() === 2, '對局畫面有 2 塊盤面（我 + 電腦）');
    ok((await s.locator('.bslot .bt-name').allTextContents()).some(t => t.includes('🤖')), 'HUD 的電腦名字帶 🤖');
    await s.waitForFunction(() => App.game && App.game.m && App.game.m.boards[1].shots >= 3, null, { timeout: 40000 });
    ok(true, '電腦盤面自己在動（伺服器代打，已射出 ' + await s.evaluate(() => App.game.m.boards[1].shots) + ' 發）');
    await shot(s, 'game-ai-landscape');
    await s.getByRole('button', { name: '離開對局' }).click();
    /* 電腦偶爾很快清光盤面、對局先結束：這時按離開會直接回大廳，不會跳確認框 */
    if (await s.waitForSelector('.dialog', { timeout: 4000 }).then(() => true, () => false)) {
      await s.locator('.dialog').getByRole('button', { name: '離開', exact: true }).click();
    }
    await s.waitForSelector('[data-screen=lobby]');
    ok(true, '真人離開後回大廳房間列表（房間隨之關閉）');

    ok(errors.length === 0, '沒有 pageerror／console error' + (errors.length ? '：\n      ' + errors.join('\n      ') : ''));
  } catch (e) {
    fails++;
    console.log('  ✗ 例外：' + (e && e.stack || e));
    if (errors.length) console.log('  先前錯誤：\n    ' + errors.join('\n    '));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
