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

  const T = (k, p, fb) => root.I18N.t(k, p, fb);
  /* 文字都在使用當下才取（語言切換後重畫就會換字）；key 對應 locales.js */
  const REASON_CODES = ['invalid', 'revoked', 'expired', 'closed'];
  const reasonText = r => T('inv.' + (REASON_CODES.indexOf(r) >= 0 ? r : 'invalid'));
  const ERROR_CODES = ['banned', 'spec_full', 'spec_off', 'full', 'max', 'few', 'offline', 'notready'];
  const errText = (code, fb) => (ERROR_CODES.indexOf(code) >= 0 ? T('err.' + code) : (fb || T('err.generic')));
  const phaseText = ph => T('phase.' + ph, null, ph);
  const PHASE_CLS = { room: 'mint', countdown: 'sun', playing: 'pink' };
  /* 與單機（app.js）同一份電腦等級說明 */
  const AI_LEVELS = (root.AI && root.AI.LEVEL_ORDER) || ['baby', 'easy', 'normal', 'hard'];
  const aiDD = () => AI_LEVELS.map(k => ({ v: k, label: R.LEVEL_NAME[k], hint: T('ai.hint.' + k) }));
  const modeName = m => T('mode.' + m, null, m);
  /* 房名：沒自訂就用字典組「某某的房間」；電腦席位名稱依龍種翻譯 */
  const roomName = r => (r && r.auto ? T('room.defName', { name: r.auto }) : (r ? r.name : ''));
  const seatName = s => (s.kind === 'ai' ? T('ai.name', { dragon: T('dragon.short.' + s.dragon) }) : s.name);
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

  /** 邀請連結只帶房號與 token；伺服器位置由部署時注入（config.js），不放在連結裡 */
  function inviteLink(tok) {
    const p = new URLSearchParams();
    p.set('room', App.room.id); p.set('t', tok);
    return location.origin + location.pathname + '?' + p.toString();
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
    if (C.status === 'invalid') return { cls: 'bad', text: T('net.badCfg') };
    if (s === 'unset' || C.status === 'unset') return { cls: 'bad', text: T('net.unset') };
    if (s === 'open') return { cls: '', text: T('net.open') };
    if (s === 'waking') return { cls: 'warn', text: T('net.waking') };
    if (s === 'offline') return { cls: 'bad', text: T('net.offline') };
    if (s === 'retrying') return { cls: 'warn', text: T('net.retrying') };
    if (s === 'idle') return { cls: 'bad', text: T('net.idle') };
    return { cls: 'warn', text: T('net.connecting') };
  }
  function layoutName(id) {
    if (id === 'random') return T('room.randomMap');
    const f = (root.Layouts.list() || []).find(x => x.id === id);
    return f ? f.name : String(id);
  }
  function rulesSummary(s) {
    const th = s.theme === 'random' ? T('room.randomTheme') : ((Art.THEMES[+s.theme] || {}).name || T('rules.theme'));
    return [modeName(s.mode), R.LEVEL_NAME[s.level] || s.level, layoutName(s.layout), th,
      s.duration ? T('room.dur', { n: s.duration / 60000 }) : T('time.off'), s.publicRoom ? T('room.public') : T('room.private'), s.allowSpectators ? T('room.specOn') : T('room.specOff')];
  }

  /* ================= 聊天元件（房間用；對局裡的聊天由 game.js 負責） ================= */
  function sendChat(text) {
    const t = String(text || '').trim().slice(0, 60);
    if (!t) return false;
    const now = Date.now();
    if (now - lastChatAt < 500) { toast(T('toast.slow')); return false; }
    lastChatAt = now;
    return Net.send({ type: 'chat', text: t });
  }
  function createChat() {
    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': T('chat.log') });
    const input = h('input', { class: 'text-input', type: 'text', maxlength: 60, placeholder: T('chat.ph'), 'aria-label': T('chat.msg'), autocomplete: 'off', enterkeyhint: 'send' });
    const send = () => { if (sendChat(input.value)) input.value = ''; };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); send(); } });
    /* 快捷語：送出的是當下語言的文字（聊天內容本身不翻譯） */
    const quick = ['q1', 'q2', 'q4'].map(k => h('button', { type: 'button', onClick: () => sendChat(T('chat.' + k)) }, T('chat.' + k)));
    const el = h('div', { class: 'room-chat' }, log, h('div', { class: 'quick-chat' }, quick), h('div', { class: 'chat-form' }, input, btn(T('common.send'), { cls: 'btn-sm', onClick: send })));
    const line = m => {
      const sys = m.role === 'sys';
      return h('div', { class: 'msg' + (sys ? ' sys' : '') + (m.role === 'spectator' ? ' spec' : '') }, sys ? null : h('b', null, m.name + (m.role === 'spectator' ? T('chat.spec') : '') + T('chat.colon')), sys ? root.UI.chatText(m) : m.text);
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
        title: () => (spec ? T('lv.specH') : T('lv.roomH')),
        text: () => (spec ? T('exit.textSpec') : (r && r.you && r.you.host ? T('lv.hostP') : T('lv.p'))),
        ok: () => T('exit.ok'), cancel: () => T('lv.stay'), danger: true,
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
        U.topbar(T('home.online'), () => App.go('home')),
        h('section', { class: 'card lobby-unset' }, h('h3', null, T('lobby.unsetH')),
          h('p', null, C.status === 'invalid' ? T('lobby.badUrl', { err: T('cfg.err.' + C.code, null, C.error || '') }) : T('lobby.unsetP')),
          h('p', { class: 'muted small', style: { marginTop: '6px' } }, T('lobby.unsetSolo')),
          h('div', { class: 'row', style: { marginTop: '12px' } },
            btn(T('common.home'), { cls: 'btn-pink', icon: 'home', onClick: () => App.go('home') }),
            btn(T('home.solo'), { cls: 'btn-sky', icon: 'robot', onClick: () => App.go('solo') })))));
    }

    ui.statusBox = h('span', { class: 'lobby-status' });
    ui.onlineCountBox = h('span', { class: 'lobby-online-count', role: 'status', 'aria-live': 'polite', hidden: true });
    ui.wakeBox = h('div');
    ui.noticeBox = h('div');
    ui.inviteBox = h('div');
    ui.profileCard = h('section', { class: 'card' }, h('h3', null, T('lobby.me')));
    ui.actionCard = h('section', { class: 'card' });
    ui.listBox = h('div', { class: 'room-list', 'aria-live': 'polite' });
    const prof = App.profileEditor({ onChange: syncProfile });
    ui.profileCard.appendChild(prof.el);

    ui.paintOnlineCount = () => {
      const count = App.onlineCount;
      ui.onlineCountBox.hidden = !Number.isInteger(count);
      ui.onlineCountBox.textContent = Number.isInteger(count) ? T('lobby.onlineCount', { n: count }) : '';
    };
    ui.paintStatus = () => {
      if (!online()) App.onlineCount = null;
      ui.paintOnlineCount();
      const si = statusInfo();
      ui.statusBox.textContent = '';
      ui.statusBox.appendChild(h('span', { class: 'status ' + si.cls, role: 'status' }, h('i'), si.text));
      repaint(ui.wakeBox, box => {
        const s = App.netStatus;
        if (s === 'waking' || s === 'connecting') {
          box.appendChild(h('section', { class: 'card wake-card' },
            h('div', { class: 'wake-art' }, avatar(App.store.dragon, 56), h('div', { class: 'grow' },
              h('b', null, s === 'waking' ? T('lobby.waking') : T('lobby.connecting')),
              h('div', { class: 'muted small' }, s === 'waking' ? T('lobby.wakeText') + (wakeSecs ? T('lobby.waited', { n: wakeSecs }) : '') : T('lobby.wait'))))));
        } else if (s === 'offline' || s === 'retrying') {
          box.appendChild(h('section', { class: 'card wake-card' },
            h('div', { class: 'wake-art' }, h('div', { class: 'grow' }, h('b', null, s === 'offline' ? T('lobby.noConn') : T('lobby.lost')), h('div', { class: 'muted small' }, T('lobby.autoRetry'))),
              btn(T('lobby.retry'), { cls: 'btn-sky btn-sm', icon: 'refresh', iconSize: 18, onClick: () => Net.open(profile()) }))));
        }
      });
      ui.paintActions();
    };
    ui.paintNotice = () => {
      ui.noticeBox.textContent = '';
      if (App.lobbyNotice) {
        ui.noticeBox.appendChild(h('section', { class: 'card notice', role: 'status' }, h('p', null, typeof App.lobbyNotice === 'function' ? App.lobbyNotice() : App.lobbyNotice),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } }, btn(T('lobby.gotIt'), { cls: 'btn-mint btn-sm', onClick: () => { App.lobbyNotice = ''; ui.paintNotice(); } }))));
      }
    };

    /* 開始：快速加入、建立房間、輸入代碼 */
    const codeIn = h('input', {
      class: 'text-input code-input', type: 'text', maxlength: 4, placeholder: T('lobby.codePh'), 'aria-label': T('lobby.codeLabel'), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go',
      onInput: () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); },
      onKeydown: e => { e.stopPropagation(); if (e.key === 'Enter') byCode('player'); }
    });
    const byCode = as => {
      const c = codeIn.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) { toast(T('lobby.codeErr')); codeIn.focus(); return; }
      joinRoom(c, as);
    };
    ui.paintActions = () => repaint(ui.actionCard, box => {
      const ok = online();
      box.appendChild(h('h3', null, T('lobby.start')));
      box.appendChild(h('div', { class: 'row action-row' },
        btn(T('lobby.quick'), { cls: 'btn-pink btn-lg', icon: 'play', iconSize: 24, disabled: !ok, onClick: () => Net.send({ type: 'quick', name: U.myName(), dragon: App.store.dragon }) }),
        btn(T('lobby.create'), { cls: 'btn-sun btn-lg', icon: 'plus', iconSize: 24, disabled: !ok, onClick: createRoomModal })));
      const codeRow = h('div', { class: 'code-row' }, codeIn,
        btn(T('lobby.join'), { cls: 'btn-mint btn-sm', disabled: !ok, onClick: () => byCode('player') }),
        btn(T('lobby.watch'), { cls: 'btn-sky btn-sm', icon: 'eye', iconSize: 18, disabled: !ok, onClick: () => byCode('spectator') }));
      box.appendChild(h('div', { class: 'field' }, h('span', { class: 'label' }, T('lobby.codeLabel')), h('div', { class: 'ctl' }, codeRow)));
    });

    ui.paintList = () => repaint(ui.listBox, box => {
      const list = App.rooms || [];
      if (!online()) { box.appendChild(h('div', { class: 'empty-box' }, T('lobby.emptyOff'))); return; }
      if (!list.length) { box.appendChild(h('div', { class: 'empty-box' }, T('lobby.emptyNone'))); return; }
      for (const r of list) {
        const s = r.settings || {};
        box.appendChild(h('div', { class: 'room-item' },
          h('div', { class: 'info' },
            h('div', { class: 'name' }, roomName(r)),
            h('div', { class: 'chips', style: { marginTop: '4px' } },
              pill(T('room.code', { id: r.id }), 'gray'), pill(phaseText(r.phase), PHASE_CLS[r.phase] || 'gray'), pill(T('room.n', { n: r.players, max: r.max })), r.ais ? pill(T('room.bots', { n: r.ais })) : null,
              r.spectators ? pill(T('room.spec', { n: r.spectators }), 'gray') : null, pill(T('room.host', { name: r.host }), 'gray'),
              pill(modeName(s.mode) + '・' + (R.LEVEL_NAME[s.level] || ''), 'gray'))),
          h('div', { class: 'row', style: { gap: '8px' } },
            r.joinable ? btn(T('lobby.join'), { cls: 'btn-mint', onClick: () => joinRoom(r.id, 'player') }) : null,
            s.allowSpectators === false ? null : btn(T('lobby.watch'), { cls: 'btn-sky', icon: 'eye', iconSize: 18, onClick: () => joinRoom(r.id, 'spectator') }))));
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
      const card = h('section', { class: 'invite-card', 'aria-label': T('inv.aria') });
      const drop = () => { App.invite = null; clearInviteUrl(); ui.paintInvite(); };
      if (inv.error) {
        put(card, h('h3', null, T('inv.badH')), h('p', null, REASON_CODES.indexOf(inv.error) >= 0 ? reasonText(inv.error) : T('inv.badP')),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, btn(T('inv.back'), { cls: 'btn-mint', onClick: drop })));
      } else if (!inv.info) {
        put(card, h('h3', null, T('inv.checking')), h('p', { class: 'muted' }, online() ? T('inv.checkP') : T('inv.waitConn')),
          h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, btn(T('inv.no'), { cls: 'btn-ghost btn-sm', onClick: drop })));
      } else {
        const i = inv.info;
        const spec = i.role === 'spectator' || i.willSpectate;
        let why = '';
        if (i.role !== 'spectator' && i.willSpectate) why = i.phase !== 'room' ? T('inv.whyGame') : T('inv.whyFull');
        if (!App.store.nickname || !App.store.nickname.trim()) { App.store.nickname = U.myName(); U.save(); }
        const prof = App.profileEditor({ onChange: syncProfile });
        put(card, 
          h('h3', { class: 'invite-h' }, h('span', null, T('inv.pre')), h('span', { class: 'invite-nm' }, i.auto ? T('room.defName', { name: i.auto }) : i.name), h('span', null, T('inv.post'))),
          h('div', { class: 'chips', style: { margin: '6px 0 10px' } },
            pill(T('room.code', { id: i.room }), 'gray'), pill(phaseText(i.phase), PHASE_CLS[i.phase] || 'gray'), pill(T('room.n', { n: i.players, max: i.max })),
            pill(spec ? T('inv.roleSpec') : T('inv.rolePlayer'), spec ? 'sun' : 'mint')),
          why ? h('p', { class: 'hint', style: { marginBottom: '8px' } }, why) : null,
          h('p', { class: 'muted small', style: { marginBottom: '8px' } }, T('inv.confirm') + (spec ? ' ' + T('inv.confirmSpec') : '')),
          prof.el,
          h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '10px', marginTop: '10px' } },
            btn(T('inv.no'), { cls: 'btn-ghost', onClick: drop }),
            btn(spec ? T('inv.btnSpec') : T('inv.btnJoin'), {
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

    const refresh = root.UI.iconBtn('refresh', T('lobby.refresh'), () => { Net.send({ type: 'lobbySub' }); }, 'sm');
    const el = U.screenBox('', h('div', { class: 'wrap' },
      U.topbar(T('home.online'), () => { Net.close(); App.banner(''); App.go('home'); }, ui.statusBox),
      ui.wakeBox, ui.noticeBox, ui.inviteBox,
      ui.grid = h('div', { class: 'room-grid lobby-grid' },
        h('div', { class: 'col' }, ui.profileCard, ui.actionCard),
        h('section', { class: 'card' }, h('h3', null, T('lobby.rooms'), h('span', { class: 'grow' }), refresh), ui.onlineCountBox, ui.listBox))));
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
    const nameIn = h('input', { class: 'text-input', type: 'text', maxlength: 10, placeholder: T('room.defName', { name: U.myName() }), 'aria-label': T('cr.name'), autocomplete: 'off', 'data-autofocus': '1' });
    const m = modal({
      cls: 'dialog-lg',
      render: () => {
        nameIn.setAttribute('placeholder', T('room.defName', { name: U.myName() }));
        nameIn.setAttribute('aria-label', T('cr.name'));
        return {
          title: T('lobby.create'),
          content: h('div', null,
            field(T('cr.name'), nameIn),
            field(T('cr.public'), toggle({ label: T('cr.publicAria'), value: pub, onChange: v => { pub = v; } })),
            field(T('cr.spec'), toggle({ label: T('cr.spec'), value: spec, onChange: v => { spec = v; } })),
            h('p', { class: 'muted small' }, T('cr.note'))),
          actions: [btn(T('common.cancel'), { cls: 'btn-ghost', onClick: () => m.close() }),
            btn(T('cr.ok'), {
              cls: 'btn-pink', icon: 'check', onClick: () => {
                m.close(true);
                Net.send({ type: 'create', name: U.myName(), dragon: App.store.dragon, roomName: nameIn.value.trim().slice(0, 10), max, settings: { publicRoom: pub, allowSpectators: spec } });
              }
            })]
        };
      }
    });
  }

  /* ================= 房間 ================= */
  App.screens.room = function () {
    const ui = App.roomUI = {};
    ui.titleEl = h('h2', null, T('room.title'));
    ui.metaEl = h('div', { class: 'room-meta chips' });
    ui.roleBox = h('div', { class: 'chips' });
    ui.seatsBox = h('div', { class: 'seats' });
    ui.specBox = h('div');
    ui.actBox = h('div');
    ui.setBox = h('div');
    ui.invBox = h('div');
    ui.setCard = h('section', { class: 'card' }, h('h3', null, T('rules.h')), ui.setBox);
    ui.invCard = h('section', { class: 'card' }, h('h3', null, T('room.inviteH')), ui.invBox);
    roomChat = createChat();
    roomChat.set(Online.chat);
    ui.chat = roomChat;

    ui.paint = () => {
      const r = App.room;
      if (!r) {
        ui.titleEl.textContent = T('room.entering');
        ui.metaEl.textContent = '';
        ['seatsBox', 'specBox', 'actBox', 'setBox', 'invBox', 'roleBox'].forEach(k => { ui[k]._sig = null; ui[k].textContent = ''; });
        ui.seatsBox.appendChild(h('div', { class: 'empty-box' }, T('room.sync')));
        ui.setCard.hidden = true; ui.invCard.hidden = true;
        return;
      }
      const you = r.you, host = you.host;
      ui.titleEl.textContent = roomName(r);
      patch(ui.metaEl, [r.id, r.phase].join('|'), box => put(box, pill(T('room.code', { id: r.id }), 'gray'), pill(phaseText(r.phase), PHASE_CLS[r.phase] || 'gray')));
      patch(ui.roleBox, [you.role, host].join('|'), box => put(box,
        pill(you.role === 'player' ? T('room.youPlayer') : T('room.youSpec'), you.role === 'player' ? 'mint' : 'sun'), host ? pill(T('room.hostTag'), 'sun') : null));
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
      h('div', { class: 'topbar' }, root.UI.iconBtn('back', T('room.leave'), () => Online.confirmLeave()),
        h('div', { class: 'room-head' }, ui.titleEl, ui.metaEl), ui.roleBox),
      h('div', { class: 'room-grid' },
        h('div', { class: 'col' },
          h('section', { class: 'card' }, h('h3', null, T('room.seats')), ui.seatsBox),
          ui.invCard,
          ui.specBox,
          h('section', { class: 'card' }, h('h3', null, T('room.chat')), roomChat.el)),
        h('div', { class: 'col' },
          h('section', { class: 'card' }, ui.actBox),
          ui.setCard))));
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
        box.appendChild(h('button', { type: 'button', class: 'seat empty can-add', 'aria-label': T('seat.addAria'), title: T('seat.addTitle'),
          onClick: () => { if (root.Sound) root.Sound.sfx('click'); Net.send({ type: 'addAI', level: lv }); } },
          h('span', { class: 'seat-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'seat-name' }, T('seat.add')), h('small', { class: 'seat-wait' }, T('seat.orWait'))));
      } else {
        box.appendChild(h('div', { class: 'seat empty' }, h('span', { class: 'seat-plus', 'aria-hidden': 'true' }, '＋'), h('span', { class: 'seat-name' }, T('seat.empty')), h('small', { class: 'seat-wait' }, T('seat.wait'))));
      }
        continue;
      }
      if (s.kind === 'ai') {
        const rm = host && lobby ? root.UI.iconBtn('close', T('seat.removeAria', { name: seatName(s) }), () => Net.send({ type: 'removeAI', seat: s.i }), 'sm') : null;
        const tags = h('div', { class: 'seat-tags' }, pill(T('seat.bot')));
        if (host && lobby) tags.appendChild(root.UI.dropdown({ label: T('seat.levelAria', { name: seatName(s) }), cls: 'lvl sm', options: aiDD(), value: s.aiLevel, onChange: v => Net.send({ type: 'setAI', seat: s.i, level: v }) }));
        else tags.appendChild(pill(R.LEVEL_NAME[s.aiLevel] || s.aiLevel, 'mint'));
        box.appendChild(h('div', { class: 'seat ai', 'data-kind': 'ai' },
          h('div', { class: 'seat-line' }, avatar(s.dragon, 40), h('span', { class: 'seat-name', title: seatName(s) }, seatName(s)), rm), tags));
        continue;
      }
      const mine = s.i === you.seat;
      const tags = h('div', { class: 'seat-tags' });
      if (s.i === r.hostSeat) tags.appendChild(pill(T('room.hostTag'), 'sun'));
      if (mine) tags.appendChild(pill(T('seat.you')));
      if (s.i !== r.hostSeat && lobby) tags.appendChild(pill(s.ready ? T('seat.ready') : T('seat.notReady'), s.ready ? 'mint' : 'gray'));
      if (!s.connected) tags.appendChild(pill(T('seat.away'), 'pink'));
      const kick = host && !mine && lobby
        ? root.UI.iconBtn('close', T('seat.kickAria', { name: s.name }), () => root.UI.confirmBox({ title: () => T('seat.kickH', { name: s.name }), text: () => T('seat.kickP'), ok: () => T('seat.kickOk'), danger: true, onOk: () => Net.send({ type: 'kick', seat: s.i }) }), 'sm')
        : null;
      box.appendChild(h('div', { class: 'seat' + (mine ? ' me' : '') + (s.connected ? '' : ' away') },
        h('div', { class: 'seat-line' }, avatar(s.dragon, 40), h('span', { class: 'seat-name' }, s.name), kick), tags));
    }
  }


  function paintSpectators(box) {
    const r = App.room;
    const list = r.spectators || [];
    const card = h('section', { class: 'card' }, h('h3', null, T('spec.h'), pill(list.length + '/' + r.specCap, 'gray')));
    if (!list.length) card.appendChild(h('p', { class: 'muted small' }, r.settings.allowSpectators ? T('spec.none') : T('spec.off')));
    else card.appendChild(h('div', { class: 'chips' }, list.map(s => pill(s.name + (s.pid === r.you.pid ? T('game.you') : ''), s.pid === r.you.pid ? '' : 'gray'))));
    box.appendChild(card);
  }

  function paintActions(box) {
    const r = App.room, you = r.you, lobby = r.phase === 'room';
    const filled = r.seats.filter(s => s.kind !== 'empty').length;
    const free = filled < r.max;
    box.appendChild(h('h3', null, you.role === 'player' ? (you.host ? T('act.host') : T('room.youPlayer')) : T('room.youSpec')));
    const rows = h('div', { class: 'col tight' });
    if (!lobby) {
      rows.appendChild(h('p', { class: 'muted' }, r.phase === 'countdown' ? T('act.soon') : T('act.playing')));
    } else if (you.role === 'player' && you.host) {
      const why = filled < 2 ? T('act.few') : (!r.canStart ? T('act.notAll') : (r.seats.some(x => x.kind === 'ai') ? T('act.aiReady') : T('act.allReady')));
      rows.appendChild(btn(T('act.start'), { cls: 'btn-pink btn-lg btn-block', icon: 'play', iconSize: 24, disabled: !r.canStart, onClick: () => Net.send({ type: 'start' }) }));
      rows.appendChild(h('p', { class: 'muted small' }, why));
    } else if (you.role === 'player') {
      const me = r.seats[you.seat];
      rows.appendChild(btn(me.ready ? T('act.cancelReady') : T('act.imReady'), { cls: me.ready ? 'btn-ghost btn-lg btn-block' : 'btn-mint btn-lg btn-block', icon: 'check', iconSize: 24, onClick: () => Net.send({ type: 'ready', value: !me.ready }) }));
      rows.appendChild(h('p', { class: 'muted small' }, me.ready ? T('act.waitHost') : T('act.pressReady')));
      rows.appendChild(btn(T('act.toSpec'), { cls: 'btn-ghost btn-block', icon: 'eye', iconSize: 20, onClick: () => Net.send({ type: 'watch' }) }));
    } else {
      rows.appendChild(btn(free ? T('act.join') : T('act.full'), { cls: 'btn-mint btn-lg btn-block', icon: 'play', iconSize: 24, disabled: !free, onClick: () => Net.send({ type: 'sit' }) }));
      rows.appendChild(h('p', { class: 'muted small' }, free ? T('act.specFree') : T('act.specFull')));
    }
    rows.appendChild(btn(T('room.leave'), { cls: 'btn-ghost btn-block', onClick: () => Online.confirmLeave() }));
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
      box.appendChild(field(T('cr.public'), toggle({ label: T('cr.public'), value: s.publicRoom, onChange: v => send({ publicRoom: v }) })));
      box.appendChild(field(T('cr.spec'), toggle({ label: T('cr.spec'), value: s.allowSpectators, onChange: v => send({ allowSpectators: v }) })));
    } else {
      box.appendChild(h('div', { class: 'chips' }, rulesSummary(s).map(t => pill(t, 'gray'))));
      box.appendChild(h('p', { class: 'muted small', style: { marginTop: '8px' } }, r.you.host ? T('setg.noEdit') : T('setg.hostOnly')));
    }
  }

  /* ---------- 邀請連結（房主） ---------- */
  function paintInvites(box) {
    const r = App.room;
    const invs = (r.invites || []).slice().sort((a, b) => (a.created || 0) - (b.created || 0));
    box.appendChild(h('p', { class: 'muted small' }, T('invh.note')));
    box.appendChild(h('div', { class: 'row', style: { margin: '8px 0' } },
      btn(T('invh.player'), { cls: 'btn-sky btn-sm', icon: 'link', iconSize: 18, onClick: () => Net.send({ type: 'invite', role: 'player' }) }),
      btn(T('invh.spec'), { cls: 'btn-sun btn-sm', icon: 'eye', iconSize: 18, onClick: () => Net.send({ type: 'invite', role: 'spectator' }) })));
    if (!invs.length) { box.appendChild(h('p', { class: 'muted small' }, T('invh.none'))); return; }
    const list = h('div', { class: 'col tight invite-list' });
    for (const iv of invs) {
      const url = inviteLink(iv.token);
      list.appendChild(h('div', { class: 'invite-item', 'data-role': iv.role },
        h('div', { class: 'small', style: { fontWeight: '800', marginBottom: '4px' } }, iv.role === 'spectator' ? T('invh.spec') : T('invh.player')),
        h('div', { class: 'link-box' }, h('code', null, url),
          btn(T('invh.copy'), { cls: 'btn-mint btn-sm', icon: 'copy', iconSize: 16, onClick: () => { Promise.resolve(root.UI.copyText(url)).then(ok => toast(ok ? T('invh.copied') : T('invh.copyFail'))); } }))));
    }
    box.appendChild(list);
    box.appendChild(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } },
      btn(T('invh.revoke'), { cls: 'btn-ghost btn-sm', icon: 'trash', iconSize: 18, onClick: () => root.UI.confirmBox({ title: () => T('invh.revokeH'), text: () => T('invh.revokeP'), ok: () => T('invh.revokeOk'), danger: true, onOk: () => Net.send({ type: 'revoke' }) }) })));
  }

  /* ================= 房間結束 ================= */
  const closedText = code => (code === 'empty' ? T('closed.empty') : T('closed.default'));
  function showClosed(code) {
    if (closedModal && !closedModal.closed) return;
    const spec = App.room && App.room.you && App.room.you.role === 'spectator';
    closedModal = modal({
      cls: 'dialog-sm', dismissible: false,
      render: () => ({
        title: T('closed.title'),
        content: h('div', null, h('p', { class: 'dialog-text' }, closedText(code)),
          spec ? h('p', { class: 'muted small', style: { marginTop: '6px' } }, T('closed.specP')) : null),
        actions: [btn(T('inv.back'), { cls: 'btn-mint', onClick: () => { closedModal.close(true); closedModal = null; Online.leaveToLobby(); } })]
      })
    });
  }

  /* ================= 伺服器訊息 ================= */
  function init() {
    Net.onStatus((s, detail) => {
      App.netStatus = s;
      wakeSecs = s === 'waking' ? (detail || 0) : 0;
      if (!inOnlineScreen()) { if (!App.replaced) App.banner(''); return; }
      if (!App.replaced) {
        if (s === 'waking') App.banner(() => T('net.bWaking', { n: detail || 0 }), true);
        else if (s === 'connecting') App.banner(() => T('net.connecting'), true);
        else if (s === 'retrying') App.banner(() => T('net.bRetry'), true);
        else if (s === 'offline') App.banner(() => T('net.bOffline'), true);
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
          if (isOnlineGame() && App.game.resultShown) showClosed();
          else { toast(T('closed.default'), 4200); Online.leaveToLobby(() => T('closed.default')); }
          return;
        }
      } else if (App.screen === 'lobby' && m.room.phase === 'room') App.go('room');
      else if (App.screen === 'room' && App.roomUI) App.roomUI.paint();
      if (App.lobbyUI && App.screen === 'lobby') askInvite();
    });
    Net.on('rooms', m => {
      App.rooms = m.rooms || [];
      App.onlineCount = Number.isInteger(m.online) && m.online >= 0 ? m.online : null;
      if (App.lobbyUI && App.screen === 'lobby') {
        App.lobbyUI.paintOnlineCount();
        if (App.lobbyUI.paintList) App.lobbyUI.paintList();
      }
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
      if (m.note) toast(m.nk ? T('note.' + m.nk, null, m.note) : m.note, 4200);
      if (App.screen !== 'game' && App.screen !== 'room') App.go('room');
    });
    Net.on('joinFailed', m => {
      if (App.invite && App.invite.joining) { App.invite.joining = false; App.invite.error = m.reason; }
      else toast(REASON_CODES.indexOf(m.reason) >= 0 ? reasonText(m.reason) : T('err.joinFail'), 3800);
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
      const text = closedText(m.code);
      if (App.screen === 'room' || isOnlineGame()) showClosed(m.code);
      else { App.lobbyNotice = () => closedText(m.code); toast(text, 4200); if (App.lobbyUI && App.screen === 'lobby' && App.lobbyUI.paintNotice) App.lobbyUI.paintNotice(); }
    });
    Net.on('kicked', m => {
      toast(T('kicked.you'), 4200);
      Online.leaveToLobby(() => T('kicked.you'));
    });
    Net.on('error', m => toast(errText(m.code, m.text), 3800));
    Net.on('start', m => {
      root.UI.closeAllModals(); closedModal = null;
      App.go('game', { kind: 'online', cfg: m.cfg, slot: m.slot, t0Wall: m.t0Wall, serverNow: m.serverNow, goIn: m.goIn });
    });
    ['ev', 'clock', 'hash', 'sync', 'left', 'result'].forEach(t => Net.on(t, m => {
      if (App.screen === 'game' && App.game && App.game.onNet) App.game.onNet(m);
    }));
    Net.on('replaced', () => {
      App.replaced = true;
      App.banner(() => T('rep.banner'));
      const mm = modal({
        cls: 'dialog-sm', dismissible: false,
        render: () => ({
          title: T('rep.title'),
          content: h('p', { class: 'dialog-text' }, T('rep.text')),
          actions: [btn(T('common.home'), { cls: 'btn-ghost', onClick: () => { mm.close(true); App.go('home'); } }), btn(T('rep.here'), { cls: 'btn-mint', onClick: () => location.reload() })]
        })
      });
    });
  }

  root.OnlineGlue = { init };
})(typeof self !== 'undefined' ? self : this);
