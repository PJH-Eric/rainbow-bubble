/* scripts/gen-quests.js — 產生闖關 400 關資料（public/js/quests-data.js）
 *
 * 用法：
 *   node scripts/gen-quests.js                 全部四段難度（跑完才寫檔）
 *   node scripts/gen-quests.js --level normal  只跑一段難度，結果存進 scripts/.quest-cache/normal.json
 *   node scripts/gen-quests.js --merge         把四份快取合併寫成 public/js/quests-data.js
 *   node scripts/gen-quests.js --quick         每關只模擬 2 次（測試用，不寫檔）
 *
 * 做法：先依規劃書排出每關的版型／顏色數／排數／目標，再用電腦（四段難度各一種）模擬多次，
 * 以模擬的發射數中位數 × 係數得到發射數上限（shots）與參考值（ref）；通關率太低就換 seed 重排。
 * 全部亂數固定，所以每次產生的結果相同；資料檔提交進 repo，執行期不重算。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../public/js/rules.js');
const M = require('../public/js/match.js');
const AI = require('../public/js/ai.js');
const L = require('../public/js/layouts.js');
const Tiers = require('../public/js/layout-tiers.js');

const LEVELS = ['baby', 'easy', 'normal', 'hard'];
const PER = 100;
const COLORS = { baby: [3, 4], easy: [3, 6], normal: [4, 8], hard: [5, 10] };
const ROWS = { baby: [5, 7], easy: [6, 8], normal: [7, 9], hard: [8, 10] };
const BOSS_ROWS = { baby: 8, easy: 9, normal: 10, hard: 10 };
const FACTOR = { baby: 0, easy: 1.6, normal: 1.4, hard: 1.25 };
const PASS_MIN = { easy: 0.8, normal: 0.6, hard: 0.4 };
const SIM_AI = { baby: 'easy', easy: 'easy', normal: 'normal', hard: 'hard' };
const BOSS_ORDER = {
  baby:   ['boss-heart', 'boss-sun', 'boss-cat', 'boss-flower', 'boss-rainbow', 'boss-balloons', 'boss-butterfly', 'boss-rocket', 'boss-star', 'boss-castle'],
  easy:   ['boss-cat', 'boss-rainbow', 'boss-flower', 'boss-heart', 'boss-balloons', 'boss-sun', 'boss-rocket', 'boss-butterfly', 'boss-castle', 'boss-star'],
  normal: ['boss-balloons', 'boss-butterfly', 'boss-sun', 'boss-rocket', 'boss-heart', 'boss-cat', 'boss-castle', 'boss-flower', 'boss-rainbow', 'boss-star'],
  hard:   ['boss-rocket', 'boss-castle', 'boss-star', 'boss-butterfly', 'boss-cat', 'boss-rainbow', 'boss-sun', 'boss-balloons', 'boss-flower', 'boss-heart']
};
/* 教學關（第 1～9 關）想用的版型，該難度挑不到就換下一個 */
const TUTORIAL_LAYOUTS = [
  ['heart', 'smile', 'star'], ['smile', 'target', 'flower'], ['umbrella', 'balloon', 'tree'], ['flower', 'cake', 'gem'],
  ['cat', 'rabbit', 'chick'], ['star', 'crown', 'target'], ['cross', 'checker', 'gem'], ['cake', 'icecream', 'house'], ['tree', 'mushroom', 'rocket']
];
const MINIS = ['streak3', 'noswap', 'drop8', 'nodescent'];

const args = process.argv.slice(2);
const flag = n => args.indexOf(n) >= 0;
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const QUICK = flag('--quick');
const TRIALS = QUICK ? 2 : 5;
const CACHE = path.join(__dirname, '.quest-cache');
const OUT = path.join(__dirname, '../public/js/quests-data.js');

const lerp = (a, b, g) => a + Math.round((b - a) * g / 9);
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/* ---------- 排出每一關的設定（還沒校準發射數） ---------- */
function planLevel(lv, li) {
  const tier = Tiers[lv];
  const patterns = L.PATTERNS.filter(p => tier.indexOf(p.id) >= 0);
  const gens = tier.filter(id => id.indexOf('gen-') === 0);
  const rng = R.mulberry32(0x9E3779B1 ^ (li * 7919 + 17));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  let queue = [], last = '', handCount = 0, genCount = 0;
  const nextHand = noObs => {
    for (let guard = 0; guard < 4; guard++) {
      if (!queue.length) queue = shuffle(patterns.filter(p => !(noObs && p.obstacle)).map(p => p.id));
      const id = queue.shift();
      if (id !== last) { last = id; return id; }
    }
    return queue.shift();
  };
  const out = [];
  for (let no = 1; no <= PER; no++) {
    const g = Math.floor((no - 1) / 10), pos = ((no - 1) % 10) + 1, boss = pos === 10;
    const lrng = R.mulberry32(R.hash2(li * 1000 + no, 4711));
    const noObs = lv === 'baby' || no < 21;
    const def = {
      id: lv + '-' + no, level: lv, no, boss,
      seed: (R.hash2(li * 1000 + no, 20261027) >>> 0),
      theme: g % 7,
      colors: lerp(COLORS[lv][0], COLORS[lv][1], g),
      rows: boss ? BOSS_ROWS[lv] : lerp(ROWS[lv][0], ROWS[lv][1], g),
      noObs, rescue: lv === 'baby', goal: { type: 'clear' }, hint: null, mini: '', shots: 0, ref: 0
    };
    if (no <= 9) def.rows = ROWS[lv][0];
    /* 版型 */
    if (boss) def.layout = BOSS_ORDER[lv][g];
    else if (no <= 9) def.layout = TUTORIAL_LAYOUTS[no - 1].find(id => tier.indexOf(id) >= 0) || TUTORIAL_LAYOUTS[no - 1][0];
    else if (pos % 4 === 0 && gens.length) { def.layout = gens[genCount++ % gens.length]; }
    else { def.layout = nextHand(noObs); handCount++; }
    /* 目標、提示、教學指定泡泡 */
    if (no <= 10) {
      def.colors = Math.min(def.colors, COLORS[lv][0] + (no >= 6 ? 1 : 0));
      def.colors = Math.max(COLORS[lv][0], Math.min(def.colors, COLORS[lv][1]));
      const HINTS = ['shoot', 'bounce', 'drop', 'rainbow', 'swap', 'star', 'laser', 'bonus', lv === 'baby' ? null : 'descend'];
      def.hint = HINTS[no - 1] || null;
      if (no === 4) def.force = { 2: { k: 'rainbow', c: 0 } };
      if (no === 7) def.force = { 2: { k: 'laser', c: 0 } };
      if (no === 6) { def.goal = { type: 'star' }; def.stars = 3; }
      if (no === 8) { def.goal = { type: 'bonus', n: 2 }; def.bonus = 4; }
    }
    if (boss) {
      if (g % 2 === 0) { def.goal = { type: 'star' }; def.stars = 4 + (g >= 6 ? 1 : 0); }
      else { const tot = 5 + (g >= 7 ? 1 : 0); def.bonus = tot; def.goal = { type: 'bonus', n: tot - 2 }; }
      def.hint = no === 10 ? 'boss' : null;
    } else if (no > 10) {
      const r = lrng();
      const colorOK = no >= 41;
      if (r < 0.46) def.goal = { type: 'clear' };
      else if (r < 0.7) { def.goal = { type: 'star' }; def.stars = 3 + (g >= 5 ? 1 : 0); }
      else if (r < 0.86 || !colorOK) { const tot = 4 + Math.floor(g / 3); def.bonus = tot; def.goal = { type: 'bonus', n: Math.max(2, tot - 2) }; }
      else def.goal = { type: 'color', color: 0, n: 0 };    /* 顏色與數量等盤面建好後再定 */
    }
    /* 提示：新機制第一次出現 */
    if (!def.hint) {
      if (def.goal.type === 'color' && !firstSeen.color) { def.hint = 'colorgoal'; firstSeen.color = true; }
      else if (!def.noObs && !firstSeen.cloud && L.PATTERNS.some(p => p.id === def.layout && p.obstacle)) { def.hint = 'cloud'; firstSeen.cloud = true; }
    }
    /* 小目標 */
    const pool = MINIS.filter(m => !(m === 'nodescent' && lv === 'baby'));
    def.mini = boss ? 'streak3' : pool[(no + li) % pool.length];
    out.push(def);
  }
  return out;
}
let firstSeen = {};

/* ---------- 校準：用電腦模擬 ---------- */
function simProfile(lv) {
  const p = Object.assign({}, AI.PROFILE[SIM_AI[lv]]);
  if (lv === 'hard') p.step = 200;
  if (lv === 'normal') p.step = 300;
  return p;
}
function simOnce(def, trialSeed, lv) {
  const d = Object.assign({}, def, { shots: 0 });
  const m = M.create({ mode: 'quest', quest: d, level: d.level, seed: d.seed, players: [{ name: 'sim' }] });
  const b = m.boards[0];
  const brain = AI.createBrain(SIM_AI[lv], trialSeed);
  brain.p = simProfile(lv);
  /* 模擬時不限發射數：看電腦到底要幾發才過關 */
  let t = 0;
  for (let i = 0; i < 160 && !m.over; i++) {
    const dec = AI.decide(b, brain, 'quest');
    if (dec.swap) M.input(m, 0, { t: 'swap' }, t);
    M.input(m, 0, { t: 'shot', a: dec.a }, t);
    t += 300;
  }
  return { win: !!(m.result && m.result.quest.win), shots: b.shots, verdict: m.result ? m.result.reason : 'timeout', mini: m.result ? m.result.quest.mini : false };
}
function fixColorGoal(def) {
  /* 指定顏色：挑盤面上最多的顏色，目標 = 開局該色數量的 60%（至少 6） */
  const b = R.newQuestBoard(Object.assign({}, def, { goal: { type: 'clear' } }));
  const cnt = {};
  b.rows.forEach(row => row.forEach(v => { if (R.isBubble(v)) cnt[R.colorOf(v)] = (cnt[R.colorOf(v)] || 0) + 1; }));
  const top = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x] || x - y)[0];
  def.goal = { type: 'color', color: +top, n: Math.max(6, Math.round(cnt[top] * 0.6)) };
}
/* 好玩的長度：模擬出的過關發射數（ref）太短沒挑戰、太長要玩很久；超出範圍就逐步放寬設定重排 */
const REF_RANGE = { tutorial: [4, 45], normal: [8, 60] };
function ease(def, attempt, lv) {
  const cand = Object.assign({}, def, { goal: Object.assign({}, def.goal) });
  const cfgCols = R.DIFF[lv].cols;
  if (attempt >= 1) cand.seed = R.hash2(def.seed, attempt * 131) >>> 0;
  if (attempt >= 2) cand.cols = Math.max(8, cfgCols - (attempt >= 3 ? 3 : 2));
  if (attempt >= 3) cand.rows = Math.max(4, def.rows - 1);
  if (attempt >= 4 && cand.goal.type === 'clear' && !def.boss && def.no > 10) { cand.goal = { type: 'star' }; cand.stars = 4; }
  return cand;
}
/** 太短時加重目標（多要幾顆獎勵／星星／顏色） */
function harden(cand, steps) {
  const g = cand.goal;
  if (g.type === 'bonus') { cand.bonus += steps * 2; g.n += steps * 2; }
  else if (g.type === 'star') cand.stars = (cand.stars || 3) + steps;
  else if (g.type === 'color') g.n += steps * 4;
}
function calibrate(def, lv, li) {
  let best = null;
  const range = def.no <= 10 ? REF_RANGE.tutorial : REF_RANGE.normal;
  let harder = 0;
  for (let attempt = 0; attempt < 7; attempt++) {
    const cand = ease(def, Math.min(attempt, 4), lv);
    if (attempt === 5) cand.seed = R.hash2(def.seed, 7777) >>> 0;
    if (attempt === 6) cand.seed = R.hash2(def.seed, 8888) >>> 0;
    if (harder) harden(cand, harder);
    if (cand.goal.type === 'color') fixColorGoal(cand);
    const wins = [], all = [];
    for (let k = 0; k < TRIALS; k++) { const r = simOnce(cand, R.hash2(cand.seed, 900 + k), lv); all.push(r); if (r.win) wins.push(r.shots); }
    const ref = median(wins);
    const limit = lv === 'baby' ? 0 : Math.max(ref + 4, Math.ceil(ref * FACTOR[lv] * (def.boss ? 1.1 : 1)));
    const ok = lv === 'baby' ? wins.length : wins.filter(s => s <= limit).length;
    const rate = ok / TRIALS;
    const need = lv === 'baby' ? 0.6 : PASS_MIN[lv];
    cand.ref = ref; cand.shots = limit;
    const inRange = ref >= range[0] && ref <= range[1];
    const info = { rate, miniRate: all.filter(r => r.win && r.mini).length / TRIALS, attempt, ref, inRange };
    /* 分數：先看有沒有達到通關率與長度範圍，再看離範圍多遠 */
    const dist = ref < range[0] ? range[0] - ref : ref > range[1] ? ref - range[1] : 0;
    const score = (rate >= need ? 1000 : rate * 500) + (inRange ? 500 : -dist);
    if (!best || score > best.score) best = { def: cand, info, score };
    if (rate >= need && inRange && (def.no <= 3 || wins.length >= 2)) break;
    if (rate >= need && ref < range[0] && attempt >= 1 && attempt < 5) harder = Math.min(3, harder + 1);
  }
  return best;
}

function runLevel(lv) {
  const li = LEVELS.indexOf(lv);
  firstSeen = {};
  const plan = planLevel(lv, li);
  const out = [], report = [];
  const t0 = Date.now();
  plan.forEach(def => {
    const r = calibrate(def, lv, li);
    out.push(r.def); report.push(Object.assign({ no: def.no }, r.info));
    if (def.no % 10 === 0) process.stderr.write('[' + lv + '] ' + def.no + '/100  ' + Math.round((Date.now() - t0) / 1000) + 's\n');
  });
  return { levels: out, report };
}

function writeData(all) {
  const lines = LEVELS.map(lv => '  ' + JSON.stringify(lv) + ': [\n' + all[lv].map(d => '    ' + JSON.stringify(d)).join(',\n') + '\n  ]');
  const src = '/* 由 scripts/gen-quests.js 產生，不要手改。闖關模式四段難度各 100 關的關卡資料。 */\n' +
    '(function (root) {\n  var D = {\n  "v": 1,\n  "levels": {\n' + lines.join(',\n') + '\n  }\n  };\n' +
    '  root.QuestData = D;\n  if (typeof module !== \'undefined\' && module.exports) module.exports = D;\n})(typeof self !== \'undefined\' ? self : this);\n';
  fs.writeFileSync(OUT, src, 'utf8');
}

if (opt('--redo')) {
  /* --redo 難度:關號,關號 ：只重新校準指定關卡，寫回快取（之後再 --merge） */
  const [lv, nos] = opt('--redo').split(':');
  const li = LEVELS.indexOf(lv);
  firstSeen = {};
  const plan = planLevel(lv, li);
  const file = path.join(CACHE, lv + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  nos.split(',').map(Number).forEach(no => {
    const def = plan.find(d => d.no === no);
    if (opt('--salt')) def.seed = R.hash2(def.seed, Number(opt('--salt'))) >>> 0;
    const r = calibrate(def, lv, li);
    data.levels[no - 1] = r.def;
    console.log(lv + '-' + no, JSON.stringify(r.info), JSON.stringify(r.def.goal), r.def.bonus);
  });
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
} else if (flag('--merge')) {
  const all = {};
  LEVELS.forEach(lv => { all[lv] = JSON.parse(fs.readFileSync(path.join(CACHE, lv + '.json'), 'utf8')).levels; });
  writeData(all);
  console.log('已寫入 ' + OUT);
} else if (flag('--plan')) {
  const lv = opt('--plan');
  planLevel(lv, LEVELS.indexOf(lv)).forEach(d => console.log(d.no, d.layout, d.goal.type, 'colors', d.colors, 'rows', d.rows, d.hint || '', d.mini));
} else {
  fs.mkdirSync(CACHE, { recursive: true });
  const targets = opt('--level') ? [opt('--level')] : LEVELS;
  const all = {};
  targets.forEach(lv => {
    const r = runLevel(lv);
    all[lv] = r.levels;
    if (!QUICK) fs.writeFileSync(path.join(CACHE, lv + '.json'), JSON.stringify(r), 'utf8');
    const low = r.report.filter(x => x.rate < (lv === 'baby' ? 0.6 : PASS_MIN[lv]));
    console.log(lv + '：完成 ' + r.levels.length + ' 關；通關率不足的關卡 ' + low.length + ' 個' + (low.length ? '（' + low.map(x => x.no).join(',') + '）' : ''));
  });
  if (!opt('--level') && !QUICK) writeData(all);
}
