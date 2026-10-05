/* ===== lib/rooms.js — 房間、席位、觀戰、邀請、聊天、權威對局（純邏輯，不碰網路） =====
 *
 * 伺服器（server.js）只負責把 WebSocket 訊息丟進 hub.handle()，
 * hub 透過 emit(key, msg) 把回應送出去；所以整個房間流程可以不開網路直接測。
 *
 * 房間生命週期以「實體玩家」為準：
 *   - 至少一位真人坐在席位上才保留房間（觀戰者與電腦席位都不算真人）
 *   - 房主可以在等待室加入／移除電腦席位（共用單機的 public/js/ai.js），電腦自動準備好
 *   - 真人降到 0 → 立刻關閉：邀請失效、對局計時器停止、廣播 closed、從大廳移除
 *   - 已關閉的房間不會因為重新連線而復活
 *
 * 對局：伺服器是裁判，用 public/js/match.js 的 create／input／tick／playerLeft，
 *   把產生的事件依序廣播（ev），客戶端對自己的 Match 呼叫 apply() 就會逐位元一致。
 *   電腦：每個電腦席位在 r.match.ais 有一顆 brain（AI.createBrain，seed 與單機同一公式），
 *   由伺服器時鐘（stepMatch）呼叫 AI.think，決定後走和真人一模一樣的 applyInput（冷卻、事件、廣播）。
 *   時間 mt = 現在 - t0（t0 = 開始時間 + 3 秒倒數），mt < 0 為倒數中，不收輸入。
 */
'use strict';

const Rules = require('../public/js/rules.js');
const Match = require('../public/js/match.js');
const Layouts = require('../public/js/layouts.js');
const MatchSnap = require('../public/js/matchsnap.js');
const AI = require('../public/js/ai.js');

const DRAGONS = ['rainbow', 'cloud', 'candy', 'sun', 'moon', 'blossom', 'frost', 'forest'];
const DRAGON_NAMES = { rainbow: '彩虹龍', cloud: '雲朵龍', candy: '糖果龍', sun: '太陽龍', moon: '月亮龍', blossom: '花花龍', frost: '冰晶龍', forest: '森林龍' };
const ADJ = ['快樂', '勇敢', '調皮', '害羞', '閃亮', '軟綿綿', '圓滾滾', '機靈', '呆萌', '活潑'];
const MODES = ['race', 'duel'];
const LEVELS = ['baby', 'easy', 'normal', 'hard'];
const DURATIONS = [120000, 180000, 300000];
const THEME_COUNT = 7;
const LAYOUT_IDS = Layouts.list().map(l => l.id);
const GRACE_MS = 30000;          /* 斷線超過 30 秒直接判定離場 */
const SPEC_CAP = 20;
const MAX_CHAT = 60;
const MAX_SEATS = 4;
const CLOSED_KEEP_MS = 3600 * 1000;
const INVITE_MAX_MS = 24 * 3600 * 1000;
const GO_IN = 3000;              /* 按下開始到 mt=0 的倒數 */
const TICK_MS = 50;              /* 對局時間推進間隔 */
const CLOCK_MS = 2000;           /* clock／hash 廣播間隔 */
const SHOT_CD = 250;             /* 每個席位的發射冷卻 */
const SWAP_CD = 100;             /* 交換冷卻（防洗版） */
const END_HOLD = 500;            /* 對局結束後多久回到房間 */

function cleanName(raw, fallback) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, 10).join('');
  return s || fallback || '';
}
function cleanText(raw) {
  return Array.from(String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, MAX_CHAT).join('');
}
const inList = (v, list) => list.indexOf(v) >= 0;

function defaultSettings() {
  return { mode: 'race', level: 'easy', layout: 'random', theme: 'random', duration: 180000, publicRoom: true, allowSpectators: true };
}

function createHub(opt) {
  opt = opt || {};
  const now = opt.now || (() => Date.now());
  const emitOut = opt.emit || (() => {});
  const onRoomsChanged = opt.onRoomsChanged || (() => {});
  const rnd = opt.random || Math.random;

  const persons = new Map();     /* key → person */
  const byPid = new Map();       /* pid → person */
  const rooms = new Map();       /* id → room */
  const closed = new Map();      /* id → { reason, at } */
  const counters = { shots: 0, shotsDropped: 0, swaps: 0, inputEarly: 0, resyncs: 0, matches: 0 };
  let pidSeq = 1;
  let lobbyDirty = false;

  /* ---------- 工具 ---------- */
  const emit = (key, msg) => emitOut(key, msg);
  function randomName() { return ADJ[Math.floor(rnd() * ADJ.length)] + DRAGON_NAMES[DRAGONS[Math.floor(rnd() * DRAGONS.length)]]; }
  function token() { let t = ''; while (t.length < 12) t += Math.floor(rnd() * 36).toString(36); return t; }
  function roomId() {
    for (let i = 0; i < 50; i++) {
      let id = '';
      for (let k = 0; k < 4; k++) id += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rnd() * 24)];
      if (!rooms.has(id) && !closed.has(id)) return id;
    }
    return 'R' + Date.now().toString(36).slice(-3).toUpperCase();
  }
  function err(key, code, text) { emit(key, { type: 'error', code, text }); }
  function dirty() { lobbyDirty = true; }

  const humanSeats = r => r.seats.filter(s => s.kind === 'human');
  const filled = r => r.seats.filter(s => s.kind !== 'empty');
  const aiSeats = r => r.seats.filter(s => s.kind === 'ai');
  const seatOf = (r, key) => r.seats.findIndex(s => s.kind === 'human' && s.key === key);
  function members(r) {
    const out = humanSeats(r).map(s => s.key);
    for (const k of r.spectators) out.push(k);
    return out;
  }
  function broadcast(r, msg, except) {
    for (const k of members(r)) if (k !== except) emit(k, msg);
  }
  function takenDragons(r, exceptSeat) {
    const set = new Set();
    r.seats.forEach((s, i) => { if (s.kind !== 'empty' && i !== exceptSeat) set.add(s.dragon); });
    return set;
  }
  function freeDragon(r, want, exceptSeat) {
    const taken = takenDragons(r, exceptSeat);
    if (inList(want, DRAGONS) && !taken.has(want)) return want;
    const open = DRAGONS.filter(a => !taken.has(a));
    return open.length ? open[Math.floor(rnd() * open.length)] : DRAGONS[0];
  }

  /* ---------- 檢視 ---------- */
  function publicRoom(r) {
    return {
      id: r.id, name: r.name, phase: r.phase, max: r.maxPlayers,
      players: filled(r).length, humans: humanSeats(r).length, ais: aiSeats(r).length, spectators: r.spectators.length,
      host: r.seats[r.hostSeat] ? r.seats[r.hostSeat].name : '',
      settings: r.settings, full: filled(r).length >= r.maxPlayers,
      joinable: r.phase === 'room' && filled(r).length < r.maxPlayers
    };
  }
  function listRooms() {
    return Array.from(rooms.values()).filter(r => r.settings.publicRoom).sort((a, b) => b.createdAt - a.createdAt).map(publicRoom);
  }
  function roomView(r, key) {
    const mySeat = seatOf(r, key);
    const isHost = mySeat >= 0 && mySeat === r.hostSeat;
    const view = {
      id: r.id, name: r.name, phase: r.phase, max: r.maxPlayers, settings: r.settings, hostSeat: r.hostSeat,
      seats: r.seats.map((s, i) => {
        const human = s.kind === 'human';
        const pr = human ? persons.get(s.key) : null;
        const v = {
          i, kind: s.kind, name: s.name || '', dragon: s.dragon || null,
          ready: !!s.ready, connected: human ? !!(pr && pr.connected) : false,
          host: human && i === r.hostSeat, pid: human && pr ? pr.pid : null,
          slot: !r.match ? null : human ? (r.match.slotOf.has(s.key) ? r.match.slotOf.get(s.key) : null) : (s.kind === 'ai' && r.match.slotOfSeat.has(i) ? r.match.slotOfSeat.get(i) : null)
        };
        if (s.kind === 'ai') { v.aiLevel = s.aiLevel; v.connected = true; v.ready = true; }
        return v;
      }),
      spectators: r.spectators.map(k => { const p = persons.get(k); return { pid: p.pid, name: p.name }; }),
      specCount: r.spectators.length, specCap: SPEC_CAP,
      you: { pid: persons.get(key).pid, role: mySeat >= 0 ? 'player' : 'spectator', seat: mySeat, host: isHost },
      humans: humanSeats(r).length, ais: aiSeats(r).length,
      canStart: r.phase === 'room' && startError(r) == null
    };
    if (isHost) view.invites = Array.from(r.invites.entries()).filter(([, v]) => !v.revoked).map(([t, v]) => ({ token: t, role: v.role, created: v.created }));
    return view;
  }
  function pushRoom(r) {
    for (const k of members(r)) emit(k, { type: 'room', room: roomView(r, k) });
    dirty();
  }
  function sys(r, text) {
    const m = { pid: 0, name: '', text, role: 'sys', t: now() };
    r.chat.push(m); if (r.chat.length > 50) r.chat.shift();
    broadcast(r, { type: 'chat', m });
  }

  /* ---------- 人 ---------- */
  function connect(key, hello) {
    let p = persons.get(key);
    if (!p) {
      p = { key, pid: pidSeq++, name: '', dragon: 'rainbow', connected: true, dcAt: 0, roomId: null, sub: true, chatAt: 0 };
      persons.set(key, p); byPid.set(p.pid, p);
    }
    p.connected = true; p.dcAt = 0;
    if (hello) {
      p.name = cleanName(hello.name, p.name || randomName());
      if (inList(hello.dragon, DRAGONS)) p.dragon = hello.dragon;
    }
    if (!p.name) p.name = randomName();
    const r = p.roomId ? rooms.get(p.roomId) : null;
    if (p.roomId && !r) p.roomId = null;
    emit(key, { type: 'welcome', key, pid: p.pid, name: p.name, dragon: p.dragon, serverNow: now(), room: r ? roomView(r, key) : null });
    if (r) {
      emit(key, { type: 'chatlog', msgs: r.chat.slice(-40) });
      sendMatchState(r, key);
      pushRoom(r);
    } else {
      p.sub = true;
      emit(key, { type: 'rooms', rooms: listRooms() });
    }
    return p;
  }
  function disconnect(key) {
    const p = persons.get(key);
    if (!p || !p.connected) return;
    p.connected = false; p.dcAt = now();
    const r = p.roomId ? rooms.get(p.roomId) : null;
    if (r) pushRoom(r);
  }

  /* ---------- 房間 ---------- */
  function newRoom(host, nameOpt, max) {
    const id = roomId();
    const r = {
      id, name: cleanName(nameOpt, host.name + '的房間') || (host.name + '的房間'), phase: 'room', maxPlayers: max || MAX_SEATS,
      seats: [], hostSeat: 0, spectators: [], invites: new Map(), chat: [], banned: new Set(), match: null,
      settings: defaultSettings(), createdAt: now()
    };
    for (let i = 0; i < r.maxPlayers; i++) r.seats.push({ kind: 'empty' });
    rooms.set(id, r);
    return r;
  }
  function sit(r, p, i) {
    r.seats[i] = { kind: 'human', key: p.key, name: p.name, dragon: freeDragon(r, p.dragon, i), ready: false };
    p.roomId = r.id; p.sub = false;
  }
  function leaveRoom(key, reason) {
    const p = persons.get(key);
    if (!p || !p.roomId) return;
    const r = rooms.get(p.roomId);
    p.roomId = null; p.sub = true;
    if (!r) return;
    const i = seatOf(r, key);
    const si = r.spectators.indexOf(key);
    if (si >= 0) r.spectators.splice(si, 1);
    if (i >= 0) {
      r.seats[i] = { kind: 'empty' };
      if (r.hostSeat === i) reassignHost(r);
    }
    emit(key, { type: 'room', room: null });
    emit(key, { type: 'rooms', rooms: listRooms() });
    if (humanSeats(r).length === 0) { closeRoom(r, '房間已經沒有玩家，自動關閉了'); return; }
    if (i >= 0) {
      matchPlayerLeft(r, key);
      sys(r, p.name + (reason === 'timeout' ? ' 斷線太久，已離開' : reason === 'kicked' ? ' 被請出房間' : ' 離開了房間'));
    } else sys(r, p.name + ' 不再觀戰');
    pushRoom(r);
  }
  function reassignHost(r) {
    const next = r.seats.findIndex(s => s.kind === 'human');
    if (next >= 0) { r.hostSeat = next; r.seats[next].ready = false; sys(r, r.seats[next].name + ' 成為新房主'); }
  }
  function closeRoom(r, text) {
    if (!rooms.has(r.id)) return;
    for (const v of r.invites.values()) v.revoked = true;
    stopAI(r);
    r.match = null; r.phase = 'closed';
    const ids = members(r);
    rooms.delete(r.id);
    closed.set(r.id, { reason: text, at: now() });
    for (const k of ids) {
      const p = persons.get(k);
      if (p) { p.roomId = null; p.sub = true; }
      emit(k, { type: 'closed', text, room: r.id });
      emit(k, { type: 'room', room: null });
      emit(k, { type: 'rooms', rooms: listRooms() });
    }
    dirty();
  }

  /* ---------- 邀請 ---------- */
  function checkInvite(roomIdIn, tok) {
    const id = String(roomIdIn || '').toUpperCase();
    const r = rooms.get(id);
    if (!r) {
      const c = closed.get(id);
      return { ok: false, reason: c ? 'closed' : 'invalid' };
    }
    const inv = r.invites.get(String(tok || ''));
    if (!inv) return { ok: false, reason: 'invalid' };
    if (inv.revoked) return { ok: false, reason: 'revoked' };
    if (now() - inv.created > INVITE_MAX_MS) return { ok: false, reason: 'expired' };
    return { ok: true, room: r, inv };
  }

  /* ---------- 加入 ---------- */
  function joinRoom(p, r, want, info) {
    if (p.roomId && p.roomId !== r.id) leaveRoom(p.key);
    if (p.roomId === r.id) { pushRoom(r); return; }
    if (r.banned.has(p.key)) { err(p.key, 'banned', '你已被請出這個房間'); return; }
    let role = want === 'spectator' ? 'spectator' : 'player';
    let note = '';
    if (role === 'player') {
      if (r.phase !== 'room') { role = 'spectator'; note = '對局進行中，先以觀戰者身分加入'; }
      else if (filled(r).length >= r.maxPlayers) { role = 'spectator'; note = '席位已滿，先以觀戰者身分加入'; }
    }
    if (role === 'spectator') {
      if (!r.settings.allowSpectators) { err(p.key, 'spec_off', '這個房間不開放觀戰'); return; }
      if (r.spectators.length >= SPEC_CAP) { err(p.key, 'spec_full', '觀戰席已滿'); return; }
    }
    if (info) {
      p.name = cleanName(info.name, p.name || randomName());
      if (inList(info.dragon, DRAGONS)) p.dragon = info.dragon;
    }
    if (role === 'player') {
      sit(r, p, r.seats.findIndex(s => s.kind === 'empty'));
    } else {
      r.spectators.push(p.key); p.roomId = r.id; p.sub = false;
    }
    emit(p.key, { type: 'joined', room: r.id, role, note });
    emit(p.key, { type: 'chatlog', msgs: r.chat.slice(-40) });
    sys(r, p.name + (role === 'player' ? ' 加入了房間' : ' 開始觀戰'));
    pushRoom(r);
    sendMatchState(r, p.key);
  }

  /* ---------- 設定 ---------- */
  function applyPatch(r, patch) {
    const st = r.settings;
    if (patch.mode != null && inList(patch.mode, MODES)) st.mode = patch.mode;
    if (patch.level != null && inList(patch.level, LEVELS)) st.level = patch.level;
    if (patch.layout != null && (patch.layout === 'random' || inList(patch.layout, LAYOUT_IDS))) st.layout = patch.layout;
    if (patch.theme != null) {
      if (patch.theme === 'random') st.theme = 'random';
      else if (Number.isInteger(patch.theme) && patch.theme >= 0 && patch.theme < THEME_COUNT) st.theme = patch.theme;
    }
    if (patch.duration != null && inList(patch.duration, DURATIONS)) st.duration = patch.duration;
    if (patch.publicRoom != null) st.publicRoom = !!patch.publicRoom;
    if (patch.allowSpectators != null) st.allowSpectators = !!patch.allowSpectators;
    if (patch.name != null) r.name = cleanName(patch.name, r.name);
  }
  /** 調整人數上限；回傳錯誤文字或 null */
  function setMax(r, raw) {
    const m = Math.max(2, Math.min(MAX_SEATS, parseInt(raw, 10) || r.maxPlayers));
    const occ = r.seats.filter(s => s.kind !== 'empty');
    if (m < occ.length) return '目前已有 ' + occ.length + ' 個席位有人，人數上限不能再低了';
    if (m !== r.maxPlayers) {
      const hostObj = r.seats[r.hostSeat];
      r.seats = occ.concat(new Array(m - occ.length).fill(0).map(() => ({ kind: 'empty' })));
      r.hostSeat = occ.indexOf(hostObj);
      r.maxPlayers = m;
    }
    return null;
  }

  /* ---------- 對局 ---------- */
  function startError(r) {
    if (filled(r).length < 2) return ['few', '至少要有 2 位玩家'];
    const off = humanSeats(r).filter(s => { const p = persons.get(s.key); return !p || !p.connected; });
    if (off.length) return ['offline', '有玩家目前斷線中'];
    const wait = humanSeats(r).filter(s => r.seats.indexOf(s) !== r.hostSeat && !s.ready);
    if (wait.length) return ['notready', '還有 ' + wait.length + ' 位玩家沒按「準備好」'];
    return null;
  }
  function startMatch(r) {
    const occ = [];
    r.seats.forEach((s, i) => { if (s.kind !== 'empty') occ.push(i); });
    const slotOf = new Map();
    const slotOfSeat = new Map();
    const players = occ.map((si, n) => {
      const s = r.seats[si];
      slotOfSeat.set(si, n);
      if (s.kind === 'ai') return { name: s.name, dragon: s.dragon, kind: 'ai', aiLevel: s.aiLevel };
      slotOf.set(s.key, n);
      return { name: s.name, dragon: s.dragon, kind: 'human' };
    });
    const st = r.settings;
    const cfg = {
      mode: st.mode, level: st.level, seed: Math.floor(rnd() * 4294967296) >>> 0, layoutId: st.layout,
      themeId: st.theme === 'random' ? Math.floor(rnd() * THEME_COUNT) : st.theme, duration: st.duration, players
    };
    const t = now();
    const m = Match.create(cfg);
    const ais = [];
    players.forEach((pl, n) => { if (pl.kind === 'ai') ais.push({ slot: n, brain: AI.createBrain(pl.aiLevel, (cfg.seed + 977 * (n + 1)) >>> 0) }); });
    r.match = {
      cfg, m, slotOf, slotOfSeat, ais, aiAt: t + GO_IN, t0: t + GO_IN, startedAt: t, lastTickAt: -1e9, lastClockAt: t + GO_IN, lastHashAt: t + GO_IN,
      shotAt: players.map(() => -1e9), swapAt: players.map(() => -1e9), endAt: 0, rematch: new Set()
    };
    r.phase = 'countdown';
    counters.matches++;
    for (const s of r.seats) if (s.kind === 'human') s.ready = false;
    for (const k of members(r)) sendMatchState(r, k, true);
    pushRoom(r);
  }
  /** 把 start（和中途才進來的人需要的 sync）送給某個人 */
  function sendMatchState(r, key, fresh) {
    const g = r.match;
    if (!g) return;
    const slot = g.slotOf.has(key) && seatOf(r, key) >= 0 ? g.slotOf.get(key) : -1;
    const t = now();
    emit(key, { type: 'start', cfg: g.cfg, slot, t0Wall: g.t0, goIn: fresh ? GO_IN : Math.max(0, g.t0 - t), serverNow: t });
    if (!fresh) emit(key, { type: 'sync', snap: MatchSnap.snapshotAll(g.m), mt: t - g.t0 });
  }
  function sendEv(r, out) {
    const g = r.match;
    if (!out.length) return;
    broadcast(r, { type: 'ev', evs: out.map(o => o.ev), mt: now() - g.t0 });
    if (g.m.over) finishMatch(r);
  }
  function finishMatch(r) {
    const g = r.match;
    if (!g || g.endAt) return;
    g.endAt = now() + END_HOLD;
    broadcast(r, { type: 'result', result: g.m.result });
  }
  function stopAI(r) {
    const g = r.match;
    if (g && g.ais) g.ais.length = 0;
  }
  function backToRoom(r) {
    const g = r.match;
    stopAI(r);
    r.match = null; r.phase = 'room';
    for (const s of r.seats) if (s.kind === 'human') s.ready = false;
    if (g) for (const k of g.rematch) { const i = seatOf(r, k); if (i >= 0 && i !== r.hostSeat) r.seats[i].ready = true; }
    pushRoom(r);
  }
  function matchPlayerLeft(r, key) {
    const g = r.match;
    if (!g || g.m.over) return;
    const slot = g.slotOf.get(key);
    if (slot == null || g.m.left[slot]) return;
    stepMatch(r);
    const mt = Math.max(0, now() - g.t0);
    const out = Match.playerLeft(g.m, slot, mt);
    broadcast(r, { type: 'left', slot, mt });
    sendEv(r, out);
  }
  /** 時間推進到「現在」；回傳是否有事件 */
  function stepMatch(r, force) {
    const g = r.match;
    if (!g || g.m.over) return;
    const t = now();
    const mt = t - g.t0;
    if (mt < 0) return;
    if (r.phase === 'countdown') { r.phase = 'playing'; pushRoom(r); }
    if (!force && t - g.lastTickAt < TICK_MS) return;
    g.lastTickAt = t;
    sendEv(r, Match.tick(g.m, mt));
    if (g.m.over) return;
    stepAI(r, t);
    if (g.m.over) return;
    if (t - g.lastHashAt >= CLOCK_MS) {
      g.lastHashAt = t;
      broadcast(r, { type: 'hash', seq: g.m.seq, h: MatchSnap.hashes(g.m), mt });
    }
    if (t - g.lastClockAt >= CLOCK_MS) {
      g.lastClockAt = t;
      broadcast(r, { type: 'clock', mt });
    }
  }
  /** 真人與電腦共用的輸入入口：冷卻、先結算到期事件、套用、廣播 */
  function applyInput(r, slot, kind, angle, noStep) {
    const g = r.match;
    if (!g || g.m.over) return false;
    const t = now();
    const mt = t - g.t0;
    if (mt < 0) { counters.inputEarly++; return false; }
    const isShot = kind === 'shot';
    const cd = isShot ? SHOT_CD : SWAP_CD;
    const last = isShot ? g.shotAt : g.swapAt;
    if (t - last[slot] < cd) { if (isShot) counters.shotsDropped++; return false; }
    if (isShot && !Number.isFinite(+angle)) return false;
    last[slot] = t;
    if (!noStep) stepMatch(r, true);      /* 先把到期的 land 結算，事件順序才和時間一致（電腦在 stepMatch 內呼叫，已結算過） */
    if (g.m.over) return false;
    const out = Match.input(g.m, slot, isShot ? { t: 'shot', a: +angle } : { t: 'swap' }, mt);
    if (isShot) counters.shots++; else counters.swaps++;
    sendEv(r, out);
    return true;
  }
  function matchInput(r, key, seat, msg) {
    const g = r.match;
    if (!g || g.m.over || seat < 0) return;
    const slot = g.slotOf.get(key);
    if (slot == null) return;
    applyInput(r, slot, msg.type === 'shot' ? 'shot' : 'swap', msg.a);
  }
  /** 電腦：用伺服器時鐘推進每顆 brain（和單機 game.js 同一組 AI.think），決定後走 applyInput */
  function stepAI(r, t) {
    const g = r.match;
    if (!g || !g.ais.length) return;
    const dt = Math.max(0, t - g.aiAt);
    g.aiAt = t;
    for (const a of g.ais.slice()) {
      if (!r.match || g.m.over) return;
      const b = g.m.boards[a.slot];
      const dec = AI.think(a.brain, b, dt, g.m.mode, !b.fullClear && !g.m.left[a.slot]);
      if (!dec) continue;
      if (dec.swap) applyInput(r, a.slot, 'swap', 0, true);
      if (g.m.over) return;
      applyInput(r, a.slot, 'shot', dec.a, true);
    }
  }
  /* ---------- 電腦席位（房主） ---------- */
  function aiName(r, dragon) { return DRAGON_NAMES[dragon].replace('龍', '') + '・電腦'; }
  function addAI(r, level) {
    const i = r.seats.findIndex(s => s.kind === 'empty');
    if (i < 0) return -1;
    const taken = takenDragons(r, -1);
    const open = DRAGONS.filter(d => !taken.has(d));
    const dragon = open.length ? open[Math.floor(rnd() * open.length)] : DRAGONS[0];
    r.seats[i] = { kind: 'ai', name: aiName(r, dragon), dragon, aiLevel: inList(level, LEVELS) ? level : 'easy', ready: true };
    return i;
  }

  /* ---------- 訊息分派 ---------- */
  function handle(key, msg) {
    const p = persons.get(key);
    if (!p || !msg || typeof msg !== 'object') return;
    const r = p.roomId ? rooms.get(p.roomId) : null;
    const seat = r ? seatOf(r, key) : -1;
    const isHost = !!r && seat >= 0 && seat === r.hostSeat;

    switch (msg.type) {
      case 'ping': emit(key, { type: 'pong', t: msg.t }); return;
      case 'profile': {
        p.name = cleanName(msg.name, p.name);
        if (inList(msg.dragon, DRAGONS)) p.dragon = msg.dragon;
        if (r && seat >= 0 && r.phase === 'room') {
          r.seats[seat].name = p.name;
          r.seats[seat].dragon = freeDragon(r, msg.dragon || p.dragon, seat);
          pushRoom(r);
        }
        return;
      }
      case 'lobbySub': p.sub = !r; emit(key, { type: 'rooms', rooms: listRooms() }); return;
      case 'create': {
        if (r) leaveRoom(key);
        p.name = cleanName(msg.name, p.name || randomName());
        if (inList(msg.dragon, DRAGONS)) p.dragon = msg.dragon;
        const nr = newRoom(p, msg.roomName, MAX_SEATS);
        if (msg.settings && typeof msg.settings === 'object') applyPatch(nr, msg.settings);
        const max = msg.max != null ? msg.max : (msg.settings && msg.settings.maxPlayers);
        if (max != null) setMax(nr, max);
        sit(nr, p, 0); nr.hostSeat = 0;
        emit(key, { type: 'joined', room: nr.id, role: 'player', note: '' });
        sys(nr, p.name + ' 建立了房間');
        pushRoom(nr);
        return;
      }
      case 'quick': {
        if (r) leaveRoom(key);
        p.name = cleanName(msg.name, p.name || randomName());
        if (inList(msg.dragon, DRAGONS)) p.dragon = msg.dragon;
        const open = Array.from(rooms.values()).filter(x => x.phase === 'room' && x.settings.publicRoom && filled(x).length < x.maxPlayers && !x.banned.has(key))
          .sort((a, b) => humanSeats(b).length - humanSeats(a).length || a.createdAt - b.createdAt);
        if (open.length) joinRoom(p, open[0], 'player', null);
        else {
          const nr = newRoom(p, null, MAX_SEATS);
          sit(nr, p, 0); nr.hostSeat = 0;
          emit(key, { type: 'joined', room: nr.id, role: 'player', note: '目前沒有可加入的房間，幫你開了一間' });
          sys(nr, p.name + ' 建立了房間');
          pushRoom(nr);
        }
        return;
      }
      case 'inviteInfo': {
        const c = checkInvite(msg.room, msg.token);
        if (!c.ok) { emit(key, { type: 'inviteInfo', ok: false, reason: c.reason }); return; }
        const rr = c.room;
        emit(key, {
          type: 'inviteInfo', ok: true, room: rr.id, name: rr.name, role: c.inv.role, phase: rr.phase,
          players: filled(rr).length, max: rr.maxPlayers, full: filled(rr).length >= rr.maxPlayers,
          willSpectate: c.inv.role === 'spectator' || rr.phase !== 'room' || filled(rr).length >= rr.maxPlayers
        });
        return;
      }
      case 'join': {
        const id = String(msg.room || '').toUpperCase();
        let want = msg.as === 'spectator' ? 'spectator' : 'player';
        let rr = rooms.get(id);
        if (msg.token != null && msg.token !== '') {
          const c = checkInvite(id, msg.token);
          if (!c.ok) { emit(key, { type: 'joinFailed', reason: c.reason }); return; }
          rr = c.room; want = c.inv.role;      /* 角色由邀請 token 決定，改暱稱改不了權限 */
        }
        if (!rr) { emit(key, { type: 'joinFailed', reason: closed.has(id) ? 'closed' : 'invalid' }); return; }
        joinRoom(p, rr, want, { name: msg.name, dragon: msg.dragon });
        return;
      }
    }

    if (!r) return;
    switch (msg.type) {
      case 'shot':
      case 'swap': matchInput(r, key, seat, msg); return;
      case 'resync': {
        if (!r.match) return;
        counters.resyncs++;
        const g = r.match;
        emit(key, { type: 'sync', snap: MatchSnap.snapshotAll(g.m), mt: now() - g.t0 });
        return;
      }
      case 'leave': leaveRoom(key); return;
      case 'chat': {
        const text = cleanText(msg.text);
        if (!text || now() - p.chatAt < 450) return;
        p.chatAt = now();
        const m = { pid: p.pid, name: p.name, text, role: seat >= 0 ? 'player' : 'spectator', t: now() };
        r.chat.push(m); if (r.chat.length > 50) r.chat.shift();
        broadcast(r, { type: 'chat', m });
        return;
      }
      case 'ready': {
        if (seat < 0 || r.phase !== 'room' || isHost) return;
        r.seats[seat].ready = !!msg.value;
        pushRoom(r); return;
      }
      case 'sit': {
        if (seat >= 0 || r.phase !== 'room') return;
        const i = r.seats.findIndex(s => s.kind === 'empty');
        if (i < 0) { err(key, 'full', '席位已滿'); return; }
        r.spectators.splice(r.spectators.indexOf(key), 1);
        sit(r, p, i);
        sys(r, p.name + ' 加入對戰');
        pushRoom(r); return;
      }
      case 'watch': {
        if (seat < 0 || r.phase !== 'room' || isHost) return;
        if (!r.settings.allowSpectators) { err(key, 'spec_off', '這個房間不開放觀戰'); return; }
        if (r.spectators.length >= SPEC_CAP) { err(key, 'spec_full', '觀戰席已滿'); return; }
        r.seats[seat] = { kind: 'empty' };
        r.spectators.push(key);
        sys(r, p.name + ' 改為觀戰');
        pushRoom(r); return;
      }
      case 'invite': {
        if (!isHost) return;
        const role = msg.role === 'spectator' ? 'spectator' : 'player';
        const t = token();
        r.invites.set(t, { role, created: now(), revoked: false });
        emit(key, { type: 'invite', room: r.id, token: t, role });
        pushRoom(r); return;
      }
      case 'revoke': {
        if (!isHost) return;
        for (const v of r.invites.values()) v.revoked = true;
        sys(r, '房主撤銷了所有邀請連結');
        pushRoom(r); return;
      }
      case 'settings': {
        if (!isHost || r.phase !== 'room') return;
        const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
        if (patch.maxPlayers != null) {
          const e = setMax(r, patch.maxPlayers);
          if (e) { err(key, 'max', e); return; }
        }
        applyPatch(r, patch);
        for (const s of r.seats) if (s.kind === 'human') s.ready = false;
        pushRoom(r); return;
      }
      case 'addAI': {
        if (!isHost || r.phase !== 'room') return;
        const ai = addAI(r, msg.level);
        if (ai < 0) { err(key, 'full', '席位已滿，先請一位電腦出去再加'); return; }
        sys(r, '房主加入了電腦：' + r.seats[ai].name);
        pushRoom(r); return;
      }
      case 'setAI': {
        if (!isHost || r.phase !== 'room') return;
        const x = r.seats[msg.seat | 0];
        if (!x || x.kind !== 'ai' || !inList(msg.level, LEVELS)) return;
        x.aiLevel = msg.level;
        pushRoom(r); return;
      }
      case 'removeAI': {
        if (!isHost || r.phase !== 'room') return;
        const x = r.seats[msg.seat | 0];
        if (!x || x.kind !== 'ai') return;
        r.seats[msg.seat | 0] = { kind: 'empty' };
        sys(r, '房主請 ' + x.name + ' 離開了');
        pushRoom(r); return;
      }
      case 'kick': {
        if (!isHost) return;
        let target = null;
        if (msg.pid != null) target = byPid.get(msg.pid | 0);
        else if (msg.seat != null && r.seats[msg.seat | 0] && r.seats[msg.seat | 0].kind === 'human') target = persons.get(r.seats[msg.seat | 0].key);
        if (!target || target.key === key || target.roomId !== r.id) return;
        r.banned.add(target.key);
        emit(target.key, { type: 'kicked', text: '你被房主請出房間了' });
        leaveRoom(target.key, 'kicked');
        return;
      }
      case 'start': {
        if (!isHost || r.phase !== 'room') return;
        const e = startError(r);
        if (e) { err(key, e[0], e[1]); return; }
        startMatch(r); return;
      }
      case 'rematch': {
        /* 對局結束後會自動回到房間；rematch = 「我想再來一局」：非房主自動準備好，房主只是廣播意願 */
        if (seat < 0) return;
        if (r.match) { r.match.rematch.add(key); return; }       /* 還在 0.5 秒的收尾，回房間時套用 */
        if (r.phase !== 'room') return;
        if (!isHost) { r.seats[seat].ready = true; pushRoom(r); }
        sys(r, p.name + ' 想再來一局');
        return;
      }
    }
  }

  /* ---------- 週期工作 ---------- */
  function tick() {
    const t = now();
    for (const r of Array.from(rooms.values())) {
      const g = r.match;
      if (!g) continue;
      if (g.endAt) { if (t >= g.endAt) backToRoom(r); continue; }
      stepMatch(r);
    }
    for (const p of Array.from(persons.values())) {
      if (!p.connected && p.dcAt && t - p.dcAt > GRACE_MS) {
        if (p.roomId) leaveRoom(p.key, 'timeout');
        persons.delete(p.key); byPid.delete(p.pid);
      }
    }
    for (const [id, c] of closed) if (t - c.at > CLOSED_KEEP_MS) closed.delete(id);
    if (lobbyDirty) {
      lobbyDirty = false;
      const list = listRooms();
      for (const p of persons.values()) if (p.sub && p.connected && !p.roomId) emit(p.key, { type: 'rooms', rooms: list });
      onRoomsChanged(list);
    }
  }

  return {
    connect, disconnect, handle, tick, listRooms, roomView, counters,
    /** 在線人數（遊戲大廳的統一格式）：online 連線數、players 房間內真人玩家、spectators 觀戰、lobby 停在大廳、rooms 有人連線的房間 */
    stats() {
      let online = 0, players = 0, spectators = 0, lobby = 0;
      const active = new Set();
      for (const p of persons.values()) {
        if (!p.connected) continue;
        online++;
        const r = p.roomId ? rooms.get(p.roomId) : null;
        if (!r) { lobby++; continue; }
        active.add(r.id);
        if (r.spectators.indexOf(p.key) >= 0) spectators++; else players++;
      }
      return { online, players, spectators, lobby, rooms: active.size };
    },
    /** 記憶體中的房間數（含斷線寬限中的） */
    roomCount() { return rooms.size; },
    /* 測試用 */ _rooms: rooms, _persons: persons, _closed: closed, GRACE_MS, SPEC_CAP, GO_IN
  };
}

module.exports = { createHub, cleanName, cleanText, DRAGONS, DRAGON_NAMES, MODES, LEVELS, DURATIONS, LAYOUT_IDS, THEME_COUNT, GRACE_MS, SHOT_CD, GO_IN };
