/* ===== app.js — 畫面切換、首頁、教學、單機設定、設定彈窗 ===== */
(function (root) {
  'use strict';
  const { h, btn, seg, stepper, toggle, volume, avatar, keycap, toast, modal } = root.UI;
  const R = root.Rules, Art = root.Art, AI = root.AI, Layouts = root.Layouts;
  const $ = id => document.getElementById(id);

  const T = (k, p, fb) => root.I18N.t(k, p, fb);
  /* 選項清單都在使用當下才組（語言切換後重畫就會換字） */
  const levelHint = k => T('level.hint.' + k);
  const levelOpts = () => R.LEVELS.map(k => ({ v: k, label: R.LEVEL_NAME[k] }));
  const aiDD = () => AI.LEVEL_ORDER.map(k => ({ v: k, label: R.LEVEL_NAME[k], hint: T('ai.hint.' + k) }));
  const timeOpts = () => [{ v: 120000, label: T('time.2') }, { v: 180000, label: T('time.3') }, { v: 300000, label: T('time.5') }, { v: 0, label: T('time.off') }];
  const modeOpts = () => [{ v: 'race', label: T('mode.race') }, { v: 'duel', label: T('mode.duel') }];
  const themeDD = () => [{ v: 'random', label: T('theme.random'), swatch: 'linear-gradient(135deg,#8fd6ff,#ffbfe0,#bdeecb)' }]
    .concat(Art.THEMES.map(t => ({ v: String(t.id), label: t.name, swatch: 'linear-gradient(135deg,' + t.sky[0] + ',' + t.sky[1] + ')' })));
  function layoutOpts() {
    const list = Layouts.list();
    const out = [{ v: 'random', label: T('layout.randomEach') }];
    list.filter(x => x.kind === 'pattern').forEach(x => out.push({ v: x.id, label: x.name, hint: x.group }));
    list.filter(x => x.kind === 'family').forEach(x => out.push({ v: x.id, label: x.name, hint: T('layout.family') }));
    return out;
  }
  const ADJ_N = 10;

  const App = {
    store: root.Store.load(), screen: null, params: null, game: null, el: null, screens: {}, util: {}
  };
  root.App = App;

  function myName() {
    const n = (App.store.nickname || '').trim();
    if (n) return n.slice(0, 10);
    if (App.autoAdj == null) App.autoAdj = Math.floor(Math.random() * ADJ_N);
    return T('auto.name', { adj: T('adj.' + App.autoAdj), dragon: T('dragon.short.' + App.store.dragon) });
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
    if (root.ServerOutage) root.ServerOutage.setScreen(name);
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
  const topbar = (title, backFn, extra) => h('div', { class: 'topbar' }, backFn ? root.UI.iconBtn('back', T('common.back'), backFn) : null, h('h2', null, title), extra);
  const img = (svg, cls, size) => h('img', { class: cls || '', alt: '', draggable: 'false', src: Art.svgUrl(svg), width: size, height: size });

  /* ---------- 首頁 ---------- */
  App.screens.home = function () {
    const st = App.store.stats, sline = [];
    if (st.solo) sline.push(T('home.statSolo', { w: st.solo.win, p: st.solo.play }));
    if (st.online) sline.push(T('home.statOnline', { w: st.online.win, p: st.online.play }));
    return screenBox('home center', [
      h('div', { class: 'hero' },
        h('img', { class: 'hero-logo', alt: T('app.name'), src: Art.svgUrl(Art.logoSVG()) }),
        h('h1', { class: 'sr' }, T('app.name')),
        h('p', { class: 'hero-sub' }, T('home.sub')),
        h('div', { class: 'hero-cast' }, Art.DRAGONS.map(d => avatar(d.id, 70)))),
      h('nav', { class: 'home-menu', 'aria-label': T('home.menu') },
        btn(T('home.solo'), { cls: 'btn-pink btn-lg btn-block', icon: 'robot', iconSize: 28, onClick: () => go('solo') }),
        btn(T('quest.entry.btn'), { cls: 'btn-sun btn-lg btn-block quest-entry', icon: 'flag', iconSize: 28, onClick: () => go('quest') }),
        btn(T('home.online'), { cls: 'btn-sky btn-lg btn-block', icon: 'users', iconSize: 28, onClick: () => go('lobby') }),
        btn(T('help.title'), { cls: 'btn-sun btn-lg btn-block', icon: 'help', iconSize: 28, onClick: () => go('help') })),
      sline.length ? h('p', { class: 'home-foot' }, T('home.stats') + sline.join('　')) : null
    ]);
  };

  /* ---------- 教學（純圖文，看得懂就好） ---------- */
  App.screens.help = function () {
    const fig = (key, name) => h('div', { class: 'help-item' }, img(key.startsWith('s:') ? Art.specialBubbleSVG(key.slice(2)) : Art.bubbleSVG(+key.split(':')[1], { mod: +key.split(':')[2] || 0 }), 'help-bub', 56), h('span', { class: 'help-txt' }, h('b', null, T('help.sp.' + name + '.n')), h('small', null, T('help.sp.' + name + '.d'))));
    return screenBox('', h('div', { class: 'wrap' },
      topbar(T('help.title'), () => go('home')),
      h('div', { class: 'help-grid' },
        h('section', { class: 'card' }, h('h3', null, T('help.goal.h')),
          h('p', null, T('help.goal.p1')),
          h('p', { class: 'muted small', style: { marginTop: '6px' } }, T('help.goal.p2'))),
        h('section', { class: 'card' }, h('h3', null, T('help.shoot.h')),
          h('p', null, T('help.shoot.p1')),
          h('p', { class: 'keyline', style: { margin: '6px 0' } }, h('span', null, T('help.shoot.kb')), h('span', null, T('key.aim'), keycap('←'), keycap('→')), h('span', null, T('key.fire'), keycap(T('key.space'), 'wide')), h('span', null, T('help.shoot.swap'), keycap('S'))),
          h('p', { class: 'muted small' }, T('help.shoot.p3')))),
      h('section', { class: 'card' }, h('h3', null, T('help.special.h')),
        h('div', { class: 'help-items' },
          fig('s:rainbow', 'rainbow'),
          fig('s:star', 'star'),
          fig('b:2:1', 'starmark'),
          fig('s:laser', 'laser'),
          fig('b:3:2', 'coin'),
          fig('s:cloud', 'cloud'))),
      h('section', { class: 'card' }, h('h3', null, T('help.fall.h')),
        h('p', null, T('help.fall.p'))),
      h('section', { class: 'card' }, h('h3', null, T('help.duel.h')),
        h('p', null, T('help.duel.p1')),
        h('p', { class: 'muted small', style: { marginTop: '6px' } }, T('help.duel.p2'))),
      h('section', { class: 'card' }, h('h3', null, T('help.levels.h')),
        h('div', { class: 'help-levels' }, R.LEVELS.map(k => h('div', null, h('b', null, R.LEVEL_NAME[k]), '　', h('span', { class: 'muted' }, levelHint(k)))))),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        btn(T('help.start'), { cls: 'btn-pink btn-lg', onClick: () => go('solo') }),
        btn(T('common.home'), { cls: 'btn-ghost btn-lg', onClick: () => go('home') }))));
  };

  /* ---------- 暱稱與龍 ---------- */
  App.profileEditor = function (o) {
    o = o || {};
    const st = App.store;
    const input = h('input', {
      class: 'text-input', type: 'text', maxlength: 10, value: st.nickname || '', placeholder: T('profile.ph'), 'aria-label': T('profile.nick'), autocomplete: 'off', enterkeyhint: 'done',
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
        h('div', { class: 'field' }, h('span', { class: 'label' }, T('profile.nick')), h('div', { class: 'ctl', style: { justifyContent: 'stretch' } }, input)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, T('profile.dragon')), h('div', { class: 'ctl', style: { justifyContent: 'stretch' } }, h('div', { class: 'animal-grid', role: 'radiogroup', 'aria-label': T('profile.pick'), style: { width: '100%' } }, btns)))),
      input
    };
  };

  /* ---------- 規則面板（單機與線上房間共用） ---------- */
  App.rulesPanel = function (rules, set, o) {
    o = o || {};
    const f = (label, ctl) => h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'ctl' }, ctl));
    const rows = [];
    if (!o.noMode) rows.push(f(T('rules.mode'), seg({ label: T('rules.mode'), options: modeOpts().map(x => Object.assign({}, x, { disabled: x.v === 'duel' && o.duelDisabled })), value: rules.mode, onChange: v => set({ mode: v }) })));
    rows.push(f(T('rules.level'), seg({ label: T('rules.level'), cls: 'small', options: levelOpts(), value: rules.level, onChange: v => set({ level: v }) })));
    rows.push(f(T('rules.map'), root.UI.dropdown({ label: T('rules.map'), options: layoutOpts(), value: rules.layout, onChange: v => set({ layout: v }) })));
    rows.push(f(T('rules.theme'), root.UI.dropdown({ label: T('rules.theme'), options: themeDD(), value: String(rules.theme), onChange: v => set({ theme: v }) })));
    rows.push(f(T('rules.time'), seg({ label: T('rules.time'), options: o.noUnlimited ? timeOpts().slice(0, 3) : timeOpts(), value: rules.duration, onChange: v => set({ duration: v }) })));
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
        rows.push(h('div', { class: 'ai-row' }, h('span', { class: 'name' }, T('solo.cpu', { n: i + 1 })),
          root.UI.dropdown({ label: T('solo.cpuLevel', { n: i + 1 }), cls: 'lvl', options: aiDD(), value: so.aiLevels[i], onChange: v => { so.aiLevels[i] = v; save(); } })));
      }
      oppBox.appendChild(h('div', null,
        f(T('solo.opp'), stepper({ label: T('solo.count'), min: 0, max: 3, value: so.opponents, onChange: v => { so.opponents = v; if (v === 0) so.mode = 'race'; save(); paintOpp(); paintPanel(); } })),
        so.opponents ? h('div', { class: 'ai-rows' }, rows) : h('p', { class: 'muted small' }, T('solo.alone'))));
    }
    function paintPanel() {
      panelBox.textContent = '';
      panelBox.appendChild(App.rulesPanel(so, patch => {
        Object.assign(so, patch);
        if ('theme' in patch) so.theme = String(patch.theme);
        save();
        if ('mode' in patch || 'level' in patch) paintPanel();
      }, { duelDisabled: so.opponents === 0 }));
      if (so.opponents === 0 && so.level === 'baby') panelBox.appendChild(h('p', { class: 'hint' }, T('solo.babyHint')));
    }
    paintOpp(); paintPanel();
    return screenBox('', h('div', { class: 'wrap' },
      topbar(T('home.solo'), () => go('home')),
      h('div', { class: 'room-grid' },
        h('div', { style: { display: 'grid', gap: '14px', alignContent: 'start' } },
          h('section', { class: 'card' }, h('h3', null, T('solo.yourDragon')), prof.el),
          h('section', { class: 'card' }, h('h3', null, T('solo.opponents')), oppBox)),
        h('div', { style: { display: 'grid', gap: '14px', alignContent: 'start' } },
          h('section', { class: 'card' }, h('h3', null, T('rules.h')), panelBox))),
      h('div', { class: 'sticky-cta' }, btn(T('solo.start'), { cls: 'btn-pink btn-lg btn-block', icon: 'play', iconSize: 26, onClick: () => App.startSolo() }))));
  };

  /* ---------- 單機開局 ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  App.startSolo = function () {
    const st = App.store, so = st.solo;
    const others = shuffle(Art.DRAGONS.map(d => d.id).filter(id => id !== st.dragon));
    const players = [{ name: myName(), dragon: st.dragon, kind: 'human' }];
    const ai = {};
    for (let i = 0; i < so.opponents; i++) {
      players.push({ name: T('ai.name', { dragon: T('dragon.short.' + others[i]) }), dragon: others[i], kind: 'ai', aiLevel: so.aiLevels[i] });
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
      onAgain: () => (p.quest ? App.beginQuest(p.quest) : p.kind === 'solo' ? App.startSolo() : root.Online.again()),
      onNext: () => go('questLevels', { level: p.quest.level, open: p.quest.no + 1 }),
      onRoom: () => (p.quest ? go('questLevels', { level: p.quest.level }) : p.kind === 'solo' ? go('solo') : root.Online.toRoom()),
      onExit: () => (p.quest ? go('questLevels', { level: p.quest.level }) : p.kind === 'solo' ? go('solo') : root.Online.abandonToLobby()),
      onHome: () => (p.kind === 'solo' ? go('home') : root.Online.leaveToHome())
    });
    App.game = gs;
    return gs.root;
  };

  /* ---------- 設定彈窗 ---------- */
  App.openSettings = function () {
    if (App.settingsOpen) return;
    const st = App.store;
    const build = () => {
      const bgmVol = volume({ label: T('set.bgmVol'), value: st.bgmVol, disabled: !st.bgm, onChange: v => { st.bgmVol = v; save(); applySettings(); } });
      const sfxVol = volume({ label: T('set.sfxVol'), value: st.sfxVol, disabled: !st.sfx, onChange: v => { st.sfxVol = v; save(); applySettings(); root.Sound.sfx('pop', 0); } });
      const bgmSw = toggle({ label: T('set.bgm'), value: st.bgm, onChange: v => { st.bgm = v; save(); applySettings(); bgmVol.setDisabled(!v); } });
      const sfxSw = toggle({ label: T('set.sfx'), value: st.sfx, onChange: v => { st.sfx = v; save(); applySettings(); sfxVol.setDisabled(!v); if (v) root.Sound.sfx('pop', 0); } });
      const vibSw = toggle({ label: T('set.vibrate'), value: st.vibrate, onChange: v => { st.vibrate = v; save(); if (v && navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* 忽略 */ } } });
      const calmSw = toggle({ label: T('set.calm'), value: st.reduceMotion, onChange: v => { st.reduceMotion = v; save(); applySettings(); } });
      const lineSw = toggle({ label: T('set.aimLine'), value: st.aimLine, onChange: v => { st.aimLine = v; save(); } });
      const aimSeg = seg({ label: T('set.aimMode'), options: [{ v: 'tap', label: T('set.aimTap') }, { v: 'drag', label: T('set.aimDrag') }], value: st.aimMode, onChange: v => { st.aimMode = v; save(); } });
      const f = (label, ctl, hint) => h('div', { class: 'field' }, h('span', { class: 'label' }, label, hint ? h('span', { class: 'muted small' }, hint) : null), h('div', { class: 'ctl' }, ctl));
      const body = h('div', null,
        h('h3', { style: { margin: '4px 0' } }, T('set.sound')),
        f(T('set.bgm'), [bgmSw, bgmVol]), f(T('set.sfx'), [sfxSw, sfxVol]),
        h('h3', { style: { margin: '10px 0 4px' } }, T('set.controls')),
        f(T('set.aimMode'), aimSeg),
        h('p', { class: 'muted small' }, T('set.aimHelp')),
        f(T('set.aimLine'), lineSw),
        navigator.vibrate ? f(T('set.vibrate'), vibSw) : null,
        f(T('set.calm'), calmSw));
      return {
        title: T('set.title'), content: body,
        actions: [btn(T('set.reset'), { cls: 'btn-ghost', onClick: () => { root.Store.resetSettings(st); applySettings(); m.close(true); App.settingsOpen = false; toast(T('toast.resetDone')); App.openSettings(); } }),
          btn(T('common.done'), { cls: 'btn-mint', onClick: () => m.close() })]
      };
    };
    const m = modal({
      cls: 'dialog-lg', render: build,
      onClose: () => { App.settingsOpen = false; }
    });
    App.settingsOpen = true;
    const origClose = m.close;
    m.close = function (silent) { App.settingsOpen = false; origClose(silent); };
  };

  /* ---------- 連線狀態橫幅（text 可為字串或函式，語言切換時重新取字） ---------- */
  App.banner = function (text, busy) {
    const b = $('banner');
    b.textContent = '';
    App._banner = text ? { text, busy } : null;
    if (!text) return;
    b.appendChild(h('div', { class: 'banner' }, busy ? h('span', { class: 'spin', html: Art.icon('refresh', 18) }) : null, h('span', { class: 'banner-txt' }, typeof text === 'function' ? text() : text)));
  };

  /* ---------- 返回鍵（Android／瀏覽器） ---------- */
  function onBack() {
    if (root.UI.modalOpen()) { root.UI.closeTopModal(); return true; }
    switch (App.screen) {
      case 'help': case 'solo': case 'lobby': go('home'); return true;
      case 'quest': go('home'); return true;
      case 'questLevels': go('quest'); return true;
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
    /* 語言切換鈕：設定鈕左邊（同一排） */
    root.I18N.mountToggle({ after: gear, id: 'b-lang', className: 'icon-btn' });
    const lobbyLink = $('lobby-home-link');
    const syncLobbyLink = () => { if (lobbyLink) lobbyLink.href = root.I18N.withLang(lobbyLink.getAttribute('data-base') || lobbyLink.href); };
    if (lobbyLink) lobbyLink.setAttribute('data-base', lobbyLink.getAttribute('href'));
    syncLobbyLink();
    /* 切換語言：畫面重畫文字，不重置對局狀態 */
    root.I18N.onChange(() => {
      syncLobbyLink();
      if (App.screen === 'game') { if (App.game && App.game.relocalize) App.game.relocalize(); }
      else if (App.screen) go(App.screen, App.params, { quiet: true });
      if (App._banner) App.banner(App._banner.text, App._banner.busy);
    });
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

  App.util = { myName, save, applySettings, topbar, screenBox, shuffle, get LEVEL_DD() { return levelOpts(); }, get TIME_OPTS() { return timeOpts(); } };
  document.addEventListener('DOMContentLoaded', () => App.boot());
})(typeof self !== 'undefined' ? self : this);
