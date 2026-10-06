/* ===== scripts/timer-row-check.js — 名牌、計時牌、暫停鍵是否在同一排、互不重疊、不蓋到盤面（Playwright） ===== */
'use strict';
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const { chromium } = require(fs.existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fail = 0;
const ok = (c, n, x) => { console.log((c ? '  ok  ' : '  FAIL ') + n + (c || !x ? '' : '  ' + x)); if (!c) fail++; };
const GO = Number(process.env.GAME_GO_IN) || 3000;
const VIEWS = [['desktop', 1366, 768], ['tablet-land', 1180, 820], ['tablet-port', 820, 1180], ['phone-port', 390, 844], ['phone-small', 340, 600], ['phone-land', 844, 390]];
(async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3192' }), stdio: 'ignore' });
  const base = 'http://127.0.0.1:3192';
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) { /* 等 */ } await new Promise(r => setTimeout(r, 150)); }
  const br = await chromium.launch();
  const errs = [];
  for (const [name, w, h] of VIEWS) {
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript('window.__GO_IN = ' + GO);
    const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(name + ' ' + e.message));
    await pg.goto(base + '/'); await pg.waitForSelector('.home-menu');
    await pg.click('text=一個人玩'); await pg.waitForSelector('.sticky-cta');
    for (const opp of [0, 1, 3]) {
      await pg.evaluate(n => { App.store.solo.opponents = n; App.store.solo.mode = n ? 'duel' : 'race'; App.go('solo'); }, opp);
      await pg.click('text=開始遊戲'); await pg.waitForSelector('.bslot.mine canvas'); await pg.waitForTimeout(GO + 400);
      const r = await pg.evaluate(() => {
        const g = q => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, r: b.right, t: b.top, b: b.bottom, cy: (b.top + b.bottom) / 2 }; };
        const tag = g('.bslot.mine .btag'), tm = g('.board-time'), pa = g('.board-pause'), cv = g('.bslot.mine canvas');
        return { tag, tm, pa, cv, vw: innerWidth };
      });
      const tag = `${name} ${opp + 1}人`;
      ok(r.tag && r.tm && r.pa, tag + '：名牌、計時牌、暫停鍵都在');
      const rows = Math.max(r.tag.cy, r.tm.cy, r.pa.cy) - Math.min(r.tag.cy, r.tm.cy, r.pa.cy);
      ok(rows <= 3, tag + '：三個在同一排（垂直中心差 ' + rows.toFixed(1) + 'px）');
      ok(r.tag.r <= r.tm.x + 1 && r.tm.r <= r.pa.x + 1, tag + '：三個互不重疊', JSON.stringify([r.tag.r, r.tm.x, r.tm.r, r.pa.x]));
      ok(Math.max(r.tag.b, r.tm.b, r.pa.b) <= r.cv.t + 1, tag + '：沒有蓋到盤面（最低 ' + Math.max(r.tag.b, r.tm.b, r.pa.b).toFixed(0) + '、盤面上緣 ' + r.cv.t.toFixed(0) + '）');
      ok(r.pa.r <= r.vw && r.tag.x >= 0, tag + '：沒有超出視窗');
      const gL = r.tag.x - r.cv.x, gR = r.cv.r - r.pa.r;
      ok(Math.abs(gL - gR) <= 3 || r.tag.x <= r.cv.x + 2, tag + '：整組置中（左空 ' + gL.toFixed(0) + '／右空 ' + gR.toFixed(0) + '）');
      ok(r.tm.x - r.tag.r <= 14 && r.pa.x - r.tm.r <= 14, tag + '：間距小（' + (r.tm.x - r.tag.r).toFixed(0) + '、' + (r.pa.x - r.tm.r).toFixed(0) + 'px）');
      if (opp === 1) await pg.screenshot({ path: path.join(SHOTS, 'timer-row-' + name + '.png'), clip: { x: 0, y: 0, width: Math.min(w, 700), height: Math.min(h, 330) } });
      await pg.evaluate(() => App.go('home')); await pg.click('text=一個人玩'); await pg.waitForSelector('.sticky-cta');
    }
    await ctx.close();
  }
  ok(errs.length === 0, '沒有 JS 錯誤', errs.join('|'));
  await br.close(); child.kill();
  console.log(fail ? '\n有失敗' : '\n全部通過'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
