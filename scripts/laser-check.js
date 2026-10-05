'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require(fs.existsSync('/opt/npm-tools/node_modules/playwright') ? '/opt/npm-tools/node_modules/playwright' : 'playwright');
const ROOT = path.join(__dirname, '..');
(async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3197' }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await pg.goto('http://127.0.0.1:3197/'); await pg.waitForSelector('.home-menu');
  await pg.click('text=一個人玩'); await pg.waitForSelector('.sticky-cta');
  await pg.evaluate(() => { App.store.solo.opponents = 0; App.store.solo.mode = 'race'; App.store.solo.level = 'normal'; App.store.solo.duration = 0; App.go('solo'); });
  await pg.click('text=開始遊戲'); await pg.waitForSelector('.bslot canvas');
  await pg.waitForFunction(() => App.game && App.game.mt() > 300, null, { timeout: 8000 });
  for (const k of ['laser']) {
    const before = await pg.evaluate(() => { const b = App.game.m.boards[0]; return b.rows.flat().filter(x => x).length; });
    await pg.evaluate(k => { const b = App.game.m.boards[0]; b.cur = { k, c: 0 }; }, k);
    const cv = await pg.$('.bslot.mine canvas'); const bb = await cv.boundingBox();
    await pg.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.3);
    for (const [i, ms] of [[1, 200], [2, 130], [3, 130]]) { await pg.waitForTimeout(ms); await pg.screenshot({ path: path.join(ROOT, 'shots', 'laser-' + k + '-f' + i + '.png'), clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } }); }
    await pg.waitForTimeout(900);
    const after = await pg.evaluate(() => { const b = App.game.m.boards[0]; return { cleared: b.cleared, shots: b.shots, cnt: b.rows.flat().filter(x => x).length }; });
    console.log(k, 'before', before, 'after', JSON.stringify(after));
    await pg.screenshot({ path: path.join(ROOT, 'shots', 'laser-' + k + '-after.png') });
  }
  console.log('errors:', JSON.stringify(errs));
  await br.close(); child.kill();
})();
