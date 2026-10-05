/* ===== app.js — 畫面切換、首頁、教學、單機設定、設定彈窗 ===== */
(function (root) {
  'use strict';
  const { h, btn, seg, stepper, toggle, volume, avatar, keycap, toast, modal } = root.UI;
  const R = root.Rules, Art = root.Art, AI = root.AI, Layouts = root.Layouts;
  const $ = id => document.getElementById(id);

  const LEVEL_HINT = { baby: '4 種泡泡、有提示、不會下壓', easy: '6 種泡泡、偶爾會下壓、會出現陌生色', normal: '8 種泡泡、星星泡泡、陌生色變多', hard: '10 種泡泡、下壓最快、常出現陌生色' };
  const LEVEL_DD = R.LEVELS.map(k => ({ v: k, label: R.LEVEL_NAME[k], hint: LEVEL_HINT[k] }));
  const LEVEL_OPTS = R.LEVELS.map(k => ({ v: k, label: R.LEVEL_NAME[k] }));
  const AI_HINT = { baby: '慢慢來、常亂射', easy: '偶爾失手', normal: '穩穩消除', hard: '又快又準' };
  const AI_DD = AI.LEVEL_ORDER.map(k => ({ v: k, label: R.LEVEL_NAME[k], hint: AI_HINT[k] }));
  const TIME_OPTS = [{ v: 120000, label: '2 分' }, { v: 180000, label: '3 分' }, { v: 300000, label: '5 分' }, { v: 0, label: '不限時' }];
  const MODE_OPTS = [{ v: 'race', label: '各自比賽' }, { v: 'duel', label: '送泡泡對打' }];
  const THEME_DD = [{ v: 'random', label: '隨機', swatch: 'linear-gradient(135deg,#8fd6ff,#ffbfe0,#bdeecb)' }]
    .concat(Art.THEMES.map(t => ({ v: String(t.id), label: t.name, swatch: 'linear-gradient(135deg,' + t.sky[0] + ',' + t.sky[1] + ')' })));
  function layoutOpts() {
    const list = Layouts.list();
    const out = [{ v: 'random', label: '隨機（每局不同）' }];
    list.filter(x => x.kind === 'pattern').forEach(x => out.push({ v: x.id, label: x.name, hint: x.group }));
    list.filter(x => x.kind === 'family').forEach(x => out.push({ v: x.id, label: x.name, hint: '花紋' }));
    return out;
  }
  const ADJ = ['快樂', '勇敢', '調皮', '害羞', '閃亮', '軟綿綿', '圓滾滾', '機靈', '呆萌', '活潑'];

  const App = {
    store: root.Store.load(), screen: null, params: null, game: null, el: null, screens: {}, util: {}
  };
  root.App = App;

  function myName() {
    const n = (App.store.nickname || '').trim();
    if (n) return n.slice(0, 10);
    return (App.autoAdj || (App.autoAdj = ADJ[Math.floor(Math.random() * ADJ.length)])) + Art.dragonName(App.store.dragon).replace('龍', '');
  }
  function save() { root.Store.save(App.store); }
  function applySettings() {
    const st = App.store;
    Object.assign(root.Sound.config, { bgm: st.bgm, bgmVol: st.bgmVol, sfx: st.sfx, sfxVol: st.sfxVol });
    root.Sound.apply();
    document.body.classList.toggle('calm', !!st.reduceMotion);
  }
  App.recordResult = (kind, win) => root.Store.record(App.store, kind === 'solo' ? 'solo' : 'online', !!win);

  /* ---------- 畫面切換 ---------- */
  function clear() {
    if (App.game) { App.game.destroy(); App.game = null; }
    App.el.textContent = '';
  }
  function go(name, params, opt) {
    clear();
    App.screen = name; App.params = params || null;
    const fn = App.screens[name];
    if (!fn) throw new Error('沒有這個畫面：' + name);
    const el = fn(params || {});
    if (el) { el.setAttribute('data-screen', name); App.el.appendChild(el); }
    const lobbyLink = $('lobby-home-link');
    if (lobbyLink) lobbyLink.hidden = name !== 'home';
    if (name !== 'game') root.Sound.bgm(name === 'home' ? 'a' : 'c');
    if (!(opt && opt.quiet)) { const t = App.el.querySelector('h1,h2'); if (t) { t.setAttribute('tabindex', '-1'); try { t.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } } }
    return el;
  }
  App.go = go;
  App.rerender = () => { if (App.screen === 'lobby' || App.screen === 'room') go(App.screen, App.params, { quiet: true }); };
  const screenBox = (cls, kids) => h('main', { class: 'screen ' + (cls || '') }, kids);
  const topbar = (title, backFn, extra) => h('div', { class: 'topbar' }, backFn ? root.UI.iconBtn('back', '返回', backFn) : null, h('h2', null, title), extra);
  const img = (svg, cls, size) => h('img', { class: cls || '', alt: '', draggable: 'false', src: Art.svgUrl(svg), width: size, height: size });

  /* ---------- 首頁 ---------- */
  App.screens.home = function () {
    const st = App.store.stats, sline = [];
    if (st.solo) sline.push('單機 ' + st.solo.win + ' 勝／' + st.solo.play + ' 場');
    if (st.online) sline.push('線上 ' + st.online.win + ' 勝／' + st.online.play + ' 場');
    return screenBox('home center', [
      h('div', { class: 'hero' },
        h('img', { class: 'hero-logo', alt: '彩虹泡泡砲', src: Art.svgUrl(Art.logoSVG()) }),
        h('h1', { class: 'sr' }, '彩虹泡泡砲'),
        h('p', { class: 'hero-sub' }, '對準同顏色的泡泡，咻！一次消掉好多好多！'),
        h('div', { class: 'hero-cast' }, Art.DRAGONS.map(d => avatar(d.id, 70)))),
      h('nav', { class: 'home-menu', 'aria-label': '主選單' },
        btn('一個人玩', { cls: 'btn-pink btn-lg btn-block', icon: 'robot', iconSize: 28, onClick: () => go('solo') }),
        btn('跟別人玩', { cls: 'btn-sky btn-lg btn-block', icon: 'users', iconSize: 28, onClick: () => go('lobby') }),
        btn('怎麼玩', { cls: 'btn-sun btn-lg btn-block', icon: 'help', iconSize: 28, onClick: () => go('help') })),
      sline.length ? h('p', { class: 'home-foot' }, '本機戰績：' + sline.join('　')) : null
    ]);
  };

  /* ---------- 教學（純圖文，看得懂就好） ---------- */
  App.screens.help = function () {
    const fig = (key, label) => h('div', { class: 'help-item' }, img(key.startsWith('s:') ? Art.specialBubbleSVG(key.slice(2)) : Art.bubbleSVG(+key.split(':')[1], { mod: +key.split(':')[2] || 0 }), 'help-bub', 56), h('span', { class: 'help-txt' }, h('b', null, label.split('：')[0]), h('small', null, label.split('：')[1] || '')));
    return screenBox('', h('div', { class: 'wrap' },
      topbar('怎麼玩', () => go('home')),
      h('div', { class: 'help-grid' },
        h('section', { class: 'card' }, h('h3', null, '目標'),
          h('p', null, '用彩虹砲發射泡泡，3 顆以上同顏色的泡泡碰在一起就會「啵」地消失！'),
          h('p', { class: 'muted small', style: { marginTop: '6px' } }, '時間到的時候，消得最多的贏；有人把泡泡全部清光，也是他贏！')),
        h('section', { class: 'card' }, h('h3', null, '怎麼射'),
          h('p', null, '平板與手機：點哪裡，泡泡就飛向哪裡。點砲台右邊的小長方形「⇄」按鈕，可以換下一顆。'),
          h('p', { class: 'keyline', style: { margin: '6px 0' } }, h('span', null, '電腦鍵盤：'), h('span', null, '瞄準 ', keycap('←'), keycap('→')), h('span', null, '發射 ', keycap('空白', 'wide')), h('span', null, '交換泡泡 ', keycap('S'))),
          h('p', { class: 'muted small' }, '泡泡會彈牆壁喔！跟著虛線瞄準就對了。'))),
      h('section', { class: 'card' }, h('h3', null, '特別的泡泡'),
        h('div', { class: 'help-items' },
          fig('s:rainbow', '彩虹泡泡：碰到泡泡會變成旁邊最多的顏色，湊成 3 顆就消掉'),
          fig('s:star', '星星泡泡：射出去碰到泡泡就爆開，炸掉周圍一圈'),
          fig('b:2:1', '帶星星記號的泡泡：把它消掉時，也會以它為中心爆開一圈'),
          fig('s:laser', '閃電泡泡：打到泡泡上就射出十字雷射，同時消掉一整排和一整列'),
          fig('b:3:2', '金幣泡泡：算 3 顆分數'),
          fig('s:cloud', '雲朵磚：消不掉，但會幫忙撐住泡泡'))),
      h('section', { class: 'card' }, h('h3', null, '掉下來也算分'),
        h('p', null, '泡泡一旦沒有連到天花板，就會一起掉下來，全部都算分！打斷「根」就能一次掉很多。')),
      h('section', { class: 'card' }, h('h3', null, '送泡泡對打（5 歲以上）'),
        h('p', null, '你一次消得越多，就會把雲朵泡泡送給別人。頭上有警告雲時，趕快多消幾顆就能抵銷！'),
        h('p', { class: 'muted small', style: { marginTop: '6px' } }, '泡泡碰到底線時，會下一場「泡泡雨」，幫你沖掉最下面三排，還有兩發保護，不會輸掉。')),
      h('section', { class: 'card' }, h('h3', null, '四種難度'),
        h('div', { class: 'help-levels' }, R.LEVELS.map(k => h('div', null, h('b', null, R.LEVEL_NAME[k]), '　', h('span', { class: 'muted' }, LEVEL_HINT[k]))))),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        btn('開始練習', { cls: 'btn-pink btn-lg', onClick: () => go('solo') }),
        btn('回首頁', { cls: 'btn-ghost btn-lg', onClick: () => go('home') }))));
  };

  /* ---------- 暱稱與龍 ---------- */
  App.profileEditor = function (o) {
    o = o || {};
    const st = App.store;
    const input = h('input', {
      class: 'text-input', type: 'text', maxlength: 10, value: st.nickname || '', placeholder: '幫自己取個名字（最多 10 字）', 'aria-label': '暱稱', autocomplete: 'off', enterkeyhint: 'done',
      onInput: () => { st.nickname = input.value; save(); o.onChange && o.onChange(); }
    });
    const btns = Art.DRAGONS.map(d => h('button', {
      type: 'button', role: 'radio', class: 'animal-opt', 'data-id': d.id, 'aria-checked': st.dragon === d.id ? 'true' : 'false', 'aria-label': d.name,
      onClick: () => {
        root.Sound.sfx('click');
        st.dragon = d.id; save(); btns.forEach(b => b.setAttribute('aria-checked', b.dataset.id === d.id ? 'true' : 'false')); o.onChange && o.onChange();
      }
    }, avatar(d.id, 52), d.name));
    return {
      el: h('div', null,
        h('div', { class: 'field' }, h('span', { class: 'label' }, '暱稱'), h('div', { class: 'ctl', style: { justifyContent: 'stretch' } }, input)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '小龍'), h('div', { class: 'ctl', style: { justifyContent: 'stretch' } }, h('div', { class: 'animal-grid', role: 'radiogroup', 'aria-label': '選擇小龍', style: { width: '100%' } }, btns)))),
      input
    };
  };

  /* ---------- 規則面板（單機與線上房間共用） ---------- */
  App.rulesPanel = function (rules, set, o) {
    o = o || {};
    const f = (label, ctl) => h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'ctl' }, ctl));
    const rows = [];
    if (!o.noMode) rows.push(f('玩法', seg({ label: '玩法', options: MODE_OPTS.map(x => Object.assign({}, x, { disabled: x.v === 'duel' && o.duelDisabled })), value: rules.mode, onChange: v => set({ mode: v }) })));
    rows.push(f('難度', seg({ label: '難度', cls: 'small', options: LEVEL_OPTS, value: rules.level, onChange: v => set({ level: v }) })));
    rows.push(f('地圖', root.UI.dropdown({ label: '地圖', options: layoutOpts(), value: rules.layout, onChange: v => set({ layout: v }) })));
    rows.push(f('主題', root.UI.dropdown({ label: '主題', options: THEME_DD, value: String(rules.theme), onChange: v => set({ theme: v }) })));
    rows.push(f('時間', seg({ label: '時間', options: o.noUnlimited ? TIME_OPTS.slice(0, 3) : TIME_OPTS, value: rules.duration, onChange: v => set({ duration: v }) })));
    return h('div', { class: 'rules-panel' }, rows);
  };

  /* ---------- 單機設定 ---------- */
  App.screens.solo = function () {
    const st = App.store, so = st.solo;
    const prof = App.profileEditor({ onChange: () => {} });
    const oppBox = h('div'), panelBox = h('div');
    const f = (label, ctl) => h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'ctl' }, ctl));
    function paintOpp() {
      oppBox.textContent = '';
      const rows = [];
      for (let i = 0; i < so.opponents; i++) {
        rows.push(h('div', { class: 'ai-row' }, h('span', { class: 'name' }, '電腦 ' + (i + 1)),
          root.UI.dropdown({ label: '電腦 ' + (i + 1) + ' 難度', cls: 'lvl', options: AI_DD, value: so.aiLevels[i], onChange: v => { so.aiLevels[i] = v; save(); } })));
      }
      oppBox.appendChild(h('div', null,
        f('電腦對手', stepper({ label: '電腦數量', min: 0, max: 3, value: so.opponents, onChange: v => { so.opponents = v; if (v === 0) so.mode = 'race'; save(); paintOpp(); paintPanel(); } })),
        so.opponents ? h('div', { class: 'ai-rows' }, rows) : h('p', { class: 'muted small' }, '一個人慢慢玩也很好！想比賽就加電腦對手。')));
    }
    function paintPanel() {
      panelBox.textContent = '';
      panelBox.appendChild(App.rulesPanel(so, patch => {
        Object.assign(so, patch);
        if ('theme' in patch) so.theme = String(patch.theme);
        save();
        if ('mode' in patch || 'level' in patch) paintPanel();
      }, { duelDisabled: so.opponents === 0 }));
      if (so.opponents === 0 && so.level === 'baby') panelBox.appendChild(h('p', { class: 'hint' }, '幼幼班一個人玩：不計時，想玩多久都可以。'));
    }
    paintOpp(); paintPanel();
    return screenBox('', h('div', { class: 'wrap' },
      topbar('一個人玩', () => go('home')),
      h('div', { class: 'room-grid' },
        h('div', { style: { display: 'grid', gap: '14px', alignContent: 'start' } },
          h('section', { class: 'card' }, h('h3', null, '你的小龍'), prof.el),
          h('section', { class: 'card' }, h('h3', null, '對手'), oppBox)),
        h('div', { style: { display: 'grid', gap: '14px', alignContent: 'start' } },
          h('section', { class: 'card' }, h('h3', null, '規則'), panelBox))),
      h('div', { class: 'sticky-cta' }, btn('開始遊戲', { cls: 'btn-pink btn-lg btn-block', icon: 'play', iconSize: 26, onClick: () => App.startSolo() }))));
  };

  /* ---------- 單機開局 ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  App.startSolo = function () {
    const st = App.store, so = st.solo;
    const others = shuffle(Art.DRAGONS.map(d => d.id).filter(id => id !== st.dragon));
    const players = [{ name: myName(), dragon: st.dragon, kind: 'human' }];
    const ai = {};
    for (let i = 0; i < so.opponents; i++) {
      players.push({ name: Art.dragonName(others[i]).replace('龍', '') + '・電腦', dragon: others[i], kind: 'ai', aiLevel: so.aiLevels[i] });
      ai[i + 1] = so.aiLevels[i];
    }
    const seed = Math.floor(Math.random() * 4294967296) >>> 0;
    let themeId = so.theme === 'random' ? Math.floor(Math.random() * Art.THEMES.length) : (+so.theme | 0);
    let duration = so.duration;
    if (so.opponents === 0 && so.level === 'baby') duration = 0;
    const mode = so.opponents === 0 ? 'race' : so.mode;
    const cfg = { mode, level: so.level, seed, layoutId: so.layout, themeId, duration, players };
    go('game', { kind: 'solo', cfg, slot: 0, ai });
  };

  /* ---------- 對局畫面 ---------- */
  App.screens.game = function (p) {
    const gs = new root.GameScreen({
      kind: p.kind, cfg: p.cfg, slot: p.slot, ai: p.ai, t0Wall: p.t0Wall, serverNow: p.serverNow, goIn: p.goIn,
      onAgain: () => (p.kind === 'solo' ? App.startSolo() : root.Online.again()),
      onRoom: () => (p.kind === 'solo' ? go('solo') : root.Online.toRoom()),
      onExit: () => (p.kind === 'solo' ? go('solo') : root.Online.abandonToLobby()),
      onHome: () => (p.kind === 'solo' ? go('home') : root.Online.leaveToHome())
    });
    App.game = gs;
    return gs.root;
  };

  /* ---------- 設定彈窗 ---------- */
  App.openSettings = function () {
    if (App.settingsOpen) return;
    const st = App.store;
    const bgmVol = volume({ label: '音樂音量', value: st.bgmVol, disabled: !st.bgm, onChange: v => { st.bgmVol = v; save(); applySettings(); } });
    const sfxVol = volume({ label: '音效音量', value: st.sfxVol, disabled: !st.sfx, onChange: v => { st.sfxVol = v; save(); applySettings(); root.Sound.sfx('pop', 0); } });
    const bgmSw = toggle({ label: '背景音樂', value: st.bgm, onChange: v => { st.bgm = v; save(); applySettings(); bgmVol.setDisabled(!v); } });
    const sfxSw = toggle({ label: '音效', value: st.sfx, onChange: v => { st.sfx = v; save(); applySettings(); sfxVol.setDisabled(!v); if (v) root.Sound.sfx('pop', 0); } });
    const vibSw = toggle({ label: '震動', value: st.vibrate, onChange: v => { st.vibrate = v; save(); if (v && navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* 忽略 */ } } });
    const calmSw = toggle({ label: '減少動態', value: st.reduceMotion, onChange: v => { st.reduceMotion = v; save(); applySettings(); } });
    const lineSw = toggle({ label: '瞄準虛線', value: st.aimLine, onChange: v => { st.aimLine = v; save(); } });
    const aimSeg = seg({ label: '瞄準方式', options: [{ v: 'tap', label: '點哪射哪' }, { v: 'drag', label: '拖曳瞄準' }], value: st.aimMode, onChange: v => { st.aimMode = v; save(); } });
    const f = (label, ctl, hint) => h('div', { class: 'field' }, h('span', { class: 'label' }, label, hint ? h('span', { class: 'muted small' }, hint) : null), h('div', { class: 'ctl' }, ctl));
    const body = h('div', null,
      h('h3', { style: { margin: '4px 0' } }, '聲音'),
      f('背景音樂', [bgmSw, bgmVol]), f('音效', [sfxSw, sfxVol]),
      h('h3', { style: { margin: '10px 0 4px' } }, '操作與輔助'),
      f('瞄準方式', aimSeg, st.aimMode === 'tap' ? '' : ''),
      h('p', { class: 'muted small' }, '點哪射哪：一點螢幕就發射。拖曳瞄準：按住移動瞄準，放開才發射。'),
      f('瞄準虛線', lineSw),
      navigator.vibrate ? f('震動', vibSw) : null,
      f('減少動態', calmSw));
    const m = modal({
      title: '設定', content: body, cls: 'dialog-lg',
      actions: [btn('恢復預設', { cls: 'btn-ghost', onClick: () => { root.Store.resetSettings(st); applySettings(); m.close(true); App.settingsOpen = false; toast('已恢復預設設定'); App.openSettings(); } }),
        btn('完成', { cls: 'btn-mint', onClick: () => m.close() })],
      onClose: () => { App.settingsOpen = false; }
    });
    App.settingsOpen = true;
    const origClose = m.close;
    m.close = function (silent) { App.settingsOpen = false; origClose(silent); };
  };

  /* ---------- 連線狀態橫幅 ---------- */
  App.banner = function (text, busy) {
    const b = $('banner');
    b.textContent = '';
    if (!text) return;
    b.appendChild(h('div', { class: 'banner' }, busy ? h('span', { class: 'spin', html: Art.icon('refresh', 18) }) : null, h('span', { class: 'banner-txt' }, text)));
  };

  /* ---------- 返回鍵（Android／瀏覽器） ---------- */
  function onBack() {
    if (root.UI.modalOpen()) { root.UI.closeTopModal(); return true; }
    switch (App.screen) {
      case 'help': case 'solo': case 'lobby': go('home'); return true;
      case 'room': root.Online && root.Online.confirmLeave(); return true;
      case 'game': if (App.game) { App.game.kind === 'solo' ? App.game.pauseMenu() : App.game.confirmExit(); } return true;
    }
    return false;
  }

  /* ---------- 啟動 ---------- */
  App.boot = function () {
    App.el = $('app');
    const gear = $('gear');
    gear.innerHTML = Art.icon('gear', 26);
    gear.addEventListener('click', () => { root.Sound.sfx('click'); App.openSettings(); });
    document.addEventListener('pointerdown', () => root.Sound.unlock(), { passive: true });
    document.addEventListener('keydown', () => root.Sound.unlock(), { passive: true });
    applySettings();
    Art.preload();
    history.replaceState({ g: 0 }, '');
    history.pushState({ g: 1 }, '');
    root.addEventListener('popstate', () => {
      if (App.screen === 'home' && !root.UI.modalOpen()) return;
      onBack();
      history.pushState({ g: 1 }, '');
    });
    if (root.OnlineGlue) root.OnlineGlue.init();
    const q = new URLSearchParams(location.search);
    if (q.get('room') && (q.get('t') || q.get('invite'))) {
      App.invite = { room: String(q.get('room')).toUpperCase().slice(0, 8), token: String(q.get('t') || q.get('invite')).slice(0, 40), info: null, error: null };
      go('lobby');
    } else go('home');
  };

  App.util = { myName, save, applySettings, topbar, screenBox, shuffle, LEVEL_DD, TIME_OPTS };
  document.addEventListener('DOMContentLoaded', () => App.boot());
})(typeof self !== 'undefined' ? self : this);
