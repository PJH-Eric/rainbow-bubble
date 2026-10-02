/* ===== tests/wsclient.js — 測試與檢查腳本共用的 WebSocket 客戶端（Node 內建 WebSocket） =====
 *
 * client(base, key, name, opt)：
 *   opt.lag     單向人工延遲（毫秒）：送出與收到各延遲 lag（來回約 2×lag），順序不變
 *   opt.dragon  hello 的龍
 * 常用：c.send(msg)、c.last(type)、c.all(type)、c.waitFor(pred, ms)、c.room（最新的房間檢視）
 *
 * attachMatch(c)：模擬正式客戶端的對局同步流程（start 建局 → 套用 ev → hash 對帳 → 不一致送 resync → 套用 sync），
 *   c.m 是目前的對局物件，c.stats 是計數（mismatch／resync／evCount…）。
 */
'use strict';
const Match = require('../public/js/match.js');
const Rules = require('../public/js/rules.js');
const MatchSnap = require('../public/js/matchsnap.js');

function client(base, key, name, opt) {
  opt = opt || {};
  const lag = opt.lag || 0;
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  const c = { ws, key, msgs: [], room: null, handlers: [], waiters: [], closed: false };
  const later = (fn) => (lag ? setTimeout(fn, lag) : fn());
  const deliver = m => {
    c.msgs.push(m);
    if (m.type === 'room' || m.type === 'welcome') c.room = m.room;
    for (const h of c.handlers) h(m);
    for (const w of c.waiters.slice()) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); clearTimeout(w.timer); w.res(m); }
  };
  ws.onmessage = e => { const m = JSON.parse(e.data); later(() => deliver(m)); };
  ws.onclose = () => { c.closed = true; };
  c.open = new Promise((res, rej) => {
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', key, name, dragon: opt.dragon || 'rainbow' })); res(); };
    ws.onerror = () => rej(new Error('連線失敗'));
  });
  c.send = m => { const s = JSON.stringify(m); later(() => { if (ws.readyState === 1) ws.send(s); }); };
  c.last = t => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].type === t) return c.msgs[i]; return null; };
  c.all = t => c.msgs.filter(m => m.type === t);
  c.count = t => c.all(t).length;
  c.waitFor = (pred, ms) => {
    if (typeof pred === 'string') { const t = pred; pred = m => m.type === t; }
    const hit = c.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res, timer: setTimeout(() => { c.waiters.splice(c.waiters.indexOf(w), 1); rej(new Error('等候逾時')); }, ms || 5000) };
      c.waiters.push(w);
    });
  };
  c.waitRoom = ms => c.waitFor(m => m.type === 'room' && m.room, ms);
  c.close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } };
  return c;
}

function attachMatch(c) {
  c.m = null; c.slot = -1; c.over = false; c.result = null;
  c.stats = { evCount: 0, hashes: 0, mismatch: 0, resync: 0, syncs: 0, skipped: 0 };
  c.handlers.push(msg => {
    switch (msg.type) {
      case 'start': c.m = Match.create(msg.cfg); c.slot = msg.slot; c.over = false; c.result = null; break;
      case 'sync': c.m = MatchSnap.restoreAll(msg.snap); c.stats.syncs++; break;
      case 'ev': if (c.m) for (const ev of msg.evs) { Match.apply(c.m, ev); c.stats.evCount++; } break;
      case 'left': if (c.m) c.m.left[msg.slot] = true; break;
      case 'result': c.over = true; c.result = msg.result; break;
      case 'hash': {
        if (!c.m) break;
        if (c.m.seq !== msg.seq) { c.stats.skipped++; break; }
        c.stats.hashes++;
        const mine = MatchSnap.hashes(c.m);
        if (mine.join() !== msg.h.join()) { c.stats.mismatch++; c.stats.resync++; c.send({ type: 'resync' }); }
        break;
      }
    }
  });
  return c;
}

const boardHashes = m => m.boards.map(b => Rules.boardHash(b));
const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = { client, attachMatch, boardHashes, wait };
