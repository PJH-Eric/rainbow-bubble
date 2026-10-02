/* ===== server.js — 靜態檔案 ＋ 房間伺服器（零依賴） =====
 *
 * 靜態檔案用 Node 內建 http，連線用 lib/ws.js（原生 WebSocket），
 * 整個專案不需要 npm install：雙擊「啟動遊戲.bat」就能玩，丟到 Render 也一樣。
 *
 *   lib/rooms.js   房間、席位、觀戰、邀請、聊天、權威對局（純邏輯）
 *   這一支          HTTP、WebSocket、訊息分派與廣播
 *
 * 環境變數：PORT（預設 3140）、GAME_ALLOWED_ORIGIN（前端來源，預設 *）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ws = require('./lib/ws.js');
const { createHub } = require('./lib/rooms.js');

const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

function createServer(opt) {
  opt = opt || {};
  const allow = opt.allowOrigin || process.env.GAME_ALLOWED_ORIGIN || process.env.ALLOW_ORIGIN || '*';
  const allowList = allow === '*' ? null : allow.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const originOk = origin => {
    if (!allowList) return true;
    if (!origin) return true;                     /* 同源（直接開伺服器網址）不帶 Origin */
    return allowList.indexOf(String(origin).replace(/\/+$/, '')) >= 0;
  };
  const sockets = new Map();                      /* key → socket */

  const hub = createHub({
    now: opt.now,
    emit(key, msg) { const s = sockets.get(key); if (s && s.alive) s.sendJSON(msg); }
  });

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && originOk(origin)) res.setHeader('Access-Control-Allow-Origin', allowList ? origin : '*');
    res.setHeader('Vary', 'Origin');
  }
  function json(req, res, code, data) {
    cors(req, res);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
    /* %00 會讓 fs.readFile 同步丟例外，整個伺服器跟著掛掉 */
    if (urlPath.indexOf('\0') >= 0) { res.writeHead(400); res.end(); return; }
    if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204); res.end(); return; }
    if (urlPath === '/health') { json(req, res, 200, { ok: true, game: 'rainbow-bubble', uptime: Math.round(process.uptime()) }); return; }
    if (urlPath === '/api/presence') { json(req, res, 200, Object.assign({ gameId: 'rainbow-bubble' }, hub.stats(), { updatedAt: new Date().toISOString() })); return; }
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(ROOT, urlPath));
    if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('找不到頁面'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });

  ws.attach(server, {
    path: '/ws',
    verify: req => originOk(req.headers.origin),
    onConnection(socket) {
      let key = null;
      const helloTimer = setTimeout(() => { if (!key) socket.close(); }, 5000);
      socket.on('message', text => {
        if (text.length > 4000) return;
        let msg = null;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (!msg || typeof msg.type !== 'string') return;
        if (!key) {
          /* 先驗格式再收：清掉怪字元後變空字串的 key 會讓這條連線永遠收不到回應、也不會被清掉 */
          if (msg.type !== 'hello' || typeof msg.key !== 'string' || !/^[\w-]{8,64}$/.test(msg.key)) return;
          key = msg.key;
          clearTimeout(helloTimer);
          const old = sockets.get(key);
          if (old && old !== socket) { old.sendJSON({ type: 'replaced' }); old.alive = false; try { old.raw.end(); } catch (e) { /* 已斷 */ } setTimeout(() => old.raw.destroy(), 2000).unref(); }
          sockets.set(key, socket);
          hub.connect(key, msg);
          return;
        }
        hub.handle(key, msg);
      });
      socket.on('close', () => {
        clearTimeout(helloTimer);
        if (key && sockets.get(key) === socket) { sockets.delete(key); hub.disconnect(key); }
      });
    }
  });

  const tickTimer = setInterval(() => hub.tick(), 20);
  const beat = setInterval(() => {
    const t = Date.now();
    for (const s of sockets.values()) {
      if (t - s.lastSeen > 45000) s.close(); else s.ping();
    }
  }, 15000);
  server.on('close', () => { clearInterval(tickTimer); clearInterval(beat); });

  return { server, hub, sockets };
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3140;
  const { server } = createServer();
  server.on('error', e => {
    if (e && e.code === 'EADDRINUSE') console.error('埠號 ' + PORT + ' 已經有程式在用了。換一個：PORT=3121 node server.js（Windows：set PORT=3121 再執行）');
    else console.error('伺服器啟動失敗：' + (e && e.message));
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log('彩虹泡泡砲 已啟動：http://localhost:' + PORT);
    const lan = lanAddress();
    if (lan) console.log('同一個 Wi-Fi 的平板／手機可開：http://' + lan + ':' + PORT);
  });
}

module.exports = { createServer };
