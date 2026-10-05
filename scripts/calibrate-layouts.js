/* ===== scripts/calibrate-layouts.js — 量每個地圖在各難度的「好不好打」，產生 public/js/layout-tiers.js =====
 * 做法：用固定強度的電腦（hard）在每張地圖上各玩 K 局，量要幾發才清光盤面。
 * 只保留清光發數接近該難度中位數的地圖（太好打、太難打的剔除），讓每一局的體感難度一致。
 * 用法：node scripts/calibrate-layouts.js [K=10] [下限倍數=0.65] [上限倍數=1.6]
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../public/js/rules.js'), AI = require('../public/js/ai.js'), L = require('../public/js/layouts.js');
const K = +process.argv[2] || 10, LO = +process.argv[3] || 0.65, HI = +process.argv[4] || 1.6, CAP = 60;
const ids = L.PATTERNS.map(p => p.id).concat(L.FAMILIES.map(f => f.id));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const out = {};
for (const lv of R.LEVELS) {
  const cost = {};
  for (const id of ids) {
    if (lv === 'baby' && (L.PATTERNS.find(p => p.id === id) || {}).obstacle) continue;     /* 幼幼班沒有雲朵磚地圖 */
    const arr = [];
    for (let k = 1; k <= K; k++) {
      const seed = k * 7919 + 101;
      const b = R.newBoard({ seed, level: lv, layoutId: id });
      const brain = AI.createBrain('hard', seed);
      let n = 0;
      while (n < CAP && !b.fullClear) { const d = AI.decide(b, brain, 'race'); if (d.swap) R.swapItems(b); R.applyShot(b, d.a); n++; }
      arr.push(n);
    }
    cost[id] = median(arr);       /* 這張地圖要幾發才清光（固定強度的電腦，取中位數） */
  }
  const M = median(Object.values(cost));
  let allow = Object.keys(cost).filter(id => cost[id] >= M * LO && cost[id] <= M * HI);
  if (allow.length < 14) allow = Object.keys(cost).sort((a, b) => Math.abs(cost[a] - M) - Math.abs(cost[b] - M)).slice(0, 14);
  out[lv] = { M, allow: allow.sort() };
  console.log(lv.padEnd(7), '中位清光發數', M, '保留', allow.length + '/' + Object.keys(cost).length, '範圍', Math.round(M * LO) + '～' + Math.round(M * HI));
}
const body = '/* 由 scripts/calibrate-layouts.js 產生，不要手改。各難度可抽的地圖（太好打或太難打的已剔除） */\n(function (root) {\n  var T = ' + JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.allow])), null, 1).replace(/\n\s+/g, ' ') + ';\n  root.LayoutTiers = T;\n  if (typeof module !== \'undefined\' && module.exports) module.exports = T;\n})(typeof self !== \'undefined\' ? self : this);\n';
fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'layout-tiers.js'), body);
console.log('已寫入 public/js/layout-tiers.js');
