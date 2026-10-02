/* ===== scripts/netcode-check.js — 網路延遲下的對局一致性檢查 =====
 *
 * 啟動（或連到）伺服器，兩位玩家各連續發射約 20 次、另有一位觀戰者，
 * 在「送出與收到各延遲 --lag 毫秒」的情況下檢查：
 *   1. 所有客戶端重播出的盤面雜湊完全一致（也等於伺服器上的對局）
 *   2. 伺服器沒有拒絕任何正當的發射（冷卻丟棄數 = 0，每一發都變成 shot 事件）
 *   3. hash 對帳沒有出現不一致，要求 sync 後的快照與本機盤面相同
 *
 * 用法：
 *   node scripts/netcode-check.js                      無延遲
 *   node scripts/netcode-check.js --lag=100            單向延遲 100 ms（來回約 200 ms）
 *   node scripts/netcode-check.js --lag=250 --shots=30 --gap=320
 *   SERVER=https://xxx.onrender.com node scripts/netcode-check.js --lag=0   測遠端（無法讀伺服器內部，改以 sync 對照）
 *
 * 延遲用計時器模擬（兩個方向都延遲，順序不變）。
 */
'use strict';
const { createServer } = require('../server.js');
const MatchSnap = require('../public/js/matchsnap.js');
const { client, attachMatch, boardHashes, wait } = require('../tests/wsclient.js');

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? Number(a.split('=')[1]) : def; };
const LAG = arg('lag', 0), SHOTS = arg('shots', 20), GAP = arg('gap', 340);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  let server = null, hub = null, base = (process.env.SERVER || '').replace(/\/+$/, '');
  if (!base) {
    const s = createServer({ allowOrigin: '*' });
    server = s.server; hub = s.hub;
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  const tag = Date.now().toString(36);
  console.log('網路一致性檢查：單向延遲 ' + LAG + ' ms、每人 ' + SHOTS + ' 發、間隔 ' + GAP + ' ms、伺服器 ' + (hub ? '本機內建' : base));
  const mk = (k, n, o) => attachMatch(client(base, tag + '-net-' + k, n, Object.assign({ lag: LAG }, o)));
  const A = mk('a', '甲'), B = mk('b', '乙', { dragon: 'moon' }), S = mk('s', '觀');
  await Promise.all([A.open, B.open, S.open]);
  await A.waitFor('rooms');
  A.send({ type: 'create', roomName: '網路檢查', name: '甲' });
  await A.waitFor('joined'); await A.waitRoom();
  const id = A.room.id;
  A.send({ type: 'settings', patch: { mode: 'duel', level: 'normal', layout: 'checker', duration: 300000 } });
  B.send({ type: 'join', room: id, name: '乙' }); await B.waitFor('joined');
  B.send({ type: 'ready', value: true });
  S.send({ type: 'join', room: id, as: 'spectator' }); await S.waitFor('joined');
  await wait(LAG * 3 + 150);
  A.send({ type: 'start' });
  const st = await A.waitFor('start');
  const startAt = Date.now();
  /* 用 start 的 goIn 對時：t0 ≈ 收到 start 的時間 + goIn − 單向延遲（start 在路上耗掉一半的來回） */
  await wait(Math.max(0, st.goIn - LAG) + 120);

  const sent = [0, 0];
  const rtts = [];
  const shooter = async (c, slot) => {
    for (let i = 0; i < SHOTS; i++) {
      c.send({ type: 'shot', a: 2800 + ((i * 1471 + slot * 3331) % 12400) });
      sent[slot]++;
      if (i % 7 === 3) c.send({ type: 'swap' });
      await wait(GAP + (i % 3) * 15);
    }
  };
  /* 兩人幾乎同時開打：A 先、B 錯開半個間隔 */
  await Promise.all([shooter(A, 0), wait(Math.floor(GAP / 2)).then(() => shooter(B, 1))]);
  /* 多等一輪來回，讓最後的事件和一次 hash 都送達 */
  await wait(LAG * 3 + 2300);

  const evs = c => c.all('ev').flatMap(m => m.evs);
  const shotsSeen = c => evs(c).filter(e => e.e === 'shot');
  console.log('\n結果');
  ok(!A.over && !B.over, '對局還在進行（沒有提早分出勝負）；' + (A.over ? '已結束：' + (A.result && A.result.reason) : '進行中'));
  ok(shotsSeen(A).length === sent[0] + sent[1], '每一發都被伺服器接受並廣播成 shot 事件（送出 ' + (sent[0] + sent[1]) + '、收到 ' + shotsSeen(A).length + '）');
  ok(shotsSeen(A).filter(e => e.s === 0).length === sent[0] && shotsSeen(A).filter(e => e.s === 1).length === sent[1], '兩位玩家的發射數分別對得上（' + sent.join('／') + '）');
  if (hub) ok(hub.counters.shotsDropped === 0 && hub.counters.inputEarly === 0, '伺服器沒有拒絕任何正當輸入（冷卻丟棄 ' + hub.counters.shotsDropped + '、倒數中 ' + hub.counters.inputEarly + '）');
  ok(same(evs(A), evs(B)) && same(evs(A), evs(S)), '三個客戶端收到相同的事件串（' + evs(A).length + ' 個事件）');
  const hA = boardHashes(A.m), hB = boardHashes(B.m), hS = boardHashes(S.m);
  ok(same(hA, hB) && same(hA, hS), '三個客戶端的盤面雜湊一致：' + hA.join(', '));
  if (hub) {
    const srv = [...hub._rooms.values()][0].match.m;
    ok(same(hA, boardHashes(srv)), '與伺服器上的對局雜湊相同');
  }
  ok(A.stats.mismatch + B.stats.mismatch + S.stats.mismatch === 0, 'hash 對帳沒有不一致（對帳 ' + A.stats.hashes + '／' + B.stats.hashes + '／' + S.stats.hashes + ' 次，因 seq 還沒追上而略過 ' + (A.stats.skipped + B.stats.skipped + S.stats.skipped) + ' 次）');
  /* 向伺服器要一份完整快照，與本機逐位元相同 */
  for (const [n, c] of [['A', A], ['B', B], ['S', S]]) {
    const before = c.count('sync');
    const local = boardHashes(c.m), localSeq = c.m.seq;   /* 先記下本機重播的結果（收到 sync 後 c.m 會被換掉） */
    c.send({ type: 'resync' });
    await c.waitFor(() => c.count('sync') > before, 3000 + LAG * 4).catch(() => {});
    const snap = c.last('sync');
    const synced = snap ? MatchSnap.restoreAll(snap.snap) : null;
    ok(synced && same(boardHashes(synced), local) && synced.seq === localSeq, '客戶端 ' + n + '：向伺服器要快照，與本機重播結果相同（seq ' + (synced && synced.seq) + '）');
  }
  const errs = [A, B, S].reduce((n, c) => n + c.count('error'), 0);
  ok(errs === 0, '沒有收到任何 error');

  console.log('\n摘要');
  console.log('  延遲 ' + LAG + ' ms／單向，總事件 ' + evs(A).length + '，發射 ' + (sent[0] + sent[1]) + '，歷時 ' + ((Date.now() - startAt) / 1000).toFixed(1) + ' 秒');
  console.log('  clock 訊息 ' + A.count('clock') + ' 次、hash 訊息 ' + A.count('hash') + ' 次');
  if (hub) console.log('  伺服器計數：' + JSON.stringify(hub.counters));
  for (const c of [A, B, S]) c.close();
  if (server) server.close();
  await wait(100);
  console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
