# 彩虹泡泡砲

可愛風泡泡龍（原創角色與名稱）。單機＋四段電腦、線上房間、觀戰、邀請連結；平板觸控優先。
後端零依賴（只需要 Node.js 22 以上，WebSocket 是 `lib/ws.js` 自己寫的），前端是純靜態檔。

## 玩法與模式

- 泡泡龍規則：發射泡泡、三顆同色以上消除、懸空的泡泡掉落；彩虹泡泡可變色。難度 幼幼班／簡單／普通／困難（欄數 9／10／12／14、泡泡種類 3／5／7／9、下壓與「陌生色」機率逐級提高）。
- 競速（race）：每人各一個盤面（同一個版型與種子），時間到或有人清光，比清除數。
- 對打（duel）：清除的泡泡換成送給對手的泡泡（先預告、可被自己的消除抵銷）。
- 線上：2～4 人、房間列表、快速加入、建立房間、房主設定（模式／難度／版型／主題／時間／人數／公開／觀戰）、玩家／觀戰者（上限 20）、邀請連結（24 小時、可撤銷）、聊天室。房主可在等待室加入／移除電腦席位（真人＋電腦合計最多 4 位，各自選四段難度），電腦由伺服器代打、走和真人一樣的事件管線；1 位真人＋1 個電腦就能開局。
- 伺服器是裁判：玩家只送「發射角度／交換」，伺服器用 `public/js/match.js` 產生事件並廣播，所有客戶端重播同一串事件，盤面逐位元一致；每 2 秒對一次雜湊，不一致就整盤重送。

## 本機執行

```bash
node server.js          # http://localhost:3140
```

Windows 可雙擊 `啟動遊戲.bat`（埠號 3140）。同一個 Wi-Fi 的平板／手機開終端機顯示的區網網址即可。

## 測試

```bash
npm run verify          # 全部：規則、房間、伺服器整合、線上流程、網路一致性
npm test                # 不含 scripts/ 的兩支（較快）
node tests/verify.js    # 規則核心、對局事件、電腦難度、重播一致性
node tests/rooms.js     # 房間生命週期、邀請、觀戰、踢人、寬限、零真人關閉、對局流程（假時鐘）
node tests/server.js    # 真的 HTTP＋WebSocket：靜態檔路徑、CORS、封包防呆、兩人對局、hash／resync、result
node scripts/online-check.js                 # 端對端冒煙（SERVER=網址 可改測已部署的伺服器）
node scripts/netcode-check.js --lag=100      # 單向延遲 100 ms 下，兩人各發射 20 次，檢查全部收斂到相同盤面
```

`netcode-check.js` 參數：`--lag=<ms>`（單向延遲，預設 0）、`--shots=<每人發數>`（預設 20）、`--gap=<發射間隔 ms>`（預設 340）。

## 部署（GitHub Pages ＋ Render）

1. **後端（Render）**：用 `render.yaml` 建立 Web Service（服務名 `rainbow-bubble-server`、免費方案、區域 Singapore），啟動指令 `node server.js`，健康檢查 `/health`。環境變數 `GAME_ALLOWED_ORIGIN` 填前端網址，例如 `https://帳號.github.io`。
2. **前端（GitHub Pages）**：Settings → Pages 選 GitHub Actions；Settings → Variables 新增 `GAME_SERVER_URL`＝後端的 https 網址。推到 `main` 後 `.github/workflows/pages.yml` 會跑測試、用 `scripts/inject-server-url.js` 把網址寫進 `public/js/config.js` 並部署 `public/`。
3. 也可臨時用網址參數：`https://前端/?server=https://後端`。
4. 容器平台（Cloud Run 等）：`Dockerfile` 只打包 `server.js`、`lib/`、`public/`，不需要 npm install。

| 變數 | 位置 | 說明 |
|---|---|---|
| `PORT` | 後端 | 預設 3140（Render 會自動注入） |
| `GAME_ALLOWED_ORIGIN` | 後端 | 允許的前端 origin，逗號分隔；留空或 `*` 代表不限制（只建議本機開發） |
| `GAME_SERVER_URL` | Pages Variable／本機 `.env.example` | 前端連線位置，唯一入口是 `public/js/config.js` |

Render 免費方案閒置會休眠，首次連線約 30～60 秒；房間只存在記憶體，重啟即消失。

## 線上協定摘要

完整欄位見 [docs/連線協定.md](docs/連線協定.md)。

- 連線：`hello{key,name,dragon}` → `welcome`；`ping{t}` → `pong{t}`。
- 房間：`create` `quick` `join{room,as,token}` `inviteInfo` `leave` `ready{value}` `sit` `watch` `settings{patch}` `kick{seat}` `chat{text}` `invite{role}` `revoke` `start` `rematch`；伺服器回 `rooms` `room` `joined` `joinFailed` `invite` `chat` `chatlog` `closed` `kicked` `error` `replaced`。
- 對局：`start{cfg,slot,t0Wall,goIn}` → 倒數 3 秒 → 玩家送 `shot{a}`／`swap`，伺服器廣播 `ev{evs,mt}`；每 2 秒 `clock{mt}`、`hash{seq,h}`；不一致送 `resync` → `sync{snap}`；`left{slot}`；結束 `result{result}`，約 0.5 秒後回到房間。
- 座位上的真人降到 0 → 房間自動關閉（邀請失效、全員收到 `closed`，不會因重連復活）。斷線寬限 30 秒。

## 目錄

```
server.js                HTTP ＋ WebSocket 入口、/health、/api/presence、CORS
lib/ws.js                自製 WebSocket（RFC 6455）
lib/rooms.js             房間／席位／觀戰／邀請／聊天／權威對局（純邏輯，可不開網路測試）
public/js/matchsnap.js         整場對局快照 snapshotAll／restoreAll（伺服器與瀏覽器共用）
public/js/               rules／match／ai／layouts／art-*／ui／net／config／storage … 前端與伺服器共用的規則
tests/ scripts/          測試與檢查腳本
docs/連線協定.md          線上訊息格式
```

## 已知事項

- 約 8% 的隨機版型（例如 `cross`、`cat`、`turtle`、`star`）可以用一發正上方（90°）的射擊整盤清光，對局會立刻以 `clear` 結束。這是規則／版型層的特性，伺服器不處理；測試的對局一律固定使用 `checker` 版型避免干擾。
