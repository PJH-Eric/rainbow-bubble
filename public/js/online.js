/* ===== online.js — 線上大廳、房間、邀請連結，以及把伺服器訊息接到畫面上 =====
 * 伺服器位置一律從 Config / Net 取得，這裡不寫任何網址。
 * 協定見 docs/連線協定.md。
 */
(function (root) {
  'use strict';
  const { h, btn, toggle, stepper, avatar, toast, modal } = root.UI;
  const Art = root.Art, Net = root.Net, R = root.Rules;
  const App = root.App;
  const U = App.util;

  const REASONS = {
    invalid: '這個邀請連結無效，請向房主要一條新的。',
    revoked: '房主已經撤銷這個邀請連結。',
    expired: '這個邀請連結已經過期。',
    closed: '這個房間已經結束了。'
  };
  const ERRORS = {
    banned: '你已被請出這個房間，不能再加入。',
    spec_full: '觀戰席已經滿了。',
    spec_off: '這個房間不開放觀戰。',
    full: '席位已經滿了（真人和電腦合計最多 4 位）。',
    max: '人數上限不能比目前坐著的人還少。',
    few: '至少 2 位才能開始，點空位可加電腦。',
    offline: '有玩家斷線了，等他回來再開始。',
    notready: '還有玩家沒有按「準備好」。'
  };
  const PHASE = { room: '等待中', countdown: '倒數中', playing: '對戰中' };
  const PHASE_CLS = { room: 'mint', countdown: 'sun', playing: 'pink' };
  /* 與單機（app.js）同一份電腦等級說明 */
  const AI_HINT = { baby: '慢慢來、常亂射', easy: '偶爾失手', normal: '穩穩消除', hard: '又快又準' };
  const AI_LEVELS = (root.AI && root.AI.LEVEL_ORDER) || ['baby', 'easy', 'normal', 'hard'];
  const AI_DD = AI_LEVELS.map(k => ({ v: k, label: R.LEVEL_NAME[k], hint: AI_HINT[k] }));
  const MODE_NAME = { race: '各自比賽', duel: '送泡泡對打' };
  const FOCUS_SEL = 'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

  App.room = App.room || null;
  App.rooms = App.rooms || [];
  App.invite = App.invite || null;
  App.netStatus = 'idle';
  App.lobbyUI = null;
  App.roomUI = null;
  let wakeSecs = 0;
  let roomChat = null;
  let closedModal = null;
  let lastChatAt = 0;

  /* ---------- 小工具 ---------- */
  const profile = () => ({ name: U.myName(), dragon: App.store.dragon });
  const online = () => Net.connected;
  const isOnlineGame = () => App.screen === 'game' && App.game && App.game.kind === 'online';
  const inOnlineScreen = () => App.screen === 'lobby' || App.screen === 'room' || isOnlineGame();

  /** 重畫一塊區域，並把鍵盤焦點還給「同一個位置」的控制項 */
  function repaint(box, build) {
    const act = document.activeElement;
    let idx = -1;
    if (act && box.contains(act)) idx = Array.from(box.querySelectorAll(FOCUS_SEL)).indexOf(act);
    box.textContent = '';
    build(box);
    if (idx >= 0) { const f = box.querySelectorAll(FOCUS_SEL)[idx]; if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
  }
  /** 內容沒變就不重畫（保住輸入中的文字與開著的選單） */
  function patch(box, sig, build) {
    if (box._sig === sig) return;
    box._sig = sig;
    repaint(box, build);
  }
  function field(label, ctl) { return h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'ctl' }, ctl)); }
  function put(el) { for (let i = 1; i < arguments.length; i++) if (arguments[i]) el.append(arguments[i]); return el; }
  function pill(text, cls) { return h('span', { class: 'pill' + (cls ? ' ' + cls : '') }, text); }

  let profT = 0;
  function syncProfile() {
    clearTimeout(profT);
    profT = setTimeout(() => {
      const p = profile();
      Net.setProfile(p);
      Net.send({ type: 'profile', name: p.name, dragon: p.dragon });
    }, 500);
  }

  function inviteLink(tok) {
    const p = new URLSearchParams();
    p.set('room', App.room.id); p.set('t', tok);
    let srv = '';
    try { srv = new URLSearchParams(location.search).get('server') || ''; } catch (e) { srv = ''; }
    let s = '?' + p.toString();
    if (srv) s += '&server=' + encodeURIComponent(srv);
    return location.origin + location.pathname + s;
  }
  /** 只拿掉邀請參數；?server= 要留著，不然重新整理就連不到同一台伺服器 */
  function clearInviteUrl() {
    try {
      const u = new URL(location.href);
      if (!u.searchParams.has('room') && !u.searchParams.has('t') && !u.searchParams.has('invite')) return;
      u.searchParams.delete('room'); u.searchParams.delete('t'); u.searchParams.delete('invite');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* 忽略 */ }
  }
  function statusInfo() {
    const s = App.netStatus, C = root.Config || {};
    if (C.status === 'invalid') return { cls: 'bad', text: '伺服器設定有誤' };
    if (s === 'unset' || C.status === 'unset') return { cls: 'bad', text: '尚未設定伺服器' };
    if (s === 'open') return { cls: '', text: '已連線' };
    if (s === 'waking') return { cls: 'warn', text: '伺服器睡醒中…' };
    if (s === 'offline') return { cls: 'bad', text: '連不上伺服器' };
    if (s === 'retrying') return { cls: 'warn', text: '重新連線中…' };
    if (s === 'idle') return { cls: 'bad', text: '未連線' };
    return { cls: 'warn', text: '連線中…' };
  }
  function layoutName(id) {
    if (id === 'random') return '隨機地圖';
    const f = (root.Layouts.list() || []).find(x => x.id === id);
    return f ? f.name : String(id);
  }
  function rulesSummary(s) {
    const th = s.theme === 'random' ? '隨機主題' : ((Art.THEMES[+s.theme] || {}).name || '主題');
    return [MODE_NAME[s.mode] || s.mode, R.LEVEL_NAME[s.level] || s.level, layoutName(s.layout), th,
      s.duration ? (s.duration / 60000) + ' 分鐘' : '不限時', s.publicRoom ? '公開房間' : '私人房間', s.allowSpectators ? '可觀戰' : '不開放觀戰'];
  }

  /* ================= 聊天元件（房間用；對局裡的聊天由 game.js 負責） ================= */
  function sendChat(text) {
    const t = String(text || '').trim().slice(0, 60);
    if (!t) return false;
    const now = Date.now();
    if (now - lastChatAt < 500) { toast('說慢一點點喔～'); return false; }
    lastChatAt = now;
    return Net.send({ type: 'chat', text: t });
  }
  function createChat() {
    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': '聊天紀錄' });
    const input = h('input', { class: 'text-input', type: 'text', maxlength: 60, placeholder: '說點什麼…', 'aria-label': '聊天訊息', autocomplete: 'off', enterkeyhint: 'send' });
    const send = () => { if (sendChat(input.value)) input.value = ''; };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); send(); } });
    const quick = ['好棒！', '加油！', '準備好了'].map(t => h('button', { type: 'button', onClick: () => sendChat(t) }, t));
    const el = h('div', { class: 'room-chat' }, log, h('div', { class: 'quick-chat' }, quick), h('div', { class: 'chat-form' }, input, btn('送出', { cls: 'btn-sm', onClick: send })));
    const line = m => {
      const sys = m.role === 'sys';
      return h('div', { class: 'msg' + (sys ? ' sys' : '') + (m.role === 'spectator' ? ' spec' : '') }, sys ? null : h('b', null, m.name + (m.role === 'spectator' ? '（觀戰）' : '') + '：'), m.text);
    };
    const bottom = () => { log.scrollTop = log.scrollHeight; };
    return {
      el, input,
      push(m) { log.appendChild(line(m)); while (log.children.length > 80) log.removeChild(log.firstChild); bottom(); },
      set(list) { log.textContent = ''; list.forEach(m => log.appendChild(line(m))); bottom(); }
    };
  }

  /* ================= 對外介面 ================= */
  const Online = {
    chat: [],
    addChat(m) {
      this.chat.push(m);
      while (this.chat.length > 80) this.chat.shift();
      if (App.screen === 'game' && App.game && App.game.addChat) App.game.addChat(m);
      if (roomChat && roomChat.el.isConnected) roomChat.push(m);
    },
    resetChat(list) {
      this.chat.length = 0;
      (list || []).slice(-80).forEach(m => this.chat.push(m));
      if (App.screen === 'game' && App.game && App.game.chatLog) { App.game.chatLog.textContent = ''; this.chat.forEach(m => App.game.addChat(m, true)); }
      if (roomChat && roomChat.el.isConnected) roomChat.set(this.chat);
    },
    /** 對局結果「再來一局」：告訴伺服器我想再玩，然後回房間等 */
    again() {
      if (!App.room) return App.go('lobby');
      Net.send({ type: 'rematch' });
      App.go('room');
    },
    toRoom() { if (!App.room) return App.go('lobby'); App.go('room'); },
    /** 離開對局：放棄這一局，回到大廳的房間列表 */
    abandonToLobby() {
      Net.send({ type: 'leave' });
      this.clearRoom();
      App.banner('');
      App.go('lobby');
    },
    leaveToHome() {
      Net.send({ type: 'leave' });
      this.clearRoom();
      App.banner('');
      App.go('home');
    },
    confirmLeave() {
      const r = App.room;
      const spec = r && r.you && r.you.role === 'spectator';
      root.UI.confirmBox({
        title: spec ? '不看了嗎？' : '要離開房間嗎？',
        text: spec ? '離開後就不再觀戰囉。' : (r && r.you && r.you.host ? '你是房主，離開後房主會換給下一位玩家。' : '離開後座位會讓給別人喔。'),
        ok: '離開', cancel: '留下來', danger: true,
        onOk: () => { Net.send({ type: 'leave' }); Online.leaveToLobby(); }
      });
    },
    clearRoom() { App.room = null; this.chat.length = 0; root.UI.closeAllModals(); closedModal = null; },
    /** 回到大廳（房間已不在了）；notice 會顯示在大廳最上面 */
    leaveToLobby(notice) {
      this.clearRoom();
      if (notice) App.lobbyNotice = notice;
      App.go('lobby');
    }
  };
  root.Online = Online;

  /* ================= 大廳 ================= */
  App.screens.lobby = function () {
    const ui = App.lobbyUI = {};
    const C = root.Config || {};

    if (C.status !== 'ok') {
      /* 沒有伺服器設定：只說明，並導回首頁 */
      return U.screenBox('', h('div', { class: 'wrap' },
        U.topbar('跟別人玩', () => App.go('home')),
        h('section', { class: 'card lobby-unset' }, h('h3', null, '還沒設定線上伺服器'),
          h('p', null, C.status === 'invalid' ? ('伺服器網址有問題：' + (C.error || '')) : '線上對戰需要先設定伺服器網址（GAME_SERVER_URL）才能使用。'),
          h('p', { class: 'muted small', style: { marginTop: '6px' } }, '現在還是可以一個人玩，跟電腦比賽喔！'),
          h('div', { class: 'row', style: { marginTop: '12px' } },
            btn('回首頁', { cls: 'btn-pink', icon: 'home', onClick: () => App.go('home') }),
            btn('一個人玩', { cls: 'btn-sky', icon: 'robot', onClick: () => App.go('solo') })))));
    }

    ui.statusBox = h('span', { class: 'lobby-status' });
    ui.wakeBox = h('div');
    ui.noticeBox = h('div');
    ui.inviteBox = h('div');
    ui.profileCard = h('section', { class: 'card' }, h('h3', null, '我'));
    ui.actionCard = h('section', { class: 'card' });
    ui.listBox = h('div', { class: 'room-list', 'aria-live': 'polite' });
    const prof = App.profileEditor({ onChange: syncProfile });
    ui.profileCard.appendChild(prof.el);

    ui.paintStatus = () => {
      const si = statusInfo();
      ui.statusBox.textContent = '';
      ui.statusBox.appendChild(h('span', { class: 'status ' + si.cls, role: 'status' }, h('i'), si.text));
      repaint(ui.wakeBox, box => {
        const s = App.netStatus;
        if (s === 'waking' || s === 'connecting') {
          box.appendChild(h('section', { class: 'card wake-card' },
            h('div', { class: 'wake-art' }, avatar(App.store.dragon, 56), h('div', { class: 'grow' },
              h('b', null, s === 'waking' ? '小龍伺服器正在睡醒…' : '正在連線…'),
              h('div', { class: 'muted small' }, s === 'waking' ? '免費主機睡著了，叫醒它要 30～90 秒，等一下下就好！' + (wakeSecs ? '（已等 ' + wakeSecs + ' 秒）' : '') : '稍等一下喔。')))));
        } else if (s === 'offline' || s === 'retrying') {
          box.appendChild(h('section', { class: 'card wake-card' },
            h('div', { class: 'wake-art' }, h('div', { class: 'grow' }, h('b', null, s === 'offline' ? '暫時連不上伺服器' : '連線中斷了'), h('div', { class: 'muted small' }, '會自動再試，也可以手動重試。')),
              btn('重試', { cls: 'btn-sky btn-sm', icon: 'refresh', iconSize: 18, onClick: () => Net.open(profile()) }))));
        }
      });
      ui.paintActions();
    };
    ui.paintNotice = () => {
      ui.noticeBox.textContent = '';
      if (App.lobbyNotice) {
        ui.noticeBox.appendChild(h('section', { class: 'card notice', role: 'status' }, h('p', null, App.lobbyNotice),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, btn('知道了', { cls: 'btn-mint btn-sm', onClick: () => { App.lobbyNotice = ''; ui.paintNotice(); } }))));
      }
    };

    /* 開始：快速加入、建立房間、輸入代碼 */
    const codeIn = h('input', {
      class: 'text-input code-input', type: 'text', maxlength: 4, placeholder: '4 個字母', 'aria-label': '房間代碼', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go',
      onInput: () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); },
      onKeydown: e => { e.stopPropagation(); if (e.key === 'Enter') byCode('player'); }
    });
    const byCode = as => {
      const c = codeIn.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) { toast('房間代碼是 4 個英文字母喔'); codeIn.focus(); return; }
      joinRoom(c, as);
    };
    ui.paintActions = () => repaint(ui.actionCard, box => {
      const ok = online();
      box.appendChild(h('h3', null, '開始'));
      box.appendChild(h('div', { class: 'row action-row' },
        btn('快速加入', { cls: 'btn-pink btn-lg', icon: 'play', iconSize: 24, disabled: !ok, onClick: () => Net.send({ type: 'quick', name: U.myName(), dragon: App.store.dragon }) }),
        btn('建立房間', { cls: 'btn-sun btn-lg', icon: 'plus', iconSize: 24, disabled: !ok, onClick: createRoomModal })));
      const codeRow = h('div', { class: 'code-row' }, codeIn,
        btn('加入', { cls: 'btn-mint btn-sm', disabled: !ok, onClick: () => byCode('player') }),
        btn('觀戰', { cls: 'btn-sky btn-sm', icon: 'eye', iconSize: 18, disabled: !ok, onClick: () => byCode('spectator') }));
      box.appendChild(h('div', { class: 'field' }, h('span', { class: 'label' }, '房間代碼'), h('div', { class: 'ctl' }, codeRow)));
    });

    ui.paintList = () => repaint(ui.listBox, box => {
      const list = App.rooms || [];
      if (!online()) { box.appendChild(h('div', { class: 'empty-box' }, '連上伺服器後，這裡會出現房間。')); return; }
      if (!list.length) { box.appendChild(h('div', { class: 'empty-box' }, '現在沒有公開的房間。按「快速加入」或「建立房間」開第一間吧！')); return; }
      for (const r of list) {
        const s = r.settings || {};
        box.appendChild(h('div', { class: 'room-item' },
          h('div', { class: 'info' },
            h('div', { class: 'name' }, r.name),
            h('div', { class: 'chips', style: { marginTop: '4px' } },
              pill('代號 ' + r.id, 'gray'), pill(PHASE[r.phase] || r.phase, PHASE_CLS[r.phase] || 'gray'), pill(r.players + '/' + r.max + ' 位'), r.ais ? pill('🤖 電腦 ' + r.ais) : null,
              r.spectators ? pill('觀戰 ' + r.spectators, 'gray') : null, pill('房主 ' + r.host, 'gray'),
              pill((MODE_NAME[s.mode] || '') + '・' + (R.LEVEL_NAME[s.level] || ''), 'gray'))),
          h('div', { class: 'row', style: { gap: '8px' } },
            r.joinable ? btn('加入', { cls: 'btn-mint btn-sm', onClick: () => joinRoom(r.id, 'player') }) : null,
            s.allowSpectators === false ? null : btn('觀戰', { cls: 'btn-sky btn-sm', icon: 'eye', iconSize: 18, onClick: () => joinRoom(r.id, 'spectator') }))));
      }
    });

    /* 邀請卡：先確認暱稱，按「加入」才真的進房 */
    ui.paintInvite = () => {
      const inv = App.invite;
      const active = !!(inv && !inv.error);
      ui.grid.hidden = active;
      const sig = inv ? [inv.error || '', inv.info ? JSON.stringify(inv.info) : '', !!inv.joining, online()].join('|') : '';
      if (ui.inviteBox._sig === sig) return;
      ui.inviteBox._sig = sig;
      ui.inviteBox.textContent = '';
      if (!inv) return;
      const card = h('section', { class: 'invite-card', 'aria-label': '房間邀請' });
      const drop = () => { App.invite = null; clearInviteUrl(); ui.paintInvite(); };
      if (inv.error) {
        put(card, h('h3', null, '這個邀請不能用'), h('p', null, REASONS[inv.error] || '邀請連結無法使用。'),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, btn('回到大廳', { cls: 'btn-mint', onClick: drop })));
      } else if (!inv.info) {
        put(card, h('h3', null, '正在確認邀請…'), h('p', { class: 'muted' }, online() ? '稍等一下，正在向伺服器確認房間。' : '等待連上伺服器…（主機睡著時要 30～90 秒）'),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, btn('不加入', { cls: 'btn-ghost btn-sm', onClick: drop })));
      } else {
        const i = inv.info;
        const spec = i.role === 'spectator' || i.willSpectate;
        let why = '';
        if (i.role !== 'spectator' && i.willSpectate) why = i.phase !== 'room' ? '對局已經開始，這次先以觀戰者進去。' : '玩家席位已滿，這次先以觀戰者進去。';
        if (!App.store.nickname || !App.store.nickname.trim()) { App.store.nickname = U.myName(); U.save(); }
        const prof = App.profileEditor({ onChange: syncProfile });
        put(card, 
          h('h3', { class: 'invite-h' }, h('span', null, '你被邀請加入「'), h('span', { class: 'invite-nm' }, i.name), h('span', null, '」')),
          h('div', { class: 'chips', style: { margin: '6px 0 10px' } },
            pill('代號 ' + i.room, 'gray'), pill(PHASE[i.phase] || i.phase, PHASE_CLS[i.phase] || 'gray'), pill(i.players + '/' + i.max + ' 位'),
            pill(spec ? '你會是觀戰者' : '你會是玩家', spec ? 'sun' : 'mint')),
          why ? h('p', { class: 'hint', style: { marginBottom: '8px' } }, why) : null,
          h('p', { class: 'muted small', style: { marginBottom: '8px' } }, '先確認自己的暱稱，按「加入」才會進房間。' + (spec ? '觀戰者可以看整場比賽，也能聊天。' : '')),
          prof.el,
          h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '10px', marginTop: '10px' } },
            btn('不加入', { cls: 'btn-ghost', onClick: drop }),
            btn(spec ? '進去觀戰' : '加入遊戲', {
              cls: 'btn-pink btn-lg', icon: 'play', iconSize: 22, disabled: !online() || inv.joining,
              onClick: () => {
                inv.joining = true;
                Net.setProfile(profile());
                Net.send({ type: 'join', room: i.room, token: inv.token, name: U.myName(), dragon: App.store.dragon });
                ui.paintInvite();
              }
            })));
      }
      ui.inviteBox.appendChild(card);
    };

    const refresh = root.UI.iconBtn('refresh', '重新整理房間列表', () => { Net.send({ type: 'lobbySub' }); }, 'sm');
    const el = U.screenBox('', h('div', { class: 'wrap' },
      U.topbar('跟別人玩', () => { Net.close(); App.banner(''); App.go('home'); }, ui.statusBox),
      ui.wakeBox, ui.noticeBox, ui.inviteBox,
      ui.grid = h('div', { class: 'room-grid' },
        h('div', { class: 'col' }, ui.profileCard, ui.actionCard),
        h('section', { class: 'card' }, h('h3', null, '房間列表', h('span', { class: 'grow' }), refresh), ui.listBox))));
    ui.paintStatus(); ui.paintNotice(); ui.paintList(); ui.paintInvite();
    Net.open(profile());
    if (online()) { Net.send({ type: 'lobbySub' }); askInvite(); }
    return el;
  };

  function askInvite() {
    const inv = App.invite;
    if (inv && !inv.info && !inv.error && online()) Net.send({ type: 'inviteInfo', room: inv.room, token: inv.token });
  }
  function joinRoom(id, as) { Net.send({ type: 'join', room: id, as, name: U.myName(), dragon: App.store.dragon }); }

  function createRoomModal() {
    let max = 4, pub = true, spec = true;
    const nameIn = h('input', { class: 'text-input', type: 'text', maxlength: 10, placeholder: U.myName() + '的房間', 'aria-label': '房間名稱', autocomplete: 'off', 'data-autofocus': '1' });
    const m = modal({
      title: '建立房間', cls: 'dialog-lg',
      content: h('div', null,
        field('房間名稱', nameIn),
        field('公開房間', toggle({ label: '公開房間（出現在大廳列表）', value: pub, onChange: v => { pub = v; } })),
        field('允許觀戰', toggle({ label: '允許觀戰', value: spec, onChange: v => { spec = v; } })),
        h('p', { class: 'muted small' }, '建立後可調整地圖與時間，再傳連結邀朋友。')),
      actions: [btn('取消', { cls: 'btn-ghost', onClick: () => m.close() }),
        btn('建立', {
          cls: 'btn-pink', icon: 'check', onClick: () => {
            m.close(true);
            Net.send({ type: 'create', name: U.myName(), dragon: App.store.dragon, roomName: nameIn.value.trim().slice(0, 10), max, settings: { publicRoom: pub, allowSpectators: spec } });
          }
        })]
    });
  }

  /* ================= 房間 ================= */
  App.screens.room = function () {
    const ui = App.roomUI = {};
    ui.titleEl = h('h2', null, '房間');
    ui.metaEl = h('div', { class: 'room-meta chips' });
    ui.roleBox = h('div', { class: 'chips' });
    ui.seatsBox = h('div', { class: 'seats' });
    ui.specBox = h('div');
    ui.actBox = h('div');
    ui.setBox = h('div');
    ui.invBox = h('div');
    ui.setCard = h('section', { class: 'card' }, h('h3', null, '規則'), ui.setBox);
    ui.invCard = h('section', { class: 'card' }, h('h3', null, '邀請朋友'), ui.invBox);
    roomChat = createChat();
    roomChat.set(Online.chat);
    ui.chat = roomChat;

    ui.paint = () => {
      const r = App.room;
      if (!r) {
        ui.titleEl.textContent = '進入房間中…';
        ui.metaEl.textContent = '';
        ['seatsBox', 'specBox', 'actBox', 'setBox', 'invBox', 'roleBox'].forEach(k => { ui[k]._sig = null; ui[k].textContent = ''; });
        ui.seatsBox.appendChild(h('div', { class: 'empty-box' }, '正在同步房間資料…'));
        ui.setCard.hidden = true; ui.invCard.hidden = true;
        return;
      }
      const you = r.you, host = you.host;
      ui.titleEl.textContent = r.name;
      patch(ui.metaEl, [r.id, r.phase].join('|'), box => put(box, pill('代號 ' + r.id, 'gray'), pill(PHASE[r.phase] || r.phase, PHASE_CLS[r.phase] || 'gray')));
      patch(ui.roleBox, [you.role, host].join('|'), box => put(box,
        pill(you.role === 'player' ? '你是玩家' : '你是觀戰者', you.role === 'player' ? 'mint' : 'sun'), host ? pill('房主', 'sun') : null));
      patch(ui.seatsBox, JSON.stringify([r.seats, r.hostSeat, you, r.phase, r.max]), paintSeats);
      patch(ui.specBox, JSON.stringify([r.spectators, r.specCap, you.pid, r.settings.allowSpectators]), paintSpectators);
      const filled = r.seats.filter(s => s.kind !== 'empty').length;
      const me = r.seats[you.seat];
      patch(ui.actBox, JSON.stringify([r.phase, you, r.canStart, filled, r.max, me ? me.ready : null]), paintActions);
      patch(ui.setBox, JSON.stringify([r.settings, r.max, filled, host, r.phase]), paintSettings);
      ui.setCard.hidden = false;
      ui.invCard.hidden = !host;
      if (host) patch(ui.invBox, JSON.stringify([r.invites, r.id]), paintInvites);
    };

    const el = U.screenBox('', h('div', { class: 'wrap' },
      h('div', { class: 'topbar' }, root.UI.iconBtn('back', '離開房間', () => Online.confirmLeave()),
        h('div', { class: 'room-head' }, ui.titleEl, ui.metaEl), ui.roleBox),
      h('div', { class: 'room-grid' },
        h('div', { class: 'col' },
          h('section', { class: 'card' }, h('h3', null, '玩家席位'), ui.seatsBox),
          ui.specBox,
          h('section', { class: 'card' }, h('h3', null, '聊天室'), roomChat.el)),
        h('div', { class: 'col' },
          h('section', { class: 'card' }, ui.actBox),
          ui.setCard, ui.invCard))));
    ui.paint();
    Net.open(profile());
    /* 萬一一直等不到房間資料（例如已被關閉），回大廳 */
    setTimeout(() => { if (App.screen === 'room' && !App.room) Online.leaveToLobby(); }, 8000);
    return el;
  };

  function paintSeats(box) {
    const r = App.room, you = r.you, host = you.host, lobby = r.phase === 'room';
    for (const s of r.seats) {
      if (s.kind === 'empty') {
        if (host && lobby) {
        /* 房主：直接點空位就加入一個電腦（等級跟房間難度一樣，之後可在席位上改） */
        const lv = (r.settings && r.settings.level) || 'easy';
        box.appendChild(h('button', { type: 'button', class: 'seat empty can-add', 'aria-label': '在這個空位加入電腦', title: '點一下，加入電腦',
          onClick: () => { if (root.Sound) root.Sound.sfx('click'); Net.send({ type: 'addAI', level: lv }); } },
          h('span', { class: 'seat-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'seat-name' }, '加入電腦'), h('small', { class: 'seat-wait' }, '或等朋友來')));
      } else {
        box.appendChild(h('div', { class: 'seat empty' }, h('span', { class: 'seat-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'seat-name' }, '空位'), h('small', { class: 'seat-wait' }, '等朋友來')));
      }
        continue;
      }
      if (s.kind === 'ai') {
        const rm = host && lobby ? root.UI.iconBtn('close', '移除 ' + s.name, () => Net.send({ type: 'removeAI', seat: s.i }), 'sm') : null;
        const tags = h('div', { class: 'seat-tags' }, pill('🤖 電腦'));
        if (host && lobby) tags.appendChild(root.UI.dropdown({ label: s.name + ' 的難度', cls: 'lvl sm', options: AI_DD, value: s.aiLevel, onChange: v => Net.send({ type: 'setAI', seat: s.i, level: v }) }));
        else tags.appendChild(pill(R.LEVEL_NAME[s.aiLevel] || s.aiLevel, 'mint'));
        box.appendChild(h('div', { class: 'seat ai', 'data-kind': 'ai' },
          h('div', { class: 'seat-line' }, avatar(s.dragon, 40), h('span', { class: 'seat-name', title: s.name }, s.name), rm), tags));
        continue;
      }
      const mine = s.i === you.seat;
      const tags = h('div', { class: 'seat-tags' });
      if (s.i === r.hostSeat) tags.appendChild(pill('房主', 'sun'));
      if (mine) tags.appendChild(pill('你'));
      if (s.i !== r.hostSeat && lobby) tags.appendChild(pill(s.ready ? '準備好了' : '還沒準備', s.ready ? 'mint' : 'gray'));
      if (!s.connected) tags.appendChild(pill('斷線中', 'pink'));
      const kick = host && !mine && lobby
        ? root.UI.iconBtn('close', '請出 ' + s.name, () => root.UI.confirmBox({ title: '請出 ' + s.name + '？', text: '被請出的人不能再加入這個房間。', ok: '請出', danger: true, onOk: () => Net.send({ type: 'kick', seat: s.i }) }), 'sm')
        : null;
      box.appendChild(h('div', { class: 'seat' + (mine ? ' me' : '') + (s.connected ? '' : ' away') },
        h('div', { class: 'seat-line' }, avatar(s.dragon, 40), h('span', { class: 'seat-name' }, s.name), kick), tags));
    }
  }


  function paintSpectators(box) {
    const r = App.room;
    const list = r.spectators || [];
    const card = h('section', { class: 'card' }, h('h3', null, '觀戰席', pill(list.length + '/' + r.specCap, 'gray')));
    if (!list.length) card.appendChild(h('p', { class: 'muted small' }, r.settings.allowSpectators ? '還沒有人在觀戰。觀戰者看得到整場比賽，也能聊天，不佔玩家席位。' : '這個房間不開放觀戰。'));
    else card.appendChild(h('div', { class: 'chips' }, list.map(s => pill(s.name + (s.pid === r.you.pid ? '（你）' : ''), s.pid === r.you.pid ? '' : 'gray'))));
    box.appendChild(card);
  }

  function paintActions(box) {
    const r = App.room, you = r.you, lobby = r.phase === 'room';
    const filled = r.seats.filter(s => s.kind !== 'empty').length;
    const free = filled < r.max;
    box.appendChild(h('h3', null, you.role === 'player' ? (you.host ? '你是房主' : '你是玩家') : '你是觀戰者'));
    const rows = h('div', { class: 'col tight' });
    if (!lobby) {
      rows.appendChild(h('p', { class: 'muted' }, r.phase === 'countdown' ? '馬上開始了！' : '對局進行中…'));
    } else if (you.role === 'player' && you.host) {
      const why = filled < 2 ? '至少 2 位才能開始，點空位加電腦' : (!r.canStart ? '還有人沒按「準備好」或斷線了。' : (r.seats.some(x => x.kind === 'ai') ? '準備好了！電腦會自動就緒。' : '大家都準備好了！'));
      rows.appendChild(btn('開始遊戲', { cls: 'btn-pink btn-lg btn-block', icon: 'play', iconSize: 24, disabled: !r.canStart, onClick: () => Net.send({ type: 'start' }) }));
      rows.appendChild(h('p', { class: 'muted small' }, why));
    } else if (you.role === 'player') {
      const me = r.seats[you.seat];
      rows.appendChild(btn(me.ready ? '取消準備' : '我準備好了', { cls: me.ready ? 'btn-ghost btn-lg btn-block' : 'btn-mint btn-lg btn-block', icon: 'check', iconSize: 24, onClick: () => Net.send({ type: 'ready', value: !me.ready }) }));
      rows.appendChild(h('p', { class: 'muted small' }, me.ready ? '等房主按開始。' : '準備好了就按一下，房主才能開始。'));
      rows.appendChild(btn('改成觀戰', { cls: 'btn-ghost btn-block', icon: 'eye', iconSize: 20, onClick: () => Net.send({ type: 'watch' }) }));
    } else {
      rows.appendChild(btn(free ? '我要加入對戰' : '席位已滿', { cls: 'btn-mint btn-lg btn-block', icon: 'play', iconSize: 24, disabled: !free, onClick: () => Net.send({ type: 'sit' }) }));
      rows.appendChild(h('p', { class: 'muted small' }, free ? '你現在是觀戰者，可以看比賽和聊天。' : '你現在是觀戰者，有空位時才能加入。'));
    }
    rows.appendChild(btn('離開房間', { cls: 'btn-ghost btn-block', onClick: () => Online.confirmLeave() }));
    box.appendChild(rows);
  }

  function paintSettings(box) {
    const r = App.room, s = r.settings, edit = r.you.host && r.phase === 'room';
    const send = patchObj => {
      if (typeof patchObj.theme === 'string' && /^\d+$/.test(patchObj.theme)) patchObj.theme = +patchObj.theme;
      Net.send({ type: 'settings', patch: patchObj });
    };
    const filled = r.seats.filter(x => x.kind !== 'empty').length;
    if (edit) {
      box.appendChild(App.rulesPanel(s, send));
      box.appendChild(field('公開房間', toggle({ label: '公開房間', value: s.publicRoom, onChange: v => send({ publicRoom: v }) })));
      box.appendChild(field('允許觀戰', toggle({ label: '允許觀戰', value: s.allowSpectators, onChange: v => send({ allowSpectators: v }) })));
    } else {
      box.appendChild(h('div', { class: 'chips' }, rulesSummary(s).map(t => pill(t, 'gray'))));
      box.appendChild(h('p', { class: 'muted small', style: { marginTop: '8px' } }, r.you.host ? '對局中不能改設定。' : '只有房主可以調整設定。'));
    }
  }

  /* ---------- 邀請連結（房主） ---------- */
  function paintInvites(box) {
    const r = App.room;
    const invs = (r.invites || []).slice().sort((a, b) => (a.created || 0) - (b.created || 0));
    box.appendChild(h('p', { class: 'muted small' }, '連結只對這個房間有效，24 小時內可用；朋友打開後要先確認暱稱才會進房。'));
    box.appendChild(h('div', { class: 'row', style: { margin: '8px 0' } },
      btn('玩家連結', { cls: 'btn-sky btn-sm', icon: 'link', iconSize: 18, onClick: () => Net.send({ type: 'invite', role: 'player' }) }),
      btn('觀戰連結', { cls: 'btn-sun btn-sm', icon: 'eye', iconSize: 18, onClick: () => Net.send({ type: 'invite', role: 'spectator' }) })));
    if (!invs.length) { box.appendChild(h('p', { class: 'muted small' }, '還沒有連結，按上面的按鈕產生。')); return; }
    const list = h('div', { class: 'col tight invite-list' });
    for (const iv of invs) {
      const url = inviteLink(iv.token);
      list.appendChild(h('div', { class: 'invite-item', 'data-role': iv.role },
        h('div', { class: 'small', style: { fontWeight: '800', marginBottom: '4px' } }, iv.role === 'spectator' ? '觀戰連結' : '玩家連結'),
        h('div', { class: 'link-box' }, h('code', null, url),
          btn('複製', { cls: 'btn-mint btn-sm', icon: 'copy', iconSize: 16, onClick: () => { Promise.resolve(root.UI.copyText(url)).then(ok => toast(ok ? '已複製連結' : '複製失敗，請長按連結手動複製')); } }))));
    }
    box.appendChild(list);
    box.appendChild(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } },
      btn('撤銷全部連結', { cls: 'btn-ghost btn-sm', icon: 'trash', iconSize: 18, onClick: () => root.UI.confirmBox({ title: '撤銷所有邀請連結？', text: '之前發出去的連結都會失效。', ok: '撤銷', danger: true, onOk: () => Net.send({ type: 'revoke' }) }) })));
  }

  /* ================= 房間結束 ================= */
  function showClosed(text) {
    if (closedModal && !closedModal.closed) return;
    const spec = App.room && App.room.you && App.room.you.role === 'spectator';
    const body = h('div', null, h('p', { class: 'dialog-text' }, text || '房間已經結束了。'),
      spec ? h('p', { class: 'muted small', style: { marginTop: '6px' } }, '所有玩家都離開了，比賽結束囉。') : null);
    closedModal = modal({
      title: '房間結束了', content: body, cls: 'dialog-sm', dismissible: false,
      actions: [btn('回到大廳', { cls: 'btn-mint', onClick: () => { closedModal.close(true); closedModal = null; Online.leaveToLobby(); } })]
    });
  }

  /* ================= 伺服器訊息 ================= */
  function init() {
    Net.onStatus((s, detail) => {
      App.netStatus = s;
      wakeSecs = s === 'waking' ? (detail || 0) : 0;
      if (!inOnlineScreen()) { if (!App.replaced) App.banner(''); return; }
      if (!App.replaced) {
        if (s === 'waking') App.banner('伺服器睡醒中…已等 ' + (detail || 0) + ' 秒', true);
        else if (s === 'connecting') App.banner('連線中…', true);
        else if (s === 'retrying') App.banner('連線中斷，正在重新連線…', true);
        else if (s === 'offline') App.banner('連不上伺服器，稍後自動重試', true);
        else App.banner('');
      }
      if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintStatus) { App.lobbyUI.paintStatus(); App.lobbyUI.paintList(); App.lobbyUI.paintInvite(); }
      if (s === 'open') askInvite();
    });

    /* 回到首頁／單機之後，不需要再佔一條連線 */
    setInterval(() => {
      if (!inOnlineScreen() && App.screen !== 'game' && Net.status !== 'idle') { Net.close(); if (!App.replaced) App.banner(''); }
    }, 3000);

    Net.on('welcome', m => {
      App.me = { pid: m.pid, name: m.name, dragon: m.dragon };
      App.room = m.room || null;
      if (!m.room) {
        /* 斷線太久或伺服器重啟：房間已經不在了 */
        if (App.screen === 'room' || isOnlineGame()) {
          if (isOnlineGame() && App.game.resultShown) showClosed('房間已經結束了。');
          else { toast('房間已經結束了', 4200); Online.leaveToLobby('房間已經結束了。'); }
          return;
        }
      } else if (App.screen === 'lobby' && m.room.phase === 'room') App.go('room');
      else if (App.screen === 'room' && App.roomUI) App.roomUI.paint();
      if (App.lobbyUI && App.screen === 'lobby') askInvite();
    });
    Net.on('rooms', m => {
      App.rooms = m.rooms || [];
      if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintList) App.lobbyUI.paintList();
    });
    Net.on('room', m => {
      App.room = m.room || null;
      if (!App.room) {
        if (closedModal && !closedModal.closed) return;
        if (App.screen === 'room') Online.leaveToLobby();
        return;
      }
      if (App.screen === 'room') App.roomUI && App.roomUI.paint();
      else if (App.screen === 'lobby' && App.room.phase === 'room') App.go('room');
    });
    Net.on('joined', m => {
      App.invite = null; clearInviteUrl();
      if (m.note) toast(m.note, 4200);
      if (App.screen !== 'game' && App.screen !== 'room') App.go('room');
    });
    Net.on('joinFailed', m => {
      if (App.invite && App.invite.joining) { App.invite.joining = false; App.invite.error = m.reason; }
      else toast(REASONS[m.reason] || '無法加入這個房間', 3800);
      if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintInvite) App.lobbyUI.paintInvite();
    });
    Net.on('inviteInfo', m => {
      if (!App.invite) return;
      if (m.ok) App.invite.info = m; else App.invite.error = m.reason || 'invalid';
      if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintInvite) App.lobbyUI.paintInvite();
    });
    Net.on('invite', () => { if (App.roomUI && App.screen === 'room') App.roomUI.paint(); });
    Net.on('chatlog', m => Online.resetChat(m.msgs || []));
    Net.on('chat', m => { if (m.m) Online.addChat(m.m); });
    Net.on('closed', m => {
      const text = m.text || '房間已經結束了。';
      if (App.screen === 'room' || isOnlineGame()) showClosed(text);
      else { App.lobbyNotice = text; toast(text, 4200); if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintNotice) App.lobbyUI.paintNotice(); }
    });
    Net.on('kicked', m => {
      const text = m.text || '你被房主請出房間了。';
      toast(text, 4200);
      Online.leaveToLobby(text);
    });
    Net.on('error', m => toast(ERRORS[m.code] || m.text || '發生了一點小問題', 3800));
    Net.on('start', m => {
      root.UI.closeAllModals(); closedModal = null;
      App.go('game', { kind: 'online', cfg: m.cfg, slot: m.slot, t0Wall: m.t0Wall, serverNow: m.serverNow, goIn: m.goIn });
    });
    ['ev', 'clock', 'hash', 'sync', 'left', 'result'].forEach(t => Net.on(t, m => {
      if (App.screen === 'game' && App.game && App.game.onNet) App.game.onNet(m);
    }));
    Net.on('replaced', () => {
      App.replaced = true;
      App.banner('這個遊戲在別的視窗開啟了，這裡已中斷連線');
      const mm = modal({
        title: '已在別處開啟', cls: 'dialog-sm', dismissible: false,
        content: h('p', { class: 'dialog-text' }, '同一個帳號在另一個視窗或分頁開啟了遊戲，這個視窗不會再自動連線。'),
        actions: [btn('回首頁', { cls: 'btn-ghost', onClick: () => { mm.close(true); App.go('home'); } }), btn('在這裡繼續', { cls: 'btn-mint', onClick: () => location.reload() })]
      });
    });
  }

  root.OnlineGlue = { init };
})(typeof self !== 'undefined' ? self : this);
