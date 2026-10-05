/* ===== game.js — 對局畫面（單機與線上共用） =====
 *
 * GameScreen 負責：
 *   - 版面：2 人左右等大；3～4 人自己的盤面大、其他人小；觀戰者全部等大
 *   - 輸入：點哪射哪／拖曳瞄準、鍵盤、交換泡泡（砲台右邊的 ⇄ 圖示按鈕，或 S 鍵）
 *   - 時鐘與事件：單機由瀏覽器當裁判（Match.input/tick + AI）；線上只送輸入、重播伺服器的事件
 *   - 左側資訊欄（摘要＋聊天室）、倒數、暫停、結算 overlay（再來一局／回到房間／回到首頁）
 */
(function (root) {
  'use strict';
  const { h, btn, iconBtn, avatar, toast, modal } = root.UI;
  const R = root.Rules, M = root.Match, Art = root.Art;
  const MODE_NAME = { race: '各自比賽', duel: '送泡泡對打' };
  const SHOT_GAP = 270;

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  class GameScreen {
    /** o = { kind:'solo'|'online', cfg, slot, ai:{slot:level}, t0Wall, serverNow, goIn, onAgain, onRoom, onHome } */
    constructor(o) {
      this.o = o; this.kind = o.kind; this.cfg = o.cfg; this.slot = o.slot == null ? 0 : o.slot;
      this.store = root.App.store;
      this.m = M.create(o.cfg);
      this.theme = Art.THEMES[o.cfg.themeId | 0] || Art.THEMES[0];
      this.spectator = this.slot < 0;
      this.paused = false; this.pausedAt = 0; this.pausedTotal = 0;
      this.lastShot = 0; this.lastAction = performance.now();
      this.keys = {}; this.over = false; this.resultShown = false; this.goShown = false; this.lastCount = 99;
      this.hintKey = ''; this.unread = 0; this.lastHud = 0; this.dead = false;
      this.offset = 0;
      if (this.kind === 'solo') {
        this.tStart = performance.now() + (o.goIn == null ? 3000 : o.goIn);
        this.brains = {};
        Object.keys(o.ai || {}).forEach(s => { this.brains[s] = root.AI.createBrain(o.ai[s], (o.cfg.seed + 977 * (+s + 1)) >>> 0); });
      } else {
        this.t0Wall = o.t0Wall;
        this.setClock(o.serverNow, o.t0Wall);
        this.hashSkip = 0; this.resyncAt = 0;
      }
      this.build();
      this.bindInput();
      this.last = performance.now();
      this.raf = requestAnimationFrame(t => this.loop(t));
      root.Sound.bgm(this.theme.music);
    }

    /* ---------- 時鐘 ---------- */
    setClock(serverNow, t0Wall) {
      const rtt = (root.Net.rtt || 0) * 1000;
      this.offset = serverNow + rtt / 2 - Date.now();
      this.t0Wall = t0Wall;
    }
    syncClock(mt) {
      /* 伺服器說「現在對局時間是 mt」→ 校正（平滑，避免跳動） */
      const rtt = (root.Net.rtt || 0) * 1000;
      const want = this.t0Wall + mt + rtt / 2 - Date.now();
      this.offset = this.offset * 0.7 + want * 0.3;
    }
    mt() {
      if (this.kind === 'solo') return (this.paused ? this.pausedAt : performance.now()) - this.tStart;
      return Date.now() + this.offset - this.t0Wall;
    }

    /* ---------- 版面 ---------- */
    build() {
      const n = this.cfg.players.length;
      this.root = h('div', { class: 'game game-' + (this.kind) + ' side-closed' });
      this.root.style.backgroundImage = 'url("' + Art.svgUrl(Art.themeBgSVG(this.theme.id)) + '")';

      /* 左側資訊欄 */
      this.sumEl = h('div', { class: 'summary' });
      const chatBox = this.kind === 'online' ? this.buildChat() : null;
      this.side = h('aside', { class: 'game-side', 'aria-label': '對局資訊' },
        h('div', { class: 'side-head' }, h('b', null, '對局資訊'),
          iconBtn('close', '收起資訊欄', () => this.toggleSide(false))),
        this.sumEl, chatBox);

      /* 盤面 */
      this.views = [];
      this.boardsEl = h('div', { class: 'boards' });
      const order = [];
      if (this.spectator) for (let i = 0; i < n; i++) order.push(i);
      else { order.push(this.slot); for (let i = 0; i < n; i++) if (i !== this.slot) order.push(i); }
      const mainLayout = !this.spectator && n >= 3;
      this.boardsEl.classList.add(mainLayout ? 'l-main' : (n === 2 ? 'l-two' : n === 1 ? 'l-one' : 'l-grid'), 'n' + n);
      const sets = () => this.store;
      order.forEach((s, idx) => {
        const p = this.cfg.players[s];
        const v = new root.BoardView({
          slot: s, name: p.name, dragon: p.dragon, theme: this.theme, mine: s === this.slot,
          audio: s === this.slot || (this.spectator && idx === 0), getT: () => this.mt(), settings: sets, small: mainLayout && idx > 0
        });
        v.setup(this.m);
        v.showAim = s === this.slot;
        this.views[s] = v;
        const tag = h('div', { class: 'btag' }, avatar(p.dragon, 30),
          h('span', { class: 'bt-name' }, p.name + (p.kind === 'ai' ? ' 🤖' : '')),
          h('span', { class: 'bt-n', 'data-n': s }, '0'));
        const slotEl = h('div', { class: 'bslot' + (s === this.slot ? ' mine' : '') + (mainLayout && idx > 0 ? ' small' : '') }, v.el, tag);
        this.boardsEl.appendChild(slotEl);
        if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => v.resize()); ro.observe(slotEl); (this.ros = this.ros || []).push(ro); }
      });

      /* 上方狀態列 */
      this.sideBadge = h('span', { class: 'badge', hidden: true }, '0');
      this.sideBtn = h('button', { type: 'button', class: 'icon-btn side-toggle', 'aria-label': '開關資訊欄', onClick: () => this.toggleSide() },
        h('span', { html: Art.icon('list', 22) }), this.sideBadge);
      this.timerEl = h('div', { class: 'hud-timer', role: 'timer' }, '0:00');
      this.modeEl = h('span', { class: 'pill' }, MODE_NAME[this.cfg.mode] + '・' + R.LEVEL_NAME[this.cfg.level]);
      this.exitBtn = this.kind === 'solo'
        ? iconBtn('pause', '暫停', () => this.pauseMenu())
        : iconBtn('back', '離開對局', () => this.confirmExit());
      this.hud = h('div', { class: 'hud' }, this.sideBtn, this.exitBtn, h('div', { class: 'hud-mid' }, this.timerEl, this.modeEl),
        this.spectator ? h('span', { class: 'pill sun' }, '觀戰中') : null);
      this.pingEl = this.kind === 'online' ? h('div', { class: 'ping' }, '-- ms') : null;
      this.overlay = h('div', { class: 'g-overlay', 'aria-live': 'assertive' });
      this.main = h('main', { class: 'game-main' }, this.hud, this.boardsEl);
      this.root.appendChild(this.side); this.root.appendChild(this.main);
      this.root.appendChild(this.overlay);
      if (this.pingEl) this.root.appendChild(this.pingEl);
      /* 寬螢幕預設展開資訊欄 */
      if (root.matchMedia && root.matchMedia('(min-width: 861px) and (min-aspect-ratio: 1/1)').matches) this.root.classList.remove('side-closed');
      if (!this.spectator) this.boardsEl.classList.add('can-play');
      this.renderSummary();
    }

    toggleSide(v) {
      const open = v == null ? this.root.classList.contains('side-closed') : v;
      this.root.classList.toggle('side-closed', !open);
      if (open) { this.unread = 0; this.updateBadge(); this.scrollChat(); }
      root.setTimeout(() => this.views.forEach(x => x && x.resize()), 260);
      root.setTimeout(() => this.views.forEach(x => x && x.resize()), 40);
    }
    updateBadge() { this.sideBadge.hidden = !this.unread; this.sideBadge.textContent = this.unread > 9 ? '9+' : this.unread; }

    /* ---------- 聊天（線上） ---------- */
    buildChat() {
      this.chatLog = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
      const input = h('input', { class: 'text-input', maxlength: 60, placeholder: '說點什麼…', 'aria-label': '聊天訊息' });
      const send = () => { const t = input.value.trim(); if (!t) return; root.Net.send({ type: 'chat', text: t }); input.value = ''; };
      input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send(); });
      const quick = ['好棒！', '加油！', '哈哈', '再來一局', '等等我'].map(t => h('button', { type: 'button', class: 'chip', onClick: () => root.Net.send({ type: 'chat', text: t }) }, t));
      this.chatBox = h('div', { class: 'side-chat' }, this.chatLog, h('div', { class: 'quick-chat' }, quick),
        h('div', { class: 'chat-form' }, input, btn('送出', { cls: 'btn-sm', onClick: send })));
      (root.Online ? root.Online.chat : []).forEach(m => this.addChat(m, true));
      return this.chatBox;
    }
    addChat(m, silent) {
      if (!this.chatLog) return;
      const sys = m.role === 'sys';
      this.chatLog.appendChild(h('div', { class: 'msg' + (sys ? ' sys' : '') }, sys ? null : h('b', null, m.name + '：'), m.text));
      while (this.chatLog.children.length > 80) this.chatLog.removeChild(this.chatLog.firstChild);
      this.scrollChat();
      if (!silent && this.root.classList.contains('side-closed')) { this.unread++; this.updateBadge(); }
      if (!silent && !sys) root.Sound.sfx('chat');
    }
    scrollChat() { if (this.chatLog) this.chatLog.scrollTop = this.chatLog.scrollHeight; }

    /* ---------- 摘要 ---------- */
    renderSummary() {
      const m = this.m, rows = [];
      const order = m.players.map((p, i) => i).sort((a, b) => (m.boards[b].cleared - m.boards[a].cleared) || a - b);
      const max = Math.max(1, ...m.boards.map(b => b.cleared));
      this.sumEl.textContent = '';
      this.sumEl.appendChild(h('div', { class: 'sum-meta' },
        h('div', null, h('b', null, MODE_NAME[m.mode]), '・', R.LEVEL_NAME[m.level]),
        h('div', { class: 'muted small' }, '地圖：' + (m.boards[0].layoutName || '隨機') + '・' + this.theme.name),
        h('div', { class: 'muted small' }, m.mode === 'duel' ? '消得多，就送泡泡給對手！' : '誰消得多誰贏，先清光也贏！')));
      order.forEach((s, rank) => {
        const p = m.players[s], b = m.boards[s];
        rows.push(h('div', { class: 'sum-row' + (s === this.slot ? ' me' : '') + (m.left[s] ? ' gone' : '') },
          h('span', { class: 'sum-rank' }, rank + 1),
          avatar(p.dragon, 34),
          h('div', { class: 'sum-main' }, h('div', { class: 'sum-name' }, p.name + (s === this.slot ? '（你）' : '') + (p.kind === 'ai' ? ' 🤖' : '')),
            h('div', { class: 'sum-bar' }, h('i', { style: { width: Math.round(b.cleared / max * 100) + '%' } }))),
          h('b', { class: 'sum-n' }, b.cleared)));
      });
      rows.forEach(r => this.sumEl.appendChild(r));
      const mine = !this.spectator ? m.boards[this.slot] : null;
      if (mine) this.sumEl.appendChild(h('div', { class: 'mystats' },
        h('div', { class: 'stat' }, h('b', null, mine.shots), h('span', null, '發射')),
        h('div', { class: 'stat' }, h('b', null, mine.maxCombo), h('span', null, '最高連擊')),
        m.mode === 'duel' ? h('div', { class: 'stat' }, h('b', null, mine.garbageOut), h('span', null, '送出')) : null,
        m.mode === 'duel' ? h('div', { class: 'stat' }, h('b', null, mine.garbageIn), h('span', null, '收到')) : null));
      this.sumEl.appendChild(h('div', { class: 'side-keys muted small keyline' },
        h('span', null, '瞄準 ', root.UI.keycap('←'), root.UI.keycap('→')), h('span', null, '發射 ', root.UI.keycap('空白')), h('span', null, '交換 ', root.UI.keycap('S'))));
    }

    /* ---------- 輸入 ---------- */
    bindInput() {
      if (this.spectator) return;
      const v = this.views[this.slot];
      const cv = v.canvas;
      cv.style.touchAction = 'none';
      let down = false;
      const upd = e => { const hh = v.hit(e.clientX, e.clientY); if (hh && !hh.swap) v.setAim(hh.angle); return hh; };
      cv.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' || down) upd(e);
      });
      cv.addEventListener('pointerdown', e => {
        root.Sound.unlock();
        if (this.paused || this.over) return;
        e.preventDefault();
        const hh = upd(e);
        if (hh.swap) { this.swap(); return; }
        down = true;
        try { cv.setPointerCapture(e.pointerId); } catch (er) { /* 忽略 */ }
        if (this.store.aimMode !== 'drag') { this.fire(v.aim); down = false; }
      });
      const up = e => {
        if (!down) return;
        down = false;
        if (this.store.aimMode === 'drag') { upd(e); this.fire(v.aim); }
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', () => { down = false; });
      this.onKey = e => {
        if (this.dead || modalOpen()) return;
        const tgt = e.target;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
        if (e.type === 'keydown') {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { this.keys.l = true; e.preventDefault(); }
          else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { this.keys.r = true; e.preventDefault(); }
          else if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && !e.repeat) {
            if (tgt && tgt.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
            e.preventDefault(); root.Sound.unlock(); this.fire(v.aim);
          } else if ((e.key === 's' || e.key === 'S' || e.key === 'Shift' || e.key === 'Tab' || e.key === 'ArrowDown') && !e.repeat) { e.preventDefault(); this.swap(); }
          else if (e.key === 'Escape' && this.kind === 'solo' && !this.over) { this.pauseMenu(); }
        } else {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.l = false;
          if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.r = false;
        }
      };
      root.addEventListener('keydown', this.onKey); root.addEventListener('keyup', this.onKey);
      this.onVis = () => { if (document.hidden && this.kind === 'solo' && !this.over && !this.paused && this.mt() > -2500) this.pauseMenu(); };
      document.addEventListener('visibilitychange', this.onVis);
    }

    canAct() {
      if (this.spectator || this.paused || this.over || this.dead) return false;
      if (this.mt() < 0) return false;
      const b = this.m.boards[this.slot];
      return !(b.fullClear || this.m.left[this.slot]);
    }
    fire(a) {
      if (!this.canAct()) return;
      const now = performance.now();
      if (now - this.lastShot < SHOT_GAP) return;
      this.lastShot = now; this.lastAction = now; this.clearHint();
      a = R.clampAngle(a);
      if (this.kind === 'solo') this.dispatch(M.input(this.m, this.slot, { t: 'shot', a }, this.mt()));
      else {
        root.Net.send({ type: 'shot', a });
        const v = this.views[this.slot]; v.pose = 'shoot'; v.poseUntil = now + 220;
      }
      if (this.store.vibrate && navigator.vibrate) navigator.vibrate(8);
    }
    swap() {
      if (!this.canAct()) return;
      this.lastAction = performance.now(); this.clearHint();
      if (this.kind === 'solo') this.dispatch(M.input(this.m, this.slot, { t: 'swap' }, this.mt()));
      else root.Net.send({ type: 'swap' });
    }

    /* ---------- 事件進場 ---------- */
    dispatch(list) {
      for (const it of list) {
        const ev = it.ev, res = it.res;
        for (const v of this.views) if (v) v.push(ev, res);
        if (ev.e === 'shot' && ev.s === this.slot && res && res.gained >= 5 && this.store.vibrate && navigator.vibrate) navigator.vibrate([20, 30, 20]);
        if (ev.e === 'end') this.onEnd();
      }
    }
    applyRemote(evs) {
      const out = [];
      for (const ev of evs) { const res = M.apply(this.m, ev); out.push({ ev, res }); }
      this.dispatch(out);
    }

    /* ---------- 線上訊息 ---------- */
    onNet(msg) {
      switch (msg.type) {
        case 'ev': this.applyRemote(msg.evs); if (msg.mt != null) this.syncClock(msg.mt); break;
        case 'clock': this.syncClock(msg.mt); break;
        case 'hash': {
          if (this.m.seq !== msg.seq) break;
          const mine = this.m.boards.map(b => R.boardHash(b));
          if (mine.join() !== msg.h.join() && performance.now() - this.resyncAt > 1500) {
            this.resyncAt = performance.now();
            root.Net.send({ type: 'resync' });
          }
          break;
        }
        case 'sync': {
          const m = root.MatchSnap.restoreAll(msg.snap);
          this.m = m;
          this.views.forEach(v => v && v.setup(m));
          if (msg.mt != null) this.syncClock(msg.mt);
          if (m.over && !this.over) this.onEnd();
          break;
        }
        case 'left': this.m.left[msg.slot] = true; if (msg.mt != null) this.syncClock(msg.mt); break;
        case 'result': if (!this.over) { this.m.over = true; this.m.result = msg.result; this.onEnd(); } break;
        default: break;
      }
    }

    /* ---------- 主迴圈 ---------- */
    loop(now) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(t => this.loop(t));
      const dt = Math.min(100, now - this.last); this.last = now;
      const t = this.mt();
      if (!this.paused) {
        if (this.kind === 'solo' && !this.over) {
          if (t >= 0) {
            this.dispatch(M.tick(this.m, t));
            for (const s of Object.keys(this.brains)) {
              const b = this.m.boards[s];
              if (this.m.over) break;
              const dec = root.AI.think(this.brains[s], b, dt, this.m.mode, !b.fullClear && !this.m.left[s]);
              if (dec) {
                if (dec.swap) this.dispatch(M.input(this.m, +s, { t: 'swap' }, t));
                this.dispatch(M.input(this.m, +s, { t: 'shot', a: dec.a }, t));
              }
            }
          }
        }
        /* 方向鍵連續瞄準：左鍵把砲口往左轉（角度變大） */
        if (!this.spectator && (this.keys.l || this.keys.r)) {
          const v = this.views[this.slot];
          v.setAim(v.aim + ((this.keys.l ? 1 : 0) - (this.keys.r ? 1 : 0)) * dt * 8);
        }
      }
      /* 倒數 */
      if (t < 0 && !this.over) {
        const c = Math.ceil(-t / 1000);
        if (c !== this.lastCount) { this.lastCount = c; this.showBig(String(c), 'count'); root.Sound.sfx('count'); }
      } else if (!this.goShown && !this.over) {
        this.goShown = true; this.showBig('開始！', 'go'); root.Sound.sfx('go');
        clearTimeout(this.goT); this.goT = setTimeout(() => { if (!this.over) this.overlay.textContent = ''; }, 800);
      }
      /* 幼幼班提示 */
      if (!this.spectator && this.m.level === 'baby' && !this.over && t > 0) this.maybeHint(now);
      for (const v of this.views) if (v) v.frame(now);
      if (now - this.lastHud > 250) { this.lastHud = now; this.updateHud(t); }
    }

    showBig(text, cls) {
      this.overlay.textContent = '';
      this.overlay.appendChild(h('div', { class: 'big-count ' + cls, key: text }, text));
    }

    clearHint() { this.views.forEach(v => { if (v) v.hint = null; }); this.hintKey = ''; }
    maybeHint(now) {
      const v = this.views[this.slot];
      if (!v || v.job || v.jobs.length || this.paused) return;
      if (now - this.lastAction < 2800) return;
      const b = this.m.boards[this.slot];
      const key = b.shots + ':' + b.cleared + ':' + b.garbageIn;
      if (v.hint && this.hintKey === key) return;
      if (this.hintKey === key && !v.hint) return;
      this.hintKey = key;
      v.hint = root.BoardMath.findHint(b);
    }

    updateHud(t) {
      const m = this.m;
      if (this.cfg.duration > 0) {
        const left = Math.max(0, this.cfg.duration - Math.max(0, t));
        this.timerEl.textContent = fmtTime(left);
        this.timerEl.classList.toggle('low', left < 15000 && !this.over);
      } else this.timerEl.textContent = '悠閒玩';
      this.boardsEl.querySelectorAll('.bt-n').forEach(el => { const s = +el.getAttribute('data-n'); el.textContent = m.boards[s].cleared; });
      this.renderSummary();
      if (this.pingEl) {
        const ms = Math.round((root.Net.rtt || 0) * 1000);
        this.pingEl.textContent = ms ? ms + ' ms' : '-- ms';
        this.pingEl.className = 'ping ' + (!ms ? '' : ms < 120 ? 'good' : ms < 250 ? 'mid' : 'bad');
      }
      for (const v of this.views) if (v) v.dim = false;
    }

    /* ---------- 暫停／離開 ---------- */
    pauseMenu() {
      if (this.kind !== 'solo' || this.over || this.paused) return;
      this.paused = true; this.pausedAt = performance.now();
      const resume = () => {
        if (!this.paused) return;
        this.tStart += performance.now() - this.pausedAt;
        this.paused = false; this.last = performance.now();
      };
      const mo = modal({
        title: '暫停中', cls: 'dialog-sm', dismissible: true, onClose: resume,
        content: h('div', { class: 'dialog-text' }, '休息一下，準備好再繼續吧！'),
        actions: [
          btn('繼續玩', { cls: 'btn-pink', icon: 'play', onClick: () => mo.close() }),
          btn('重新開始', { cls: 'btn-sky', icon: 'refresh', onClick: () => { mo.close(true); resume(); this.o.onAgain(); } }),
          btn('離開（回到房間）', { cls: 'btn-ghost', icon: 'back', onClick: () => { mo.close(true); resume(); this.o.onExit(); } })
        ]
      });
    }
    confirmExit() {
      if (this.over) return this.o.onExit();
      root.UI.confirmBox({
        title: '要離開對局嗎？', text: this.spectator ? '離開後就不再觀戰囉。' : '現在離開，這一局就算你放棄囉。', ok: '離開', cancel: '繼續玩',
        onOk: () => this.o.onExit()
      });
    }

    /* ---------- 結算 ---------- */
    onEnd() {
      if (this.over) return;
      this.over = true;
      this.clearHint();
      setTimeout(() => this.showResult(), 1100);
    }
    showResult() {
      if (this.dead || this.resultShown) return;
      this.resultShown = true;
      const r = this.m.result || { ranks: M.ranking(this.m), winner: 0, reason: 'time', mode: this.m.mode };
      const ranks = r.ranks;
      const me = this.spectator ? null : ranks.find(x => x.s === this.slot);
      const win = me && me.rank === 1;
      const tie = ranks.filter(x => x.rank === 1).length > 1;
      let head;
      if (this.spectator) head = ranks[0].name + ' 贏了！';
      else if (tie && me.rank === 1) head = '平手！一樣棒！';
      else head = win ? '你贏了！太棒了！' : (ranks[0].name + ' 贏了！');
      root.Sound.sfx(win ? 'win' : 'lose');
      this.overlay.textContent = '';
      if (!this.spectator) root.App.recordResult(this.kind, !!win);
      const maxCl = Math.max(1, ...ranks.map(x => x.cleared));
      const acc = x => (x.shots ? Math.round((x.hits | 0) / x.shots * 100) : 0);
      const rows = ranks.map(x => h('div', { class: 'rank-row' + (x.rank === 1 ? ' win' : '') + (x.s === this.slot ? ' me' : '') },
        h('span', { class: 'no' }, x.rank === 1 ? '🏆' : x.rank), avatar(x.dragon, 40),
        h('div', { class: 'rk-mid' },
          h('span', { class: 'nm' }, x.name + (x.s === this.slot ? '（你）' : '') + (x.fullClear ? '・清光' : '') + (x.left ? '・已離開' : '')),
          h('span', { class: 'rk-bar' }, h('i', { style: { width: Math.max(3, Math.round(x.cleared / maxCl * 100)) + '%' } })),
          h('span', { class: 'rk-meta' }, ['發射 ' + x.shots, '命中 ' + acc(x) + '%', '連擊 ' + x.maxCombo].concat(this.cfg.mode === 'duel' ? ['送 ' + x.garbageOut + '／收 ' + x.garbageIn] : []).map(t => h('i', null, t)))),
        h('b', null, x.cleared + ' 顆')));
      /* 我的（或冠軍的）戰績卡 */
      const who = (me || ranks[0]);
      const sec = Math.round((r.t || 0) / 1000);
      const tile = (ico, big, label) => h('div', { class: 'stat-tile' }, h('div', { class: 'st-ico' }, ico), h('b', null, big), h('span', null, label));
      const tiles = [
        tile('🫧', who.cleared, '清除泡泡'),
        tile('🎯', acc(who) + '%', '命中率'),
        tile('🔥', who.maxCombo, '最高連擊'),
        tile('💥', who.best | 0, '單發最多'),
        tile('🍂', who.dropN | 0, '掉落清除'),
        tile('⏱', Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'), '對局時間')
      ];
      if (who.rains) tiles.push(tile('🌧', who.rains, '泡泡雨'));
      if (this.cfg.mode === 'duel') tiles.push(tile('🎁', who.garbageOut + ' / ' + who.garbageIn, '送出 / 收到'));
      const stats = h('div', { class: 'stat-grid', 'aria-label': (this.spectator ? ranks[0].name : '你') + '的戰績' }, tiles);
      const dragon = this.spectator ? ranks[0].dragon : this.cfg.players[this.slot].dragon;
      const card = h('div', { class: 'dialog result-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': '結算' },
        h('div', { class: 'big-result' },
          h('img', { class: 'result-dragon', alt: '', src: Art.svgUrl(Art.dragonSVG(dragon, win || this.spectator ? 'cheer' : 'sad')) }),
          h('div', { class: 'head' }, head),
          h('div', { class: 'muted small' }, r.reason === 'clear' ? '有人把泡泡全部清光啦！' : r.reason === 'left' ? '其他人都離開了。' : '時間到！')),
        h('div', { class: 'stat-title' }, this.spectator ? ranks[0].name + ' 的戰績' : (me && me.rank === 1 ? '你的戰績' : '你的戰績')),
        stats,
        h('div', { class: 'rank' }, rows),
        h('div', { class: 'result-actions' },
          btn('再來一局', { cls: 'btn-pink btn-lg', icon: 'refresh', onClick: () => this.o.onAgain() }),
          btn('回到房間', { cls: 'btn-sky', icon: 'users', onClick: () => this.o.onRoom() }),
          btn('回到首頁', { cls: 'btn-ghost', icon: 'home', onClick: () => this.o.onHome() })));
      const wrap = h('div', { class: 'result-mask' }, card);
      this.overlay.appendChild(wrap);
      const first = card.querySelector('button'); if (first) first.focus();
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.goT);
      if (this.onKey) { root.removeEventListener('keydown', this.onKey); root.removeEventListener('keyup', this.onKey); }
      if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
      (this.ros || []).forEach(r => r.disconnect());
      root.Sound.bgm(null);
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }

  function modalOpen() { return root.UI.modalOpen && root.UI.modalOpen(); }

  root.GameScreen = GameScreen;
})(typeof self !== 'undefined' ? self : this);
