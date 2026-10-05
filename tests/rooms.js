/* ===== tests/rooms.js — 房間生命週期、邀請、席位權限、權威對局（不開網路，用假時鐘） ===== */
'use strict';
const assert = require('assert');
const { createHub, cleanName, DRAGONS } = require('../lib/rooms.js');
const MatchSnap = require('../public/js/matchsnap.js');
const Match = require('../public/js/match.js');
const Rules = require('../public/js/rules.js');

let passed = 0;
const failed = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed.push(name); console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); }
}

function setup() {
  let t = 1000;
  const inbox = new Map();
  const rng = Rules.mulberry32(8);   /* 固定亂數：房間代碼、種子、版型都可重現，測試不會時好時壞 */
  const hub = createHub({
    now: () => t, random: rng,
    emit(key, msg) { if (!inbox.has(key)) inbox.set(key, []); inbox.get(key).push(msg); }
  });
  const api = {
    hub, inbox,
    advance(ms) { t += ms; hub.tick(); },
    run(ms) { for (let n = 0; n < ms; n += 20) { t += 20; hub.tick(); } },
    get now() { return t; },
    join(key, name, dragon) { hub.connect(key, { name: name || key, dragon: dragon || 'rainbow' }); return key; },
    last(key, type) { const l = (inbox.get(key) || []).filter(m => m.type === type); return l[l.length - 1]; },
    all(key, type) { return (inbox.get(key) || []).filter(m => m.type === type); },
    clear() { inbox.clear(); },
    send(key, msg) { hub.handle(key, msg); },
    room(key) { const m = api.last(key, 'room'); return m ? m.room : null; }
  };
  return api;
}
/** 兩人房：A 房主、B 已準備 */
function twoPlayers(patch, keepRandom) {
  const x = setup(); x.join('aaaaaaaa1', 'A'); x.join('bbbbbbbb2', 'B');
  x.send('aaaaaaaa1', { type: 'create', name: 'A', roomName: '測試房' });
  const id = x.room('aaaaaaaa1').id;
  x.send('bbbbbbbb2', { type: 'join', room: id, name: 'B', dragon: 'cloud' });
  /* 隨機版型約 8% 一發直射就能全清（見 README 的已知問題），對局測試固定用 checker 讓結果穩定 */
  x.send('aaaaaaaa1', { type: 'settings', patch: Object.assign(keepRandom ? {} : { layout: 'checker' }, patch || {}) });
  x.send('bbbbbbbb2', { type: 'ready', value: true });
  return { x, id };
}
function startIt(x) { x.send('aaaaaaaa1', { type: 'start' }); }

console.log('\n暱稱與聊天消毒');
test('暱稱去掉控制字元與 HTML 符號、限制 10 個字', () => {
  assert.strictEqual(cleanName('<b>小明</b>\n'), 'b小明/b');
  assert.strictEqual(cleanName('一二三四五六七八九十十一'), '一二三四五六七八九十');
  assert.strictEqual(cleanName('   ', '預設'), '預設');
});

console.log('\n建立／加入／席位／設定');
test('建立房間：預設設定、房主、大廳列表', () => {
  const x = setup(); x.join('aaaaaaaa1', 'A'); x.join('bbbbbbbb2', 'B');
  x.send('aaaaaaaa1', { type: 'create', name: 'A', dragon: 'sun', roomName: '測試房' });
  const v = x.room('aaaaaaaa1');
  assert(v.you.host && v.you.role === 'player' && v.name === '測試房' && v.phase === 'room');
  assert.deepStrictEqual(v.settings, { mode: 'race', level: 'easy', layout: 'random', theme: 'random', duration: 180000, publicRoom: true, allowSpectators: true });
  assert.strictEqual(v.max, 4);
  assert.strictEqual(v.seats[0].dragon, 'sun');
  x.advance(20);
  assert(x.last('bbbbbbbb2', 'rooms').rooms.some(r => r.name === '測試房'));
});
test('龍不會重複：搶到同一隻會自動換', () => {
  const { x } = twoPlayers();
  const v = x.room('aaaaaaaa1');
  assert.notStrictEqual(v.seats[0].dragon, v.seats[1].dragon);
  x.join('cccccccc3', 'C', 'rainbow'); x.send('cccccccc3', { type: 'join', room: v.id, dragon: 'rainbow' });
  const d = x.room('aaaaaaaa1').seats.filter(s => s.kind === 'human').map(s => s.dragon);
  assert.strictEqual(new Set(d).size, 3);
  d.forEach(id => assert(DRAGONS.includes(id)));
});
test('設定驗證：非法值被忽略、合法值生效、非房主無效', () => {
  const { x } = twoPlayers(null, true);
  x.send('aaaaaaaa1', { type: 'settings', patch: { mode: 'duel', level: 'hard', duration: 300000, theme: 3, layout: 'nope', publicRoom: false, allowSpectators: false } });
  let s = x.room('aaaaaaaa1').settings;
  assert.strictEqual(s.mode, 'duel'); assert.strictEqual(s.level, 'hard'); assert.strictEqual(s.duration, 300000);
  assert.strictEqual(s.theme, 3); assert.strictEqual(s.layout, 'random'); assert.strictEqual(s.publicRoom, false); assert.strictEqual(s.allowSpectators, false);
  x.send('aaaaaaaa1', { type: 'settings', patch: { mode: 'x', level: 'god', duration: 1234, theme: 9, layout: 'random' } });
  s = x.room('aaaaaaaa1').settings;
  assert.strictEqual(s.mode, 'duel'); assert.strictEqual(s.level, 'hard'); assert.strictEqual(s.duration, 300000); assert.strictEqual(s.theme, 3);
  x.send('aaaaaaaa1', { type: 'settings', patch: { theme: 'random' } });
  assert.strictEqual(x.room('aaaaaaaa1').settings.theme, 'random');
  x.send('bbbbbbbb2', { type: 'settings', patch: { mode: 'race' } });
  assert.strictEqual(x.room('aaaaaaaa1').settings.mode, 'duel');
  const L = require('../public/js/layouts.js').list()[3].id;
  x.send('aaaaaaaa1', { type: 'settings', patch: { layout: L } });
  assert.strictEqual(x.room('aaaaaaaa1').settings.layout, L);
});
test('maxPlayers 2..4，低於目前人數被拒，改設定會清掉準備', () => {
  const { x } = twoPlayers();
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 2 } });
  assert.strictEqual(x.room('aaaaaaaa1').max, 2);
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].ready, false);
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 9 } });
  assert.strictEqual(x.room('aaaaaaaa1').max, 4);
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 1 } });
  assert.strictEqual(x.room('aaaaaaaa1').max, 2);
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 4 } });
  x.join('cccccccc3', 'C'); x.send('cccccccc3', { type: 'join', room: x.room('aaaaaaaa1').id });
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 2 } });
  assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'max');
  assert.strictEqual(x.room('aaaaaaaa1').max, 4);
});
test('座位滿了：玩家加入變成觀戰；第 5 個人只能觀戰', () => {
  const { x, id } = twoPlayers();
  for (const k of ['cccccccc3', 'dddddddd4', 'eeeeeeee5']) { x.join(k); x.send(k, { type: 'join', room: id }); }
  assert.strictEqual(x.room('eeeeeeee5').you.role, 'spectator');
  assert.strictEqual(x.room('cccccccc3').you.role, 'player');
});
test('觀戰上限 20，第 21 位被拒；不開放觀戰時拒絕', () => {
  const { x, id } = twoPlayers();
  for (let i = 0; i < 20; i++) { const k = 'spectator' + String(i).padStart(2, '0'); x.join(k); x.send(k, { type: 'join', room: id, as: 'spectator' }); }
  assert.strictEqual(x.room('aaaaaaaa1').spectators.length, 20);
  x.join('overflow1'); x.send('overflow1', { type: 'join', room: id, as: 'spectator' });
  assert.strictEqual(x.last('overflow1', 'error').code, 'spec_full');
  assert(!x.room('overflow1'));
  const y = twoPlayers().x; const yid = y.room('aaaaaaaa1').id;
  y.send('aaaaaaaa1', { type: 'settings', patch: { allowSpectators: false } });
  y.join('spec00001'); y.send('spec00001', { type: 'join', room: yid, as: 'spectator' });
  assert.strictEqual(y.last('spec00001', 'error').code, 'spec_off');
});
test('非公開房間不在大廳列表，也不會被快速加入配到；但輸入代碼能進', () => {
  const x = setup(); x.join('aaaaaaaa1'); x.join('bbbbbbbb2');
  x.send('aaaaaaaa1', { type: 'create', name: 'A' });
  const id = x.room('aaaaaaaa1').id;
  x.send('aaaaaaaa1', { type: 'settings', patch: { publicRoom: false } });
  assert.strictEqual(x.hub.listRooms().length, 0);
  x.send('bbbbbbbb2', { type: 'quick' });
  assert.notStrictEqual(x.room('bbbbbbbb2').id, id);
  x.join('cccccccc3'); x.send('cccccccc3', { type: 'join', room: id });
  assert.strictEqual(x.room('cccccccc3').id, id);
});
test('觀戰者可以 sit 入座；玩家可以 watch 離席（房主不行）', () => {
  const { x, id } = twoPlayers();
  x.join('cccccccc3'); x.send('cccccccc3', { type: 'join', room: id, as: 'spectator' });
  x.send('cccccccc3', { type: 'sit' });
  assert.strictEqual(x.room('cccccccc3').you.role, 'player');
  x.send('cccccccc3', { type: 'watch' });
  assert.strictEqual(x.room('cccccccc3').you.role, 'spectator');
  x.send('aaaaaaaa1', { type: 'watch' });
  assert.strictEqual(x.room('aaaaaaaa1').you.role, 'player');
});

console.log('\n邀請');
test('邀請 token 決定角色；撤銷後失效；非房主不能產生', () => {
  const { x, id } = twoPlayers();
  x.send('bbbbbbbb2', { type: 'invite', role: 'player' });
  assert(!x.last('bbbbbbbb2', 'invite'));
  x.send('aaaaaaaa1', { type: 'invite', role: 'spectator' }); x.send('aaaaaaaa1', { type: 'invite', role: 'player' });
  const [sTok, pTok] = x.all('aaaaaaaa1', 'invite').map(m => m.token);
  x.join('cccccccc3'); x.join('dddddddd4');
  x.send('cccccccc3', { type: 'inviteInfo', room: id, token: sTok });
  assert(x.last('cccccccc3', 'inviteInfo').ok && !x.room('cccccccc3'));
  x.send('cccccccc3', { type: 'join', room: id, token: sTok, as: 'player' });
  assert.strictEqual(x.room('cccccccc3').you.role, 'spectator');
  x.send('dddddddd4', { type: 'join', room: id, token: pTok });
  assert.strictEqual(x.room('dddddddd4').you.role, 'player');
  x.send('aaaaaaaa1', { type: 'revoke' });
  x.join('eeeeeeee5'); x.send('eeeeeeee5', { type: 'join', room: id, token: pTok });
  assert.strictEqual(x.last('eeeeeeee5', 'joinFailed').reason, 'revoked');
  x.send('eeeeeeee5', { type: 'inviteInfo', room: id, token: pTok });
  assert.strictEqual(x.last('eeeeeeee5', 'inviteInfo').reason, 'revoked');
});
test('邀請 24 小時後過期', () => {
  const { x, id } = twoPlayers();
  x.send('aaaaaaaa1', { type: 'invite', role: 'player' });
  const tok = x.last('aaaaaaaa1', 'invite').token;
  x.advance(24 * 3600 * 1000 + 1000);
  x.join('cccccccc3'); x.send('cccccccc3', { type: 'join', room: id, token: tok });
  assert.strictEqual(x.last('cccccccc3', 'joinFailed').reason, 'expired');
});
test('假 token／不存在的房間回 invalid', () => {
  const { x, id } = twoPlayers();
  x.join('cccccccc3');
  x.send('cccccccc3', { type: 'join', room: id, token: 'zzz' });
  assert.strictEqual(x.last('cccccccc3', 'joinFailed').reason, 'invalid');
  x.send('cccccccc3', { type: 'join', room: 'ZZZZ' });
  assert.strictEqual(x.last('cccccccc3', 'joinFailed').reason, 'invalid');
});

console.log('\n踢人／斷線寬限／零真人自動關閉');
test('踢人：被踢者收到 kicked、不能再進來，房間繼續', () => {
  const { x, id } = twoPlayers();
  x.send('bbbbbbbb2', { type: 'kick', seat: 0 });
  assert(x.room('aaaaaaaa1').seats[1].kind === 'human', '非房主踢不動');
  x.send('aaaaaaaa1', { type: 'kick', seat: 1 });
  assert(x.last('bbbbbbbb2', 'kicked'));
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].kind, 'empty');
  x.send('bbbbbbbb2', { type: 'join', room: id });
  assert.strictEqual(x.last('bbbbbbbb2', 'error').code, 'banned');
});
test('斷線 30 秒內重連保留席位，超過就離場', () => {
  const { x } = twoPlayers();
  x.hub.disconnect('bbbbbbbb2');
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].connected, false);
  x.advance(29000);
  x.hub.connect('bbbbbbbb2', { name: 'B' });
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].connected, true);
  assert(x.last('bbbbbbbb2', 'welcome').room, '重連的 welcome 帶房間');
  x.hub.disconnect('bbbbbbbb2');
  x.advance(31000);
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].kind, 'empty');
});
test('房主離開 → 下一位真人接任房主', () => {
  const { x } = twoPlayers();
  x.send('aaaaaaaa1', { type: 'leave' });
  const v = x.room('bbbbbbbb2');
  assert(v.you.host && v.hostSeat === v.you.seat);
});
test('真人降到 0：房間立刻關閉、邀請失效、觀戰者收到 closed、不可復活', () => {
  const { x, id } = twoPlayers();
  x.send('aaaaaaaa1', { type: 'invite', role: 'player' });
  const tok = x.last('aaaaaaaa1', 'invite').token;
  x.join('spectat01'); x.send('spectat01', { type: 'join', room: id, as: 'spectator' });
  x.send('aaaaaaaa1', { type: 'leave' });
  assert.strictEqual(x.hub._rooms.size, 1);
  x.send('bbbbbbbb2', { type: 'leave' });
  assert.strictEqual(x.hub._rooms.size, 0);
  assert(x.last('spectat01', 'closed'));
  assert.strictEqual(x.room('spectat01'), null);
  x.join('cccccccc3'); x.send('cccccccc3', { type: 'join', room: id, token: tok });
  assert.strictEqual(x.last('cccccccc3', 'joinFailed').reason, 'closed');
  x.hub.disconnect('spectat01'); x.hub.connect('spectat01', { name: 's' });
  assert.strictEqual(x.last('spectat01', 'welcome').room, null, '重連不能復活已關閉的房間');
});
test('只剩觀戰者不算有人：最後一位玩家斷線超時 → 房間關閉', () => {
  const { x, id } = twoPlayers();
  x.join('spectat01'); x.send('spectat01', { type: 'join', room: id, as: 'spectator' });
  x.send('aaaaaaaa1', { type: 'leave' });
  x.hub.disconnect('bbbbbbbb2');
  x.advance(31000);
  assert.strictEqual(x.hub._rooms.size, 0);
  assert(x.last('spectat01', 'closed'));
});

console.log('\n開始條件');
test('開始：非房主、人數不足、有人沒準備都不行', () => {
  const x = setup(); x.join('aaaaaaaa1'); x.join('bbbbbbbb2');
  x.send('aaaaaaaa1', { type: 'create', name: 'A' });
  startIt(x); assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'few');
  x.send('bbbbbbbb2', { type: 'join', room: x.room('aaaaaaaa1').id });
  x.send('bbbbbbbb2', { type: 'start' }); assert.strictEqual(x.room('aaaaaaaa1').phase, 'room');
  startIt(x); assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'notready');
  assert.strictEqual(x.room('aaaaaaaa1').canStart, false);
  x.send('bbbbbbbb2', { type: 'ready', value: true });
  assert.strictEqual(x.room('aaaaaaaa1').canStart, true);
  startIt(x); assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
});
test('對戰模式至少 2 人：雙人才能開 duel', () => {
  const { x } = twoPlayers({ mode: 'duel' });
  startIt(x);
  assert.strictEqual(x.last('aaaaaaaa1', 'start').cfg.mode, 'duel');
});

console.log('\n對局流程');
test('start：cfg、slot、t0Wall、goIn；觀戰者 slot=-1；倒數期間不收輸入', () => {
  const { x, id } = twoPlayers({ level: 'normal', duration: 120000, theme: 2, layout: 'random' });
  x.join('spectat01'); x.send('spectat01', { type: 'join', room: id, as: 'spectator' });
  const t = x.now;
  startIt(x);
  const a = x.last('aaaaaaaa1', 'start'), b = x.last('bbbbbbbb2', 'start'), s = x.last('spectat01', 'start');
  assert.strictEqual(a.slot, 0); assert.strictEqual(b.slot, 1); assert.strictEqual(s.slot, -1);
  assert.strictEqual(a.t0Wall, t + 3000); assert.strictEqual(a.goIn, 3000);
  assert.deepStrictEqual(a.cfg, b.cfg);
  assert.strictEqual(a.cfg.level, 'normal'); assert.strictEqual(a.cfg.themeId, 2); assert.strictEqual(a.cfg.duration, 120000);
  assert.strictEqual(a.cfg.layoutId, 'random'); assert(Number.isInteger(a.cfg.seed));
  assert.deepStrictEqual(a.cfg.players.map(p => p.name), ['A', 'B']);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
  x.run(1000);
  x.send('aaaaaaaa1', { type: 'shot', a: 9000 });
  assert.strictEqual(x.all('bbbbbbbb2', 'ev').length, 0);
  assert.strictEqual(x.hub.counters.inputEarly, 1);
  x.run(2100);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'playing');
});
test('theme=random 會在開局時決定成 0..5 的整數', () => {
  const { x } = twoPlayers();
  startIt(x);
  const th = x.last('aaaaaaaa1', 'start').cfg.themeId;
  assert(Number.isInteger(th) && th >= 0 && th <= 5);
});

function playing() {
  const r = twoPlayers({ mode: 'duel', level: 'normal' });
  r.x.join('spectat01'); r.x.send('spectat01', { type: 'join', room: r.id, as: 'spectator' });
  startIt(r.x); r.x.run(3100);
  r.x.clear();
  return r;
}
test('發射：所有人（含觀戰者）收到同一份 ev，事件含 s/a/t；mt 為對局時間', () => {
  const { x } = playing();
  x.send('aaaaaaaa1', { type: 'shot', a: 9000 });
  const ea = x.all('aaaaaaaa1', 'ev'), eb = x.all('bbbbbbbb2', 'ev'), es = x.all('spectat01', 'ev');
  assert.strictEqual(ea.length, 1);
  assert.deepStrictEqual(ea, eb); assert.deepStrictEqual(ea, es);
  assert.strictEqual(ea[0].evs[0].e, 'shot'); assert.strictEqual(ea[0].evs[0].s, 0); assert.strictEqual(ea[0].evs[0].a, 9000);
  assert(ea[0].mt >= 0 && ea[0].mt < 500);
});
test('發射冷卻 250 ms：太快的丟棄且不回錯誤；swap 可用；觀戰者的輸入被忽略', () => {
  const { x } = playing();
  x.send('aaaaaaaa1', { type: 'shot', a: 9000 });
  x.advance(100);
  x.send('aaaaaaaa1', { type: 'shot', a: 9100 });
  assert.strictEqual(x.all('bbbbbbbb2', 'ev').filter(m => m.evs.some(e => e.e === 'shot')).length, 1);
  assert.strictEqual(x.hub.counters.shotsDropped, 1);
  x.advance(200);
  x.send('aaaaaaaa1', { type: 'shot', a: 9100 });
  assert.strictEqual(x.all('bbbbbbbb2', 'ev').filter(m => m.evs.some(e => e.e === 'shot')).length, 2);
  x.send('bbbbbbbb2', { type: 'swap' });
  assert(x.all('aaaaaaaa1', 'ev').some(m => m.evs.some(e => e.e === 'swap' && e.s === 1)));
  const n = x.all('aaaaaaaa1', 'ev').length;
  x.send('spectat01', { type: 'shot', a: 9000 }); x.send('spectat01', { type: 'swap' });
  assert.strictEqual(x.all('aaaaaaaa1', 'ev').length, n);
  x.send('aaaaaaaa1', { type: 'shot', a: 'abc' });
  assert.strictEqual(x.all('aaaaaaaa1', 'ev').length, n);
});
test('伺服器的對局與「只重播 ev 的客戶端」逐位元一致，且 hash 訊息對得上', () => {
  const { x } = playing();
  const g = [...x.hub._rooms.values()][0].match;
  const client = Match.create(g.cfg);
  let shots = 0;
  for (let i = 0; i < 40; i++) {
    x.send(i % 2 ? 'aaaaaaaa1' : 'bbbbbbbb2', { type: 'shot', a: 3000 + (i * 977) % 12000 });
    x.run(300); shots++;
  }
  for (const msg of x.all('aaaaaaaa1', 'ev')) for (const ev of msg.evs) Match.apply(client, ev);
  assert.deepStrictEqual(client.boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
  assert.strictEqual(client.seq, g.m.seq);
  const hs = x.all('aaaaaaaa1', 'hash'); assert(hs.length >= 3);
  assert(x.all('aaaaaaaa1', 'clock').length >= 3);
  assert.strictEqual(hs[0].h.length, 2);
});
test('resync → sync{snap}；還原後再套同樣的後續事件，雜湊仍一致', () => {
  const { x } = playing();
  for (let i = 0; i < 12; i++) { x.send(i % 2 ? 'aaaaaaaa1' : 'bbbbbbbb2', { type: 'shot', a: 4000 + i * 800 }); x.run(300); }
  x.clear();
  x.send('bbbbbbbb2', { type: 'resync' });
  const sync = x.last('bbbbbbbb2', 'sync');
  assert(sync && sync.snap && typeof sync.mt === 'number');
  const restored = MatchSnap.restoreAll(sync.snap);
  const g = [...x.hub._rooms.values()][0].match;
  assert.deepStrictEqual(restored.boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
  x.clear();
  for (let i = 0; i < 10; i++) { x.send(i % 2 ? 'aaaaaaaa1' : 'bbbbbbbb2', { type: 'shot', a: 5000 + i * 700 }); x.run(300); }
  for (const msg of x.all('aaaaaaaa1', 'ev')) for (const ev of msg.evs) Match.apply(restored, ev);
  assert.deepStrictEqual(restored.boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
  assert.strictEqual(restored.seq, g.m.seq);
});
test('中途加入的觀戰者收到 start ＋ sync；斷線重連的玩家也是', () => {
  const { x, id } = playing();
  for (let i = 0; i < 6; i++) { x.send('aaaaaaaa1', { type: 'shot', a: 5000 + i * 900 }); x.run(300); }
  x.join('late00001'); x.send('late00001', { type: 'join', room: id, as: 'spectator' });
  assert.strictEqual(x.last('late00001', 'start').slot, -1);
  assert(x.last('late00001', 'sync'));
  x.join('late00002'); x.send('late00002', { type: 'join', room: id });
  assert.strictEqual(x.room('late00002').you.role, 'spectator', '對局中想當玩家 → 變觀戰');
  x.hub.disconnect('bbbbbbbb2'); x.clear();
  x.hub.connect('bbbbbbbb2', { name: 'B' });
  assert.strictEqual(x.last('bbbbbbbb2', 'start').slot, 1);
  const g = [...x.hub._rooms.values()][0].match;
  assert.deepStrictEqual(MatchSnap.restoreAll(x.last('bbbbbbbb2', 'sync').snap).boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
});
test('時間到：最後一批 ev 含 end，之後 result；約 0.5 秒後回到房間、準備清除、房主不變', () => {
  const r = twoPlayers({ duration: 120000 });
  const { x } = r;
  startIt(x); x.run(3100);
  x.send('aaaaaaaa1', { type: 'shot', a: 9000 });
  x.clear();
  x.run(121000);
  const evs = x.all('bbbbbbbb2', 'ev').flatMap(m => m.evs);
  assert(evs.some(e => e.e === 'end'));
  const res = x.last('bbbbbbbb2', 'result');
  assert(res && res.result.reason === 'time' && res.result.ranks.length === 2);
  const order = (x.inbox.get('bbbbbbbb2') || []).map(m => m.type);
  assert(order.lastIndexOf('ev') < order.indexOf('result'), 'result 在最後一批 ev 之後');
  const v = x.room('aaaaaaaa1');
  assert.strictEqual(v.phase, 'room'); assert(v.you.host); assert(v.seats.every(s => !s.ready));
  x.send('aaaaaaaa1', { type: 'shot', a: 9000 });   /* 對局已結束，忽略 */
});
test('結束後輸入被忽略；rematch：非房主自動準備好', () => {
  const { x } = twoPlayers({ duration: 120000 });
  startIt(x); x.run(3100);
  x.run(120200);
  x.send('bbbbbbbb2', { type: 'rematch' });   /* 還在 0.5 秒收尾內也要算 */
  x.run(1000);
  const v = x.room('aaaaaaaa1');
  assert.strictEqual(v.phase, 'room');
  x.send('bbbbbbbb2', { type: 'rematch' });
  assert.strictEqual(x.room('aaaaaaaa1').seats[1].ready, true);
  assert.strictEqual(x.room('aaaaaaaa1').canStart, true);
  startIt(x);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
});
test('再來一局：房主與其他真人都按了 → 直接開下一局；只有房主按則等對方準備好', () => {
  const { x } = twoPlayers({ duration: 120000 });
  startIt(x); x.run(3100); x.run(120200);
  x.send('aaaaaaaa1', { type: 'rematch' });   /* 房主先按 */
  x.run(1000);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'room', 'B 還沒按，先等');
  x.send('bbbbbbbb2', { type: 'rematch' });
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown', 'B 也按了 → 直接開始');
  /* 第二局結束：B 先按、房主後按 */
  x.run(3100); x.run(120200); x.send('bbbbbbbb2', { type: 'rematch' }); x.run(1000);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'room');
  x.send('aaaaaaaa1', { type: 'rematch' });
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
});
test('玩家中途離開：left{slot} ＋ Match.playerLeft；其他人繼續；全部離開 → 房間關閉', () => {
  const { x } = playing();
  x.send('bbbbbbbb2', { type: 'leave' });
  const l = x.last('aaaaaaaa1', 'left');
  assert(l && l.slot === 1);
  const g = [...x.hub._rooms.values()][0].match;
  assert.strictEqual(g.m.left[1], true); assert.strictEqual(g.m.over, false);
  x.send('bbbbbbbb2', { type: 'shot', a: 9000 });
  x.send('aaaaaaaa1', { type: 'leave' });
  assert.strictEqual(x.hub._rooms.size, 0);
  assert(x.last('spectat01', 'closed'));
});
test('玩家中途斷線超過 30 秒 → 判定離場；被踢同理', () => {
  const { x } = playing();
  x.hub.disconnect('bbbbbbbb2');
  x.run(31000);
  assert(x.all('aaaaaaaa1', 'left').some(m => m.slot === 1));
  const y = playing().x;
  y.send('aaaaaaaa1', { type: 'kick', seat: 1 });
  assert(y.last('aaaaaaaa1', 'left').slot === 1);
});
test('三人對局：一人離開、另兩人仍繼續（沒有提早結束）', () => {
  const { x, id } = twoPlayers({ mode: 'duel' });
  x.join('cccccccc3', 'C'); x.send('cccccccc3', { type: 'join', room: id }); x.send('cccccccc3', { type: 'ready', value: true });
  startIt(x); x.run(3100);
  assert.strictEqual(x.last('cccccccc3', 'start').slot, 2);
  x.send('cccccccc3', { type: 'leave' });
  const g = [...x.hub._rooms.values()][0].match;
  assert(!g.m.over && g.m.left[2]);
});

console.log('\n電腦席位（單機與線上共用 ai.js）');
/** 房主 A 單人開房，加 n 個電腦（levels 指定） */
function soloRoom(levels, patch) {
  const x = setup(); x.join('aaaaaaaa1', 'A');
  x.send('aaaaaaaa1', { type: 'create', name: 'A', roomName: 'AI房' });
  const id = x.room('aaaaaaaa1').id;
  x.send('aaaaaaaa1', { type: 'settings', patch: Object.assign({ layout: 'checker', level: 'hard', duration: 120000 }, patch || {}) });
  (levels || []).forEach(l => x.send('aaaaaaaa1', { type: 'addAI', level: l }));
  return { x, id };
}
const aiSlots = v => v.seats.filter(s => s.kind === 'ai');
const shotsOf = (x, key, slot) => x.all(key, 'ev').flatMap(m => m.evs).filter(e => e.e === 'shot' && (slot == null || e.s === slot));
const roomOf = x => [...x.hub._rooms.values()][0];

test('房主加入／換等級／移除電腦；非房主與對局中無效；名稱像單機「花花・電腦」、龍不重複', () => {
  const { x, id } = soloRoom();
  x.join('bbbbbbbb2', 'B', 'cloud'); x.send('bbbbbbbb2', { type: 'join', room: id, dragon: 'cloud' });
  x.send('bbbbbbbb2', { type: 'addAI', level: 'hard' });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 0, '非房主不能加');
  x.send('aaaaaaaa1', { type: 'addAI', level: 'hard' });
  x.send('aaaaaaaa1', { type: 'addAI', level: 'nope' });
  x.send('aaaaaaaa1', { type: 'addAI' });
  const v = x.room('aaaaaaaa1');
  const ais = aiSlots(v);
  assert.strictEqual(ais.length, 2);
  assert.deepStrictEqual(ais.map(s => s.aiLevel), ['hard', 'easy'], '非法等級／沒給等級 → easy');
  assert(ais.every(s => /・電腦$/.test(s.name) && s.ready && s.connected && s.pid === null && s.kind === 'ai'));
  assert.strictEqual(new Set(v.seats.map(s => s.dragon)).size, 4, '四個席位的龍都不同');
  assert.strictEqual(v.humans, 2); assert.strictEqual(v.ais, 2);
  x.send('bbbbbbbb2', { type: 'setAI', seat: ais[0].i, level: 'baby' });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1'))[0].aiLevel, 'hard', '非房主不能改等級');
  x.send('aaaaaaaa1', { type: 'setAI', seat: ais[0].i, level: 'baby' });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1'))[0].aiLevel, 'baby');
  x.send('aaaaaaaa1', { type: 'setAI', seat: ais[0].i, level: 'god' });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1'))[0].aiLevel, 'baby');
  x.send('aaaaaaaa1', { type: 'setAI', seat: 0, level: 'hard' });   /* 真人席位不是電腦 */
  assert.strictEqual(x.room('aaaaaaaa1').seats[0].kind, 'human');
  x.send('bbbbbbbb2', { type: 'removeAI', seat: ais[0].i });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 2);
  x.send('aaaaaaaa1', { type: 'removeAI', seat: 0 });            /* 不能用 removeAI 踢真人／自己 */
  assert.strictEqual(x.room('aaaaaaaa1').seats[0].kind, 'human');
  x.send('aaaaaaaa1', { type: 'removeAI', seat: ais[0].i });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 1);
  assert.strictEqual(x.room('aaaaaaaa1').seats[ais[0].i].kind, 'empty');
  x.send('aaaaaaaa1', { type: 'kick', seat: aiSlots(x.room('aaaaaaaa1'))[0].i });   /* kick 只對真人 */
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 1);
});
test('席位上限 4：真人＋電腦合計；滿了 addAI 回 full、邀請／加入者變觀戰；移除電腦後可入座', () => {
  const { x, id } = soloRoom(['easy', 'easy']);
  x.join('bbbbbbbb2', 'B'); x.send('bbbbbbbb2', { type: 'join', room: id });
  assert.strictEqual(x.room('bbbbbbbb2').you.role, 'player');
  x.send('aaaaaaaa1', { type: 'addAI', level: 'hard' });
  assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'full');
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 2);
  x.send('aaaaaaaa1', { type: 'invite', role: 'player' });
  const tok = x.last('aaaaaaaa1', 'invite').token;
  x.join('cccccccc3', 'C');
  x.send('cccccccc3', { type: 'inviteInfo', room: id, token: tok });
  const info = x.last('cccccccc3', 'inviteInfo');
  assert(info.full && info.willSpectate && info.players === 4);
  x.send('cccccccc3', { type: 'join', room: id, token: tok });
  assert.strictEqual(x.room('cccccccc3').you.role, 'spectator');
  x.send('cccccccc3', { type: 'sit' });
  assert.strictEqual(x.last('cccccccc3', 'error').code, 'full');
  x.send('aaaaaaaa1', { type: 'removeAI', seat: aiSlots(x.room('aaaaaaaa1'))[0].i });
  x.send('cccccccc3', { type: 'sit' });
  assert.strictEqual(x.room('cccccccc3').you.role, 'player');
  /* 大廳卡片：players 含電腦、humans／ais 分開 */
  x.advance(20);
  const card = x.hub.listRooms()[0];
  assert.strictEqual(card.players, 4); assert.strictEqual(card.humans, 3); assert.strictEqual(card.ais, 1); assert.strictEqual(card.joinable, false);
});
test('人數上限也算電腦：maxPlayers 不能低於「真人＋電腦」；max=2 時只能加 1 個電腦', () => {
  const { x } = soloRoom();
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 2 } });
  x.send('aaaaaaaa1', { type: 'addAI' }); x.send('aaaaaaaa1', { type: 'addAI' });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 1);
  assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'full');
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 4 } });
  x.send('aaaaaaaa1', { type: 'addAI' }); x.send('aaaaaaaa1', { type: 'addAI' });
  x.send('aaaaaaaa1', { type: 'settings', patch: { maxPlayers: 2 } });
  assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'max');
  assert.strictEqual(x.room('aaaaaaaa1').max, 4);
});
test('開始條件：1 真人 + 0 電腦不行；1 真人 + 1 電腦直接能開（電腦自動準備）；對局中不能加電腦', () => {
  const { x } = soloRoom();
  startIt(x); assert.strictEqual(x.last('aaaaaaaa1', 'error').code, 'few');
  x.send('aaaaaaaa1', { type: 'addAI', level: 'normal' });
  assert.strictEqual(x.room('aaaaaaaa1').canStart, true);
  startIt(x);
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
  x.send('aaaaaaaa1', { type: 'addAI' }); x.send('aaaaaaaa1', { type: 'removeAI', seat: 1 });
  assert.strictEqual(aiSlots(x.room('aaaaaaaa1')).length, 1);
});
test('start：cfg.players 帶 kind／aiLevel／名字，slot 依席位順序；電腦席位 view 帶 slot', () => {
  const { x } = soloRoom(['baby', 'hard']);
  startIt(x);
  const st = x.last('aaaaaaaa1', 'start');
  assert.strictEqual(st.slot, 0);
  assert.deepStrictEqual(st.cfg.players.map(p => p.kind), ['human', 'ai', 'ai']);
  assert.deepStrictEqual(st.cfg.players.map(p => p.aiLevel || null), [null, 'baby', 'hard']);
  assert(st.cfg.players.slice(1).every(p => /・電腦$/.test(p.name)));
  const v = x.room('aaaaaaaa1');
  assert.deepStrictEqual(v.seats.filter(s => s.kind !== 'empty').map(s => s.slot), [0, 1, 2]);
});
test('倒數中電腦不動；開打後電腦用 ev 射擊（s = 電腦 slot），客戶端重播的雜湊與 seq 都一致', () => {
  const { x } = soloRoom(['hard', 'hard'], { mode: 'duel' });
  startIt(x);
  x.run(2900);
  assert.strictEqual(x.all('aaaaaaaa1', 'ev').length, 0, '倒數期間不動');
  x.run(30000);
  const g = roomOf(x).match;
  const sh = shotsOf(x, 'aaaaaaaa1');
  assert(sh.some(e => e.s === 1) && sh.some(e => e.s === 2) && !sh.some(e => e.s === 0), '兩個電腦都有射、人類沒動');
  assert(x.hub.counters.shots >= 20);
  const client = Match.create(g.cfg);
  for (const msg of x.all('aaaaaaaa1', 'ev')) for (const ev of msg.evs) Match.apply(client, ev);
  assert.deepStrictEqual(client.boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
  assert.strictEqual(client.seq, g.m.seq);
  for (const h of x.all('aaaaaaaa1', 'hash')) assert.strictEqual(h.h.length, 3);
  /* 重連同步：snapshot 還原也一致，且保留 aiLevel */
  const re = MatchSnap.restoreAll(MatchSnap.snapshotAll(g.m));
  assert.deepStrictEqual(re.boards.map(Rules.boardHash), g.m.boards.map(Rules.boardHash));
  assert.deepStrictEqual(re.players.map(p => p.aiLevel), [null, 'hard', 'hard']);
});
test('電腦也守 SHOT_CD；難度有差：hard 比 baby 射得多；人類與電腦可同時輸入', () => {
  const a = soloRoom(['baby'], { duration: 300000 }), b = soloRoom(['hard'], { duration: 300000 });
  for (const r of [a, b]) { startIt(r.x); r.x.run(3000 + 40000); }
  const sa = shotsOf(a.x, 'aaaaaaaa1', 1), sb = shotsOf(b.x, 'aaaaaaaa1', 1);
  assert(sb.length > sa.length * 1.5, 'hard ' + sb.length + ' vs baby ' + sa.length);
  for (let i = 1; i < sb.length; i++) assert(sb[i].t - sb[i - 1].t >= 250, '電腦射擊間隔 < SHOT_CD');
  b.x.send('aaaaaaaa1', { type: 'shot', a: 9000 });
  assert(shotsOf(b.x, 'aaaaaaaa1', 0).length >= 1);
});
test('可重現：同樣的亂數與時間流程，電腦射出的事件序列完全相同', () => {
  const log = () => { const { x } = soloRoom(['hard', 'normal'], { mode: 'duel' }); startIt(x); x.run(25000); return JSON.stringify(x.all('aaaaaaaa1', 'ev').map(m => m.evs)); };
  const l1 = log();
  assert(l1.length > 100);
  assert.strictEqual(l1, log());
});
test('電腦的全清與時間到會正常結束：result 含電腦排名（kind:ai）；回房間後電腦席位保留、等級不變、再開一局', () => {
  const { x } = soloRoom(['easy', 'hard'], { duration: 120000 });
  startIt(x); x.run(3000 + 121000);
  const res = x.last('aaaaaaaa1', 'result');
  assert(res && res.result.ranks.length === 3);
  assert.strictEqual(res.result.ranks.filter(r => r.kind === 'ai').length, 2);
  assert.deepStrictEqual(res.result.ranks.filter(r => r.kind === 'ai').map(r => r.aiLevel).sort(), ['easy', 'hard']);
  x.run(1000);
  const v = x.room('aaaaaaaa1');
  assert.strictEqual(v.phase, 'room');
  assert.deepStrictEqual(aiSlots(v).map(s => s.aiLevel), ['easy', 'hard']);
  assert(aiSlots(v).every(s => s.ready), '電腦席位自動準備好');
  assert.strictEqual(v.canStart, true);
  x.clear();
  x.send('aaaaaaaa1', { type: 'rematch' });   /* 房主按再來一局、沒有其他真人 → 直接開下一局 */
  assert.strictEqual(x.room('aaaaaaaa1').phase, 'countdown');
  assert.strictEqual(x.last('aaaaaaaa1', 'start').cfg.players.filter(p => p.kind === 'ai').length, 2);
  x.run(3000 + 5000);
  assert(shotsOf(x, 'aaaaaaaa1').some(e => e.s === 1 || e.s === 2), '第二局電腦照樣射');
});
test('房主離開（有電腦在）→ 房主交給下一位真人，不會交給電腦；踢人只對真人', () => {
  const { x, id } = soloRoom(['normal']);
  x.join('bbbbbbbb2', 'B'); x.send('bbbbbbbb2', { type: 'join', room: id });
  x.send('aaaaaaaa1', { type: 'leave' });
  const v = x.room('bbbbbbbb2');
  assert(v.you.host && v.seats[v.hostSeat].kind === 'human' && v.seats[v.hostSeat].pid === v.you.pid);
  assert.strictEqual(aiSlots(v).length, 1);
  assert.strictEqual(x.hub._rooms.size, 1, '還有真人，房間還在');
  x.send('bbbbbbbb2', { type: 'addAI' });   /* 新房主可以繼續加 */
  assert.strictEqual(aiSlots(x.room('bbbbbbbb2')).length, 2);
});
test('對局中房主離開：交棒給另一位真人，電腦繼續射；剩一位真人時對局不會提早結束', () => {
  const { x, id } = soloRoom(['hard'], { mode: 'duel' });
  x.join('bbbbbbbb2', 'B'); x.send('bbbbbbbb2', { type: 'join', room: id }); x.send('bbbbbbbb2', { type: 'ready', value: true });
  startIt(x); x.run(8000);
  x.send('aaaaaaaa1', { type: 'leave' });
  const g = roomOf(x).match;
  assert(g.m.left[0] && !g.m.over);
  assert(x.room('bbbbbbbb2').you.host);
  x.clear(); x.run(10000);
  assert(shotsOf(x, 'bbbbbbbb2', 1).length >= 3, '電腦（席位 1）在真人剩一位時仍在射擊');
  assert(!roomOf(x).match.m.over);
  /* 跑完時間：正常結束，排名含電腦 */
  x.run(120000);
  const res = x.last('bbbbbbbb2', 'result');
  assert(res && (res.result.reason === 'time' || res.result.reason === 'clear'), '正常結束（時間到或電腦全清），不是 left：' + (res && res.result.reason));
});
test('最後一位真人離開：房間立刻關閉、邀請失效、觀戰者收到 closed，之後完全沒有電腦事件', () => {
  const { x, id } = soloRoom(['hard', 'hard'], { mode: 'duel' });
  x.send('aaaaaaaa1', { type: 'invite', role: 'player' });
  const tok = x.last('aaaaaaaa1', 'invite').token;
  x.join('spectat01'); x.send('spectat01', { type: 'join', room: id, as: 'spectator' });
  startIt(x); x.run(3000 + 12000);
  assert(shotsOf(x, 'spectat01').length > 0);
  const shotsBefore = x.hub.counters.shots;
  x.send('aaaaaaaa1', { type: 'leave' });
  assert.strictEqual(x.hub._rooms.size, 0);
  assert(x.last('spectat01', 'closed'));
  assert.strictEqual(x.room('spectat01'), null);
  x.clear();
  x.run(30000);
  assert.strictEqual(x.hub.counters.shots, shotsBefore, '關房後電腦不再射擊');
  assert.strictEqual([...x.inbox.values()].flat().filter(m => m.type !== 'rooms').length, 0, '關房後沒有任何廣播（大廳列表更新除外）');
  x.join('cccccccc3'); x.send('cccccccc3', { type: 'join', room: id, token: tok });
  assert.strictEqual(x.last('cccccccc3', 'joinFailed').reason, 'closed');
});
test('唯一的真人斷線超時 → 房間關閉（電腦與觀戰者不算人），沒有殘留計時', () => {
  const { x, id } = soloRoom(['normal']);
  x.join('spectat01'); x.send('spectat01', { type: 'join', room: id, as: 'spectator' });
  startIt(x); x.run(6000);
  x.hub.disconnect('aaaaaaaa1');
  x.run(10000);
  assert.strictEqual(x.hub._rooms.size, 1, '30 秒寬限內房間還在、電腦繼續');
  x.run(25000);
  assert.strictEqual(x.hub._rooms.size, 0);
  assert(x.last('spectat01', 'closed'));
  const n = x.hub.counters.shots; x.clear(); x.run(20000);
  assert.strictEqual(x.hub.counters.shots, n); assert.strictEqual([...x.inbox.values()].flat().filter(m => m.type !== 'rooms').length, 0);
});
test('結束後電腦不再動（backToRoom 清掉 brain）；房間裡只有電腦也不會偷偷開局', () => {
  const { x } = soloRoom(['hard'], { duration: 120000 });
  startIt(x); x.run(3000 + 121000 + 1000);
  const n = x.hub.counters.shots; x.clear(); x.run(10000);
  assert.strictEqual(x.hub.counters.shots, n);
  assert.strictEqual(x.all('aaaaaaaa1', 'ev').length, 0);
  assert.strictEqual(x.hub.roomView([...x.hub._rooms.values()][0], 'aaaaaaaa1').phase, 'room');
});

console.log('\n在線人數');
test('stats 與 presence 格式', () => {
  const { x } = twoPlayers();
  x.join('lobby0001'); x.advance(20);
  const s = x.hub.stats();
  assert.deepStrictEqual(s, { online: 3, players: 2, spectators: 0, lobby: 1, rooms: 1 });
});

console.log('\nmatchsnap');
test('snapshotAll 是深拷貝且可 JSON 往返；restoreAll 結果與原對局一致', () => {
  const m = Match.create({ mode: 'duel', level: 'normal', seed: 12345, layoutId: 'random', themeId: 1, duration: 120000, players: [{ name: 'a', dragon: 'sun' }, { name: 'b', dragon: 'moon' }, { name: 'c', dragon: 'frost' }] });
  let t = 0;
  for (let i = 0; i < 60; i++) { t += 300; Match.input(m, i % 3, { t: i % 7 === 0 ? 'swap' : 'shot', a: 2000 + (i * 1237) % 14000 }, t); Match.tick(m, t); }
  const snap = MatchSnap.snapshotAll(m);
  const wire = JSON.parse(JSON.stringify(snap));
  assert.deepStrictEqual(wire, snap);
  const r = MatchSnap.restoreAll(wire);
  assert.deepStrictEqual(r.boards.map(Rules.boardHash), m.boards.map(Rules.boardHash));
  assert.strictEqual(r.seq, m.seq); assert.deepStrictEqual(r.pending, m.pending); assert.strictEqual(r.gid, m.gid);
  /* 同一串後續輸入，兩邊必須完全一致 */
  for (let i = 0; i < 40; i++) {
    t += 300;
    const inp = { t: 'shot', a: 3000 + (i * 911) % 12000 };
    const o1 = Match.input(m, i % 3, inp, t).concat(Match.tick(m, t)), o2 = Match.input(r, i % 3, inp, t).concat(Match.tick(r, t));
    assert.deepStrictEqual(o1.map(o => o.ev), o2.map(o => o.ev));
  }
  assert.deepStrictEqual(r.boards.map(Rules.boardHash), m.boards.map(Rules.boardHash));
  assert.deepStrictEqual(MatchSnap.snapshotAll(r), MatchSnap.snapshotAll(m));
  m.boards[0].rows[0][0] = 99;   /* 改原對局不影響 snap */
  assert.notStrictEqual(snap.boards[0].rows[0][0], 99);
});
test('結束後的對局（over/result）也能還原', () => {
  const m = Match.create({ mode: 'race', level: 'easy', seed: 7, layoutId: 'random', themeId: 0, duration: 1000, players: [{ name: 'a' }, { name: 'b' }] });
  Match.tick(m, 1500);
  assert(m.over);
  const r = MatchSnap.restoreAll(MatchSnap.snapshotAll(m));
  assert(r.over && r.result.reason === 'time');
  assert.deepStrictEqual(r.result, JSON.parse(JSON.stringify(m.result)));
});

console.log('\n' + (failed.length ? '失敗 ' + failed.length + ' 項：' + failed.join('、') : '全部通過') + '（通過 ' + passed + ' 項）');
process.exit(failed.length ? 1 : 0);

/* 房主可以把時間設成不限時（0），開局後 cfg.duration 為 0，時間到不會結束 */
t('線上也能選「不限時」：設定被接受並帶進 start.cfg', () => {
  const { x, id } = twoPlayers({ duration: 0 });
  assert.strictEqual(DURATIONS.indexOf(0) >= 0, true);
  const room = [...x.hub._rooms.values()].find(r => r.id === id);
  assert.strictEqual(room.settings.duration, 0);
});
