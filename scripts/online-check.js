/* 線上端對端檢查：真的啟動 server.js，用 Node 內建 WebSocket 連線，驗證房間、邀請、觀戰、對局與零真人自動關閉。
 * 指定 SERVER 就改測那台（已部署的網址）：SERVER=https://xxx.onrender.com node scripts/online-check.js */
'use strict';
const { createServer } = require('../server.js');
const { client, attachMatch, boardHashes, wait: rawWait } = require('../tests/wsclient.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
/* 測遠端伺服器時等久一點（來回延遲可能數百毫秒） */
const SLOW = process.env.SERVER ? 4 : 1;
const wait = ms => rawWait(ms * SLOW);

(async () => {
  let server = null, base = (process.env.SERVER || '').replace(/\/+$/, '');
  if (!base) {
    server = createServer({ allowOrigin: '*' }).server;
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  /* 每次用不同的 key，重複測同一台遠端伺服器也不會撞到上次的身分 */
  const tag = Date.now().toString(36);
  const res = await fetch(base + '/health');
  ok(res.ok && (await res.json()).ok, '/health 正常');

  const mk = (k, n, d) => attachMatch(client(base, tag + '-key-' + k + '-0001', n, { dragon: d }));
  const A = mk('a', '甲', 'sun'), B = mk('b', '乙', 'frost'), S = mk('s', '觀'), C = mk('c', '丙');
  await Promise.all([A.open, B.open, S.open, C.open]); await wait(200);
  ok(A.last('welcome') && A.last('rooms'), '連線後收到 welcome 與房間列表');
  A.send({ type: 'create', roomName: '測試房', name: '甲', dragon: 'sun' }); await wait(200);
  ok(A.room && A.room.you.host && A.room.seats[0].dragon === 'sun', '建立房間後成為房主');
  const id = A.room.id;
  A.send({ type: 'settings', patch: { mode: 'duel', level: 'easy', layout: 'checker', duration: 120000 } });
  A.send({ type: 'invite', role: 'player' }); A.send({ type: 'invite', role: 'spectator' }); await wait(200);
  const invs = A.all('invite');
  const [pTok, sTok] = [invs[0].token, invs[1].token];
  B.send({ type: 'inviteInfo', room: id, token: pTok }); await wait(150);
  ok(B.last('inviteInfo').ok === true && !B.room, '查詢邀請不會自動入房');
  B.send({ type: 'join', room: id, token: pTok, name: '乙', dragon: 'frost' }); await wait(200);
  ok(B.room && B.room.you.role === 'player', '邀請 token 決定玩家身分');
  S.send({ type: 'join', room: id, token: sTok, name: '觀', as: 'player' }); await wait(200);
  ok(S.room && S.room.you.role === 'spectator', '觀戰 token 即使要求 as=player 仍是觀戰者');
  A.send({ type: 'start' }); await wait(200);
  ok(A.last('error') && A.last('error').code === 'notready', '有人沒準備好時不能開始');
  B.send({ type: 'ready', value: true }); await wait(200);
  A.send({ type: 'start' });
  await Promise.all([A.waitFor('start', 4000 * SLOW), B.waitFor('start', 4000 * SLOW), S.waitFor('start', 4000 * SLOW)]);
  ok(A.last('start').slot === 0 && B.last('start').slot === 1 && S.last('start').slot === -1, 'start：玩家有 slot，觀戰者沒有操作席位');
  await wait(3300);
  for (let i = 0; i < 6; i++) { (i % 2 ? B : A).send({ type: 'shot', a: 3000 + i * 1500 }); await wait(330); }
  await wait(400);
  ok(A.stats.evCount >= 6 && A.stats.evCount === B.stats.evCount && B.stats.evCount === S.stats.evCount, '三人收到相同數量的事件（' + A.stats.evCount + '）');
  ok(JSON.stringify(boardHashes(A.m)) === JSON.stringify(boardHashes(B.m)) && JSON.stringify(boardHashes(A.m)) === JSON.stringify(boardHashes(S.m)), '三人的盤面雜湊一致');
  A.send({ type: 'revoke' }); await wait(150);
  C.send({ type: 'join', room: id, token: pTok, name: '丙' }); await wait(150);
  ok(C.last('joinFailed') && C.last('joinFailed').reason === 'revoked', '撤銷後的邀請不能用');
  A.send({ type: 'leave' }); await wait(150);
  ok(B.last('left') && B.last('left').slot === 0, '對局中離開 → 其他人收到 left');
  B.send({ type: 'leave' }); await wait(300);
  ok(S.last('closed') && !S.room, '真人全數離開 → 觀戰者收到 closed，房間關閉');
  C.send({ type: 'join', room: id, as: 'spectator' }); await wait(150);
  ok(C.last('joinFailed') && C.last('joinFailed').reason === 'closed', '已關閉的房間無法重新進入');
  for (const x of [A, B, S, C]) x.close();
  if (server) server.close(); await wait(100);
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
