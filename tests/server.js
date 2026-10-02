/* ===== tests/server.js — 伺服器整合測試：靜態檔路徑、WebSocket 防呆、真的連線的兩人對局 =====
 * 用法：node tests/server.js（在隨機埠啟動 server.js）
 * 約 12 秒：含一場真實時間的倒數＋對局，以及一場「加速時鐘」跑完整場拿 result。
 */
'use strict';
const net = require('net');
const crypto = require('crypto');
const { createServer } = require('../server.js');
const Match = require('../public/js/match.js');
const MatchSnap = require('../public/js/matchsnap.js');
const { client, attachMatch, boardHashes, wait } = require('./wsclient.js');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

/* ---------- 原始 TCP 客戶端（測封包防呆） ---------- */
function mframe(op, payload, fin, lenOverride) {
  const p = Buffer.from(payload);
  const len = lenOverride != null ? lenOverride : p.length;
  let h;
  if (len < 126) { h = Buffer.alloc(2); h[1] = 0x80 | len; }
  else if (len < 65536) { h = Buffer.alloc(4); h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[1] = 0x80 | 127; h.writeUInt32BE(Math.floor(len / 4294967296), 2); h.writeUInt32BE(len >>> 0, 6); }
  h[0] = (fin === false ? 0 : 0x80) | op;
  const mask = crypto.randomBytes(4);
  for (let i = 0; i < p.length; i++) p[i] ^= mask[i % 4];
  return Buffer.concat([h, mask, p]);
}
function rawConnect(port, origin) {
  return new Promise(res => {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET /ws HTTP/1.1\r\nHost: x\r\n' + (origin ? 'Origin: ' + origin + '\r\n' : '') + 'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
    let buf = Buffer.alloc(0), up = false;
    s.msgs = []; s.gone = false; s.status = '';
    s.on('data', c => {
      buf = Buffer.concat([buf, c]);
      if (!up) {
        const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
        up = true; s.status = buf.slice(0, buf.indexOf('\r\n')).toString(); buf = buf.slice(i + 4);
        res(s);
      }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
        if (buf.length < off + len) return;
        if ((buf[0] & 0xf) === 1) s.msgs.push(JSON.parse(buf.slice(off, off + len).toString()));
        buf = buf.slice(off + len);
      }
    });
    s.on('close', () => { s.gone = true; if (!up) res(s); });
    s.on('error', () => {});
    s.json = o => s.write(mframe(1, JSON.stringify(o)));
    s.has = t => s.msgs.some(m => m.type === t);
  });
}
function rawGet(port, p) {
  return new Promise(res => {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET ' + p + ' HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let d = ''; s.on('data', c => { d += c; }); s.on('close', () => res(d.split('\r\n')[0])); s.on('error', () => res('ERR'));
  });
}
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', r));
const evsOf = c => c.all('ev').flatMap(m => m.evs);

/** 建房＋兩人＋(可選)觀戰，回傳 { A, B, S, id }；設定 patch 由房主送出 */
async function lobby(base, tag, patch, withSpec) {
  const A = attachMatch(client(base, tag + '-key-a-0001', '甲')), B = attachMatch(client(base, tag + '-key-b-0001', '乙', { dragon: 'cloud' }));
  const S = withSpec ? attachMatch(client(base, tag + '-key-s-0001', '觀')) : null;
  await Promise.all([A.open, B.open, S && S.open].filter(Boolean));
  await A.waitFor('rooms');
  A.send({ type: 'create', roomName: '測試房', name: '甲' });
  await A.waitFor('joined'); await A.waitRoom();
  const id = A.room.id;
  A.send({ type: 'settings', patch });
  B.send({ type: 'join', room: id, name: '乙' });
  await B.waitFor('joined');
  B.send({ type: 'ready', value: true });
  if (S) { S.send({ type: 'join', room: id, as: 'spectator' }); await S.waitFor('joined'); }
  await wait(150);
  return { A, B, S, id };
}

(async () => {
  const strict = createServer({ allowOrigin: 'https://me.github.io' });
  await listen(strict.server);
  const { server, hub } = createServer({ allowOrigin: '*' });
  await listen(server);
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  const tag = Date.now().toString(36);

  console.log('\n靜態檔與 HTTP 端點');
  ok(/ 400 /.test(await rawGet(port, '/index.html%00.js')), '網址含 %00 回 400');
  ok(/ 200 /.test(await rawGet(port, '/health')), '送過 %00 之後伺服器還活著');
  ok(/ 403 /.test(await rawGet(port, '/../server.js')), '../ 跳出 public 回 403');
  ok(/ 403 /.test(await rawGet(port, '/../public-x/a.txt')), '名稱以 public 開頭的旁邊資料夾也回 403');
  const health = await (await fetch(base + '/health')).json();
  ok(health.ok === true && health.game === 'rainbow-bubble', '/health 回報 ok 與遊戲名稱');
  const pres = await (await fetch(base + '/api/presence')).json();
  ok(pres.gameId === 'rainbow-bubble' && ['online', 'players', 'spectators', 'lobby', 'rooms'].every(k => Number.isInteger(pres[k]) && pres[k] >= 0) && !isNaN(Date.parse(pres.updatedAt)),
    '/api/presence 符合遊戲大廳的統一格式');
  const opt = await fetch(base + '/health', { method: 'OPTIONS', headers: { Origin: 'https://x.test' } });
  ok(opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*', 'allowOrigin=* 時 CORS 標頭正確');
  const sp = strict.server.address().port;
  const okOrigin = await fetch('http://127.0.0.1:' + sp + '/health', { headers: { Origin: 'https://me.github.io' } });
  const badOrigin = await fetch('http://127.0.0.1:' + sp + '/health', { headers: { Origin: 'https://evil.test' } });
  ok(okOrigin.headers.get('access-control-allow-origin') === 'https://me.github.io' && !badOrigin.headers.get('access-control-allow-origin'),
    'GAME_ALLOWED_ORIGIN：名單內的來源有 CORS 標頭，其他沒有');
  const wsBad = await rawConnect(sp, 'https://evil.test');
  ok(/403/.test(wsBad.status) || wsBad.gone, '不在名單的 Origin 不能升級成 WebSocket');
  const wsGood = await rawConnect(sp, 'https://me.github.io');
  ok(/101/.test(wsGood.status), '名單內的 Origin 可以連線');
  wsGood.destroy();

  console.log('\nWebSocket 防呆');
  const big = await rawConnect(port);
  big.json({ type: 'hello', key: 'big-frame-01', name: 'A' }); await wait(100);
  big.write(mframe(1, 'x', true, 2 ** 33)); await wait(200);
  ok(big.gone, '超過大小上限的 frame 直接斷線');
  const frag = await rawConnect(port);
  frag.json({ type: 'hello', key: 'frag-flood-1', name: 'B' }); await wait(100);
  for (let i = 0; i < 4; i++) frag.write(mframe(i ? 0 : 1, 'x'.repeat(30000), false));
  await wait(200);
  ok(frag.gone, '分段累計超過上限也斷線');
  const bad = await rawConnect(port);
  bad.json({ type: 'hello', key: '........', name: 'C' }); await wait(150);
  ok(!bad.has('welcome'), '只有怪字元的 key 不會被接受'); bad.destroy();
  const good = await rawConnect(port);
  good.json({ type: 'hello', key: 'good-key-01', name: 'G' }); await wait(150);
  ok(good.has('welcome'), '正常的 key 會收到 welcome'); good.destroy();
  const junk = await rawConnect(port);
  junk.json({ type: 'hello', key: 'junk-key-001', name: 'J' }); await wait(100);
  junk.write(mframe(1, '{不是 json')); junk.json({ type: 'shot', a: 9000 }); junk.json({ type: 'swap' }); junk.json([1, 2]); junk.json({ type: 'join', room: 12 });
  await wait(150);
  ok(!junk.gone, '壞掉的 JSON／不在房間時的 shot／swap 都不會讓連線或伺服器出事'); junk.destroy();

  console.log('\n真實連線的兩人對局（真實時間，含 3 秒倒數）');
  const { A, B, S, id } = await lobby(base, tag, { mode: 'duel', level: 'normal', layout: 'checker', duration: 120000, theme: 4 }, true);
  ok(A.room.settings.mode === 'duel' && A.room.settings.theme === 4 && B.room.seats[1].dragon === 'cloud', '房主設定生效、龍選擇同步');
  const t0 = Date.now();
  A.send({ type: 'start' });
  const [sa, sb, ss] = await Promise.all([A.waitFor('start'), B.waitFor('start'), S.waitFor('start')]);
  ok(sa.slot === 0 && sb.slot === 1 && ss.slot === -1, 'start：玩家 slot 依座位順序、觀戰者 slot=-1');
  ok(sa.goIn === 3000 && Math.abs(sa.t0Wall - (Date.now() + 3000)) < 800, 'start：t0Wall = 伺服器時間 + 3 秒');
  ok(sa.cfg.mode === 'duel' && sa.cfg.level === 'normal' && sa.cfg.layoutId === 'checker' && sa.cfg.themeId === 4 && sa.cfg.duration === 120000
    && sa.cfg.players.length === 2 && sa.cfg.players[1].dragon === 'cloud' && Number.isInteger(sa.cfg.seed), 'start：cfg 欄位齊全');
  await wait(800);
  A.send({ type: 'shot', a: 9000 }); await wait(150);
  ok(evsOf(B).length === 0, '倒數中的輸入被忽略');
  await wait(Math.max(0, sa.t0Wall - Date.now()) + 300);
  ok(A.room && (await A.waitFor(m => m.type === 'room' && m.room.phase === 'playing', 2000).then(() => true, () => false)), '倒數結束後房間 phase = playing');

  for (let i = 0; i < 12; i++) {
    (i % 2 ? B : A).send({ type: 'shot', a: 3500 + (i * 1031) % 11000 });
    if (i === 2) { A.send({ type: 'shot', a: 5000 }); }    /* 緊接著的第二發：冷卻中，應被丟棄 */
    await wait(320);
  }
  B.send({ type: 'swap' }); await wait(200);
  const ea = evsOf(A), eb = evsOf(B), es = evsOf(S);
  ok(ea.length >= 12 && JSON.stringify(ea) === JSON.stringify(eb) && JSON.stringify(ea) === JSON.stringify(es), 'A、B、觀戰者收到完全相同的事件串（' + ea.length + ' 個）');
  ok(ea.filter(e => e.e === 'shot').length === 12 && hub.counters.shotsDropped === 1, '冷卻中的第二發被丟棄、其餘 12 發全數接受');
  ok(ea.some(e => e.e === 'swap' && e.s === 1), 'swap 事件廣播');
  ok(ea.filter(e => e.e === 'shot').every(e => (e.s === 0 && e.t < 6000) || e.s === 1) && A.all('ev').every(m => typeof m.mt === 'number'), '事件帶 s／a／t，ev 批次帶 mt');
  const room = [...hub._rooms.values()][0], srv = room.match.m;
  ok(JSON.stringify(boardHashes(A.m)) === JSON.stringify(boardHashes(srv)) && JSON.stringify(boardHashes(S.m)) === JSON.stringify(boardHashes(srv)), '三個客戶端重播出的盤面雜湊 = 伺服器的');

  await wait(2200);
  ok(A.stats.hashes >= 1 && B.stats.hashes >= 1 && A.stats.mismatch + B.stats.mismatch + S.stats.mismatch === 0, 'hash{seq,h} 定期送達且對得上（A ' + A.stats.hashes + ' 次、B ' + B.stats.hashes + ' 次）');
  ok(A.count('clock') >= 1 && typeof A.last('clock').mt === 'number', 'clock{mt} 定期送達');

  /* resync：故意弄壞 B 的盤面，hash 對帳會發現並自動重送 */
  B.m.boards[0].rows[0][0] = (B.m.boards[0].rows[0][0] + 1) % 6 + 1;
  const before = B.stats.syncs;
  await B.waitFor(() => B.stats.syncs > before, 4500).catch(() => {});
  ok(B.stats.mismatch >= 1 && B.stats.syncs > before, '盤面被弄壞 → 下一次 hash 對帳發現 → resync → 收到 sync');
  ok(JSON.stringify(boardHashes(B.m)) === JSON.stringify(boardHashes(room.match.m)), 'sync 後 B 的盤面與伺服器一致');
  const sync = B.last('sync');
  ok(sync.snap && sync.snap.cfg && Array.isArray(sync.snap.boards) && 'seq' in sync.snap && 'pending' in sync.snap && 'reachedAt' in sync.snap
    && 'lastAttacker' in sync.snap && 'left' in sync.snap && 'gid' in sync.snap && 'over' in sync.snap && 'result' in sync.snap, 'sync.snap 欄位齊全');

  /* 中途加入的觀戰者 */
  const L = attachMatch(client(base, tag + '-key-l-0001', '晚到')); await L.open; await L.waitFor('rooms');
  L.send({ type: 'join', room: id, as: 'spectator' });
  await L.waitFor('sync');
  ok(L.slot === -1 && L.last('start').slot === -1 && JSON.stringify(boardHashes(L.m)) === JSON.stringify(boardHashes(room.match.m)), '中途加入的觀戰者收到 start＋sync，盤面與伺服器一致');
  A.send({ type: 'shot', a: 7000 }); await wait(250);
  ok(JSON.stringify(boardHashes(L.m)) === JSON.stringify(boardHashes(A.m)), '中途觀戰者之後跟著事件走，仍與玩家一致');

  /* 斷線重連：B 掉線 1 秒後帶同一個 key 回來 */
  B.ws.close(); await wait(400);
  const B2 = attachMatch(client(base, tag + '-key-b-0001', '乙')); await B2.open;
  await B2.waitFor('sync');
  ok(B2.slot === 1 && JSON.stringify(boardHashes(B2.m)) === JSON.stringify(boardHashes(room.match.m)), '玩家斷線重連：回到原本的 slot，收到 start＋sync');

  /* 離場 */
  B2.send({ type: 'leave' });
  await A.waitFor('left', 2000).catch(() => {});
  ok(A.last('left') && A.last('left').slot === 1, '玩家離開 → 其他人收到 left{slot}');
  A.send({ type: 'leave' }); await wait(250);
  ok(S.last('closed') && L.last('closed') && hub._rooms.size === 0, '最後一位真人離開 → 觀戰者收到 closed、房間移除');
  for (const c of [A, B, B2, S, L]) c.close();

  console.log('\n完整一場（加速時鐘 ×40，跑到時間到拿 result）');
  const T0 = Date.now();
  const fast = createServer({ allowOrigin: '*', now: () => T0 + (Date.now() - T0) * 40 });
  await listen(fast.server);
  const fbase = 'http://127.0.0.1:' + fast.server.address().port;
  const f = await lobby(fbase, tag + 'f', { mode: 'race', level: 'hard', layout: 'checker', duration: 120000 }, false);
  f.A.send({ type: 'start' });
  await f.A.waitFor('start');
  await wait(200);
  let n = 0;
  while (!f.A.over && n < 400) { (n % 2 ? f.B : f.A).send({ type: 'shot', a: 2500 + (n * 1291) % 13000 }); n++; await wait(30); }
  const res = await f.B.waitFor('result', 6000).catch(() => null);
  ok(res && res.result && res.result.reason === 'time' && res.result.ranks.length === 2 && res.result.mode === 'race', 'result 送達：reason=time、ranks 兩位（共送出 ' + n + ' 次輸入）');
  ok(f.A.m.over && f.B.m.over && JSON.stringify(boardHashes(f.A.m)) === JSON.stringify(boardHashes(f.B.m)), '兩邊都套用到 end 事件，結束時盤面一致');
  ok(res.result.ranks[0].cleared >= res.result.ranks[1].cleared, '名次依清除數排序');
  const evAfter = f.A.all('ev').flatMap(m => m.evs); const endIdx = evAfter.findIndex(e => e.e === 'end');
  ok(endIdx === evAfter.length - 1, '結束事件 end 是最後一個事件');
  const back = await f.A.waitFor(m => m.type === 'room' && m.room.phase === 'room' && f.A.msgs.indexOf(m) > f.A.msgs.indexOf(f.A.last('result')), 3000).catch(() => null);
  ok(back && back.room.seats.every(s => !s.ready) && back.room.you.host, '約 0.5 秒後回到房間：準備清除、房主不變');
  f.B.send({ type: 'rematch' }); await wait(150);
  ok(f.A.room.seats[1].ready === true && f.A.room.canStart, 'rematch：非房主自動準備好，房主可再開一局');
  f.A.send({ type: 'start' });
  const s2 = await f.A.waitFor(m => m.type === 'start' && m !== f.A.msgs.find(x => x.type === 'start'), 2000).catch(() => null);
  ok(s2 && s2.cfg.seed !== f.A.msgs.find(x => x.type === 'start').cfg.seed, '再來一局：新的 start、新的 seed');
  for (const c of [f.A, f.B]) c.close();
  fast.server.close();

  for (const c of [A, B, S]) c.close();
  server.close(); strict.server.close();
  await wait(100);
  console.log(fails ? '\n' + fails + ' 項失敗' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
