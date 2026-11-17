/* ===== game.js — 單機對局畫面 =====
 *
 * GameScreen 負責：
 *   - 版面：顯示自己的盤面和 0～3 個電腦對手
 *   - 輸入：點哪射哪／拖曳瞄準、鍵盤、交換泡泡（砲台右邊的 ⇄ 圖示按鈕，或 S 鍵）
 *   - 時鐘與事件：瀏覽器處理玩家輸入、電腦 AI 與對局規則
 *   - 左側資訊欄、倒數、暫停、結算 overlay
 */
(function (root) {
  'use strict';
  const { h, btn, iconBtn, avatar, toast, modal } = root.UI;
  const R = root.Rules, M = root.Match, Art = root.Art;
  const T = (k, p, fb) => root.I18N.t(k, p, fb);
  const modeName = m => T('mode.' + m);
  /* 電腦玩家的名字跟著語言走；真人暱稱原樣顯示 */
  const pname = p => (p && p.kind === 'ai' ? T('ai.name', { dragon: T('dragon.short.' + p.dragon) }) : (p ? p.name : ''));
  const SHOT_GAP = 270;

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  class GameScreen {
    /** o = { cfg, slot, ai:{slot:level}, onAgain, onSetup, onHome } */
    constructor(o) {
      this.o = o; this.cfg = o.cfg; this.slot = o.slot == null ? 0 : o.slot;
      this.store = root.App.store;
      this.m = M.create(o.cfg);
      this.quest = o.cfg.mode === 'quest' ? o.cfg.quest : null;      /* 闖關：本關的定義（單機專屬） */
      this.theme = Art.THEMES[o.cfg.themeId | 0] || Art.THEMES[0];
      if (root.GameAnalytics) root.GameAnalytics.start(this.quest ? { mode: 'solo', variant: 'quest', difficulty: this.m.level, content_id: this.quest.id, players: 1 } : { mode: 'solo', difficulty: this.m.level, players: this.m.players.length });
      this.paused = false; this.pausedAt = 0; this.pausedTotal = 0;
      this.lastShot = 0; this.lastAction = performance.now();
      this.keys = {}; this.over = false; this.resultShown = false; this.goShown = false; this.lastCount = 99;
      this.hintKey = ''; this.lastHud = 0; this.dead = false;
      this.tStart = performance.now() + (root.__GO_IN >= 0 ? root.__GO_IN : 3000);
      this.brains = {};
      Object.keys(o.ai || {}).forEach(s => { this.brains[s] = root.AI.createBrain(o.ai[s], (o.cfg.seed + 977 * (+s + 1)) >>> 0); });
      this.build();
      this.bindInput();
      this.last = performance.now();
      this.raf = requestAnimationFrame(t => this.loop(t));
      root.Sound.bgm(this.theme.music);
    }

    mt() {
      return (this.paused ? this.pausedAt : performance.now()) - this.tStart;
    }

    /* ---------- 版面 ---------- */
    build() {
      const n = this.cfg.players.length;
      this.root = h('div', { class: 'game game-solo side-closed' });
      this.root.style.backgroundImage = 'url("' + Art.svgUrl(Art.themeBgSVG(this.theme.id)) + '")';

      /* 左側資訊欄 */
      this.sumEl = h('div', { class: 'summary' });
      this.sideClose = iconBtn('panelHide', T('game.hideSide'), () => this.toggleSide(false), 'side-close');
      this.side = h('aside', { class: 'game-side', 'aria-label': T('game.info') },
        h('div', { class: 'side-head' }, this.sideTitle = h('b', null, T('game.info'))),
        this.sumEl);

      /* 盤面 */
      this.views = [];
      this.boardsEl = h('div', { class: 'boards' });
      const order = [];
      order.push(this.slot);
      for (let i = 0; i < n; i++) if (i !== this.slot) order.push(i);
      const mainLayout = n >= 3;
      this.boardsEl.classList.add(mainLayout ? 'l-main' : (n === 2 ? 'l-two' : n === 1 ? 'l-one' : 'l-grid'), 'n' + n);
      const sets = () => this.store;
      order.forEach((s, idx) => {
        const p = this.cfg.players[s];
        const v = new root.BoardView({
          slot: s, name: p.name, dragon: p.dragon, theme: this.theme, mine: s === this.slot,
          audio: s === this.slot, getT: () => this.mt(), settings: sets, small: mainLayout && idx > 0
        });
        v.setup(this.m);
        v.showAim = s === this.slot;
        this.views[s] = v;
        const tag = h('div', { class: 'btag' }, avatar(p.dragon, 30),
          h('span', { class: 'bt-name', 'data-s': s }, pname(p) + (p.kind === 'ai' ? ' 🤖' : '')),
          h('span', { class: 'bt-n', 'data-n': s }, '0'));
        if (idx === 0) this.mainTag = tag;     /* 主盤面的名牌改放進上方那一排（跟計時牌、暫停鍵同排） */
        const slotEl = h('div', { class: 'bslot' + (s === this.slot ? ' mine' : '') + (mainLayout && idx > 0 ? ' small' : '') }, v.el, idx === 0 ? null : tag);
        if ((mainLayout || n === 2) && s !== this.slot) {
          if (!this.oppCol) { this.oppCol = h('div', { class: 'opp-col' }); this.boardsEl.appendChild(this.oppCol); }
          this.oppCol.appendChild(slotEl);
        } else this.boardsEl.appendChild(slotEl);
        if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => v.resize()); ro.observe(slotEl); (this.ros = this.ros || []).push(ro); }
      });

      /* 上方狀態列 */
      this.sideBtn = h('button', { type: 'button', class: 'icon-btn side-toggle', 'aria-label': T('game.showSide'), 'aria-expanded': 'false', onClick: () => this.toggleSide() },
        this.sideIcon = h('span', { html: Art.icon('panelShow', 22) }));
      this.timerEl = h('div', { class: 'board-time', role: 'timer' }, '0:00');
      this.modeEl = h('span', { class: 'pill' }, this.modeLabel());
      this.exitBtn = iconBtn('pause', T('game.pause'), () => this.pauseMenu(), 'board-pause');
      /* 主盤面正上方一排：名牌（左）、計時牌（中）、暫停鍵（右），寬度跟盤面一樣、左右貼齊盤面；造型跟著地圖主題 */
      const th = this.theme;
      this.timerBox = h('div', { class: 'board-timer' }, this.timerEl);
      this.boardBar = h('div', { class: 'board-bar t-' + (th.set || 'default') }, this.mainTag, this.timerBox, this.exitBtn);
      this.boardBar.style.setProperty('--f0', th.frame[0]); this.boardBar.style.setProperty('--f1', th.frame[1]);
      this.boardBar.style.setProperty('--ac', th.accent);
      const mainView = this.views[order[0]];
      mainView.el.appendChild(this.boardBar);
      if (mainView.el.parentNode) mainView.el.parentNode.classList.add('has-timer');
      this.hud = h('div', { class: 'hud' }, this.sideBtn, h('div', { class: 'hud-mid' }, this.modeEl));
      this.overlay = h('div', { class: 'g-overlay', 'aria-live': 'assertive' });
      this.main = h('main', { class: 'game-main' }, this.hud, this.boardsEl);
      this.root.appendChild(this.side); this.root.appendChild(this.sideClose); this.root.appendChild(this.main);
      this.root.appendChild(this.overlay);
      /* 寬螢幕預設展開資訊欄 */
      if (root.matchMedia && root.matchMedia('(min-width: 861px) and (min-aspect-ratio: 1/1)').matches) { this.root.classList.remove('side-closed'); this.syncSideIcon(); }
      this.boardsEl.classList.add('can-play');
      this.renderSummary();
      if (this.quest) this.showQuestHint();
    }

    modeLabel() {
      return (this.quest ? T('quest.levelN', { n: this.quest.no }) : modeName(this.cfg.mode)) + '・' + R.LEVEL_NAME[this.cfg.level];
    }

    /** 資訊欄開關鈕：開著顯示「收起」雙箭頭（«），關著顯示「展開」雙箭頭（»） */
    syncSideIcon() {
      const open = !this.root.classList.contains('side-closed');
      if (this.sideIcon) this.sideIcon.innerHTML = Art.icon(open ? 'panelHide' : 'panelShow', 22);
      this.sideBtn.setAttribute('aria-label', open ? T('game.hideSide') : T('game.showSide'));
      this.sideBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggleSide(v) {
      const open = v == null ? this.root.classList.contains('side-closed') : v;
      this.root.classList.toggle('side-closed', !open);
      this.syncSideIcon();
      root.setTimeout(() => this.views.forEach(x => x && x.resize()), 260);
      root.setTimeout(() => this.views.forEach(x => x && x.resize()), 40);
    }

    /* ---------- 摘要 ---------- */
    renderSummary() {
      if (this.quest) return this.renderQuestSummary();
      const m = this.m, rows = [];
      const order = m.players.map((p, i) => i).sort((a, b) => (m.boards[b].cleared - m.boards[a].cleared) || a - b);
      const max = Math.max(1, ...m.boards.map(b => b.cleared));
      this.sumEl.textContent = '';
      this.sumEl.appendChild(h('div', { class: 'sum-meta' },
        h('div', null, h('b', null, modeName(m.mode)), '・', R.LEVEL_NAME[m.level]),
        h('div', { class: 'muted small' }, T('game.map') + (m.boards[0].layoutId ? T('layout.' + m.boards[0].layoutId, null, m.boards[0].layoutName) : T('game.random')) + '・' + this.theme.name),
        h('div', { class: 'muted small' }, m.mode === 'duel' ? T('game.goalDuel') : T('game.goalRace'))));
      order.forEach((s, rank) => {
        const p = m.players[s], b = m.boards[s];
        rows.push(h('div', { class: 'sum-row' + (s === this.slot ? ' me' : '') },
          h('span', { class: 'sum-rank' }, rank + 1),
          avatar(p.dragon, 34),
          h('div', { class: 'sum-main' }, h('div', { class: 'sum-name' }, pname(p) + (s === this.slot ? T('game.you') : '') + (p.kind === 'ai' ? ' 🤖' : '')),
            h('div', { class: 'sum-bar' }, h('i', { style: { width: Math.round(b.cleared / max * 100) + '%' } }))),
          h('b', { class: 'sum-n' }, b.cleared)));
      });
      rows.forEach(r => this.sumEl.appendChild(r));
      const mine = m.boards[this.slot];
      this.sumEl.appendChild(h('div', { class: 'mystats' },
        h('div', { class: 'stat' }, h('b', null, mine.shots), h('span', null, T('stat.shots'))),
        h('div', { class: 'stat' }, h('b', null, mine.maxCombo), h('span', null, T('stat.combo'))),
        m.mode === 'duel' ? h('div', { class: 'stat' }, h('b', null, mine.garbageOut), h('span', null, T('stat.out'))) : null,
        m.mode === 'duel' ? h('div', { class: 'stat' }, h('b', null, mine.garbageIn), h('span', null, T('stat.in'))) : null));
      this.sumEl.appendChild(h('div', { class: 'side-keys muted small keyline' },
        h('span', null, T('key.aim'), root.UI.keycap('←'), root.UI.keycap('→')), h('span', null, T('key.fire'), root.UI.keycap(T('key.space'))), h('span', null, T('key.swap'), root.UI.keycap('S'))));
    }

    /* ---------- 闖關：資訊欄與提示 ---------- */
    renderQuestSummary() {
      const b = this.m.boards[0], q = b.quest, prog = R.questProgress(b), QU = root.QuestUI;
      const pct = prog.need ? Math.min(100, Math.round(prog.cur / prog.need * 100)) : 0;
      this.sumEl.textContent = '';
      this.sumEl.appendChild(h('div', { class: 'sum-meta' },
        h('div', null, h('b', null, T('quest.levelN', { n: this.quest.no })), '・', R.LEVEL_NAME[this.m.level], this.quest.boss ? h('span', { class: 'pill pink q-pill' }, T('quest.boss')) : null),
        h('div', { class: 'muted small' }, T('game.map') + QU.layoutName(this.quest) + '・' + this.theme.name)));
      this.sumEl.appendChild(h('div', { class: 'q-goal' }, QU.goalIcon(q, 38),
        h('div', { class: 'q-goal-main' }, h('b', null, T('quest.goal.h')), h('div', { class: 'small' }, QU.goalText(q)),
          h('div', { class: 'sum-bar' }, h('i', { style: { width: pct + '%' } })),
          h('span', { class: 'q-prog' }, T('quest.hud.progress', { cur: prog.cur, need: prog.need })))));
      this.sumEl.appendChild(h('div', { class: 'q-shots' + (q.shots && q.shots - b.shots <= 3 ? ' low' : '') }, q.shots ? T('quest.shotsLeft', { n: Math.max(0, q.shots - b.shots) }) : T('quest.shotsUsed', { n: b.shots })));
      if (q.mini) this.sumEl.appendChild(h('div', { class: 'q-mini' + (R.questMini(b) ? ' ok' : '') },
        h('span', { class: 'q-mini-ico', html: root.Art.icon(R.questMini(b) ? 'check' : 'star', 18) }),
        h('div', null, h('b', null, T('quest.mini.h')), h('div', { class: 'small' }, QU.miniText(q.mini)))));
      this.sumEl.appendChild(h('div', { class: 'side-keys muted small keyline' },
        h('span', null, T('key.aim'), root.UI.keycap('←'), root.UI.keycap('→')), h('span', null, T('key.fire'), root.UI.keycap(T('key.space'))), h('span', null, T('key.swap'), root.UI.keycap('S'))));
    }
    /** 新機制第一次出現時，開局彈一句提示泡泡；看過就記起來，之後不再出現 */
    showQuestHint() {
      const key = this.quest.hint;
      if (!key || root.Store.questHintSeen(this.store, key)) return;
      root.Store.questHintMark(this.store, key);
      this.hintBubble = h('div', { class: 'q-hint', role: 'status', 'data-hint': key, onClick: () => this.hideQuestHint() },
        h('span', { class: 'q-hint-ico', html: root.Art.icon('help', 22) }), h('span', { class: 'q-hint-txt', 'data-k': key }, T('quest.hint.' + key)));
      (this.views[this.slot].el || this.boardsEl).appendChild(this.hintBubble);
      this.hintT = setTimeout(() => this.hideQuestHint(), 9000);
    }
    hideQuestHint() {
      clearTimeout(this.hintT);
      if (this.hintBubble) { const el = this.hintBubble; this.hintBubble = null; el.classList.add('out'); setTimeout(() => el.remove(), 250); }
    }

    /* ---------- 輸入 ---------- */
    bindInput() {
      const v = this.views[this.slot];
      const cv = v.canvas;
      cv.style.touchAction = 'none';
      let down = false;
      const upd = e => { const hh = v.hit(e.clientX, e.clientY); if (hh && !hh.swap) v.setAim(hh.angle); return hh; };
      const hover = on => { if (v.hoverSwap !== on) { v.hoverSwap = on; cv.style.cursor = on ? 'pointer' : ''; } };
      cv.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' || down) { const hh = upd(e); hover(e.pointerType === 'mouse' && !!(hh && hh.swap)); }
      });
      cv.addEventListener('pointerleave', () => hover(false));
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
          else if (e.key === 'Escape' && !this.over) { this.pauseMenu(); }
        } else {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.l = false;
          if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.r = false;
        }
      };
      root.addEventListener('keydown', this.onKey); root.addEventListener('keyup', this.onKey);
      this.onVis = () => { if (document.hidden && !this.over && !this.paused && this.mt() > -2500) this.pauseMenu(); };
      document.addEventListener('visibilitychange', this.onVis);
    }

    canAct() {
      if (this.paused || this.over || this.dead) return false;
      if (this.mt() < 0) return false;
      const b = this.m.boards[this.slot];
      return !b.fullClear;
    }
    fire(a) {
      if (!this.canAct()) return;
      const now = performance.now();
      if (now - this.lastShot < SHOT_GAP) return;
      this.lastShot = now; this.lastAction = now; this.clearHint(); this.hideQuestHint();
      a = R.clampAngle(a);
      this.dispatch(M.input(this.m, this.slot, { t: 'shot', a }, this.mt()));
      if (this.store.vibrate && navigator.vibrate) navigator.vibrate(8);
    }
    swap() {
      if (!this.canAct()) return;
      this.lastAction = performance.now(); this.clearHint();
      this.dispatch(M.input(this.m, this.slot, { t: 'swap' }, this.mt()));
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
    /* ---------- 主迴圈 ---------- */
    loop(now) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(t => this.loop(t));
      const dt = Math.min(100, now - this.last); this.last = now;
      const t = this.mt();
      if (!this.paused) {
        if (!this.over) {
          if (t >= 0) {
            this.dispatch(M.tick(this.m, t));
            for (const s of Object.keys(this.brains)) {
              const b = this.m.boards[s];
              if (this.m.over) break;
              const dec = root.AI.think(this.brains[s], b, dt, this.m.mode, !b.fullClear);
              if (dec) {
                if (dec.swap) this.dispatch(M.input(this.m, +s, { t: 'swap' }, t));
                this.dispatch(M.input(this.m, +s, { t: 'shot', a: dec.a }, t));
              }
            }
          }
        }
        /* 方向鍵連續瞄準：左鍵把砲口往左轉（角度變大） */
        if (this.keys.l || this.keys.r) {
          const v = this.views[this.slot];
          v.setAim(v.aim + ((this.keys.l ? 1 : 0) - (this.keys.r ? 1 : 0)) * dt * 8);
        }
      }
      /* 倒數 */
      if (t < 0 && !this.over) {
        const c = Math.ceil(-t / 1000);
        if (c !== this.lastCount) { this.lastCount = c; this.showBig(String(c), 'count'); root.Sound.sfx('count'); }
      } else if (!this.goShown && !this.over) {
        this.goShown = true; this.showBig(T('game.go'), 'go'); root.Sound.sfx('go');
        clearTimeout(this.goT); this.goT = setTimeout(() => { if (!this.over) this.overlay.textContent = ''; }, 800);
      }
      /* 幼幼班提示 */
      if (this.m.level === 'baby' && !this.over && t > 0) this.maybeHint(now);
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
      if (this.quest) {
        const b = m.boards[0], q = b.quest;
        this.timerEl.textContent = q.shots ? T('quest.shotsLeft', { n: Math.max(0, q.shots - b.shots) }) : T('quest.shotsUsed', { n: b.shots });
        this.timerEl.classList.toggle('low', !!q.shots && q.shots - b.shots <= 3 && !this.over);
      } else if (this.cfg.duration > 0) {
        const left = Math.max(0, this.cfg.duration - Math.max(0, t));
        this.timerEl.textContent = fmtTime(left);
        this.timerEl.classList.toggle('low', left < 15000 && !this.over);
      } else this.timerEl.textContent = T('game.relaxed');
      this.boardsEl.querySelectorAll('.bt-n').forEach(el => { const s = +el.getAttribute('data-n'); el.textContent = m.boards[s].cleared; });
      this.renderSummary();
      for (const v of this.views) if (v) v.dim = false;
    }

    /* ---------- 暫停／離開 ---------- */
    pauseMenu() {
      if (this.over || this.paused) return;
      this.paused = true; this.pausedAt = performance.now();
      const resume = () => {
        if (!this.paused) return;
        this.tStart += performance.now() - this.pausedAt;
        this.paused = false; this.last = performance.now();
      };
      const mo = modal({
        cls: 'dialog-sm dialog-pause', dismissible: true, onClose: resume,
        render: () => ({
          title: T('pause.title'),
          content: h('div', { class: 'pause-body' },
            h('div', { class: 'pause-art', html: Art.icon('pause', 34) }),
            h('div', { class: 'dialog-text' }, T('pause.text'))),
          actions: [
            btn(T('pause.resume'), { cls: 'btn-pink btn-lg pause-main', icon: 'play', onClick: () => mo.close() }),
            btn(T('pause.restart'), { cls: 'btn-sky', icon: 'refresh', onClick: () => { mo.close(true); resume(); this.o.onAgain(); } }),
            btn(this.quest ? T('quest.toLevels') : T('pause.settings'), { cls: 'btn-ghost', icon: 'back', onClick: () => { mo.close(true); resume(); this.o.onSetup(); } })
          ]
        })
      });
    }
    /* ---------- 結算 ---------- */
    onEnd() {
      if (this.over) return;
      this.over = true;
      if (root.GameAnalytics && this.quest) {
        root.GameAnalytics.end({ result: this.m.result && this.m.result.quest && this.m.result.quest.win ? 'win' : 'lose' });
      } else if (root.GameAnalytics) {
        const ranks = this.m.result ? this.m.result.ranks : M.ranking(this.m);
        const mine = ranks.find(row => row.s === this.slot);
        const tied = ranks.filter(row => row.rank === 1).length > 1;
        root.GameAnalytics.end({ result: mine && mine.rank === 1 ? (tied ? 'draw' : 'win') : 'lose' });
      }
      this.clearHint();
      setTimeout(() => this.showResult(), 1100);
    }
    showResult() {
      if (this.dead || this.resultShown) return;
      this.resultShown = true;
      if (this.quest) return this.showQuestResult();
      const r = this.m.result || { ranks: M.ranking(this.m), winner: 0, reason: 'time', mode: this.m.mode };
      const ranks = r.ranks;
      const me = ranks.find(x => x.s === this.slot);
      const win = me && me.rank === 1;
      const tie = ranks.filter(x => x.rank === 1).length > 1;
      this.resCtx = { r, ranks, me, win, tie };
      root.Sound.sfx(win ? 'win' : 'lose');
      root.App.recordResult(!!win);
      this.renderResult();
    }
    /* ---------- 闖關結算 ---------- */
    showQuestResult() {
      const q = (this.m.result && this.m.result.quest) || { win: false, stars: 0 };
      const rec = q.win ? root.Store.questRecord(this.store, this.quest.level, this.quest.no, q.stars) : { first: false, improved: false, stars: 0 };
      this.resCtx = { quest: true, q, rec, reason: this.m.result ? this.m.result.reason : '' };
      root.Sound.sfx(q.win ? 'win' : 'lose');
      this.renderQuestResult();
    }
    renderQuestResult() {
      const { q, rec, reason } = this.resCtx, QU = root.QuestUI, def = this.quest;
      const hadFocus = this.overlay.querySelector('.result-card button:focus');
      const fidx = hadFocus ? Array.from(this.overlay.querySelectorAll('.result-card button')).indexOf(hadFocus) : 0;
      this.overlay.textContent = '';
      const hasNext = q.win && def.no < root.Quests.count(def.level);
      const finished = q.win && def.no >= root.Quests.count(def.level);
      const dragon = this.cfg.players[0].dragon;
      const lines = [];
      let lead;
      if (!q.win) lead = T(reason === 'fail-bottom' ? 'quest.res.rBottom' : 'quest.res.rShots');
      else if (q.shotsMax) lead = T('quest.res.used', { n: q.shots }) + '・' + T('quest.res.left', { n: Math.max(0, q.shotsMax - q.shots) });
      else lead = T('quest.res.used', { n: q.shots });
      lines.push(h('div', { class: 'q-res-line' }, lead));
      if (def.mini) lines.push(h('div', { class: 'q-mini' + (q.mini && q.win ? ' ok' : '') },
        h('span', { class: 'q-mini-ico', html: root.Art.icon(q.mini && q.win ? 'check' : 'star', 18) }),
        h('div', { class: 'small' }, T(q.mini && q.win ? 'quest.res.miniOk' : 'quest.res.miniNo', { t: QU.miniText(def.mini) }))));
      const card = h('div', { class: 'dialog result-card quest-result', 'data-result-share': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('quest.res.win') },
        h('div', { class: 'big-result' },
          h('img', { class: 'result-dragon', alt: '', src: root.Art.svgUrl(root.Art.dragonSVG(dragon, q.win ? 'cheer' : 'sad')) }),
          h('div', { class: 'head' }, T(q.win ? 'quest.res.win' : 'quest.res.lose')),
          q.win ? h('div', { class: 'q-res-stars' }, QU.stars(q.stars, 44)) : null,
          q.win && rec.improved && !rec.first && q.stars > 0 ? h('div', { class: 'pill sun' }, T('quest.res.newBest')) : null,
          finished ? h('div', { class: 'pill pink' }, T('quest.res.allDone')) : null),
        h('div', { class: 'q-res-body' }, lines),
        h('div', { class: 'result-actions' },
          hasNext ? btn(T('quest.res.next'), { cls: 'btn-pink btn-lg', icon: 'play', onClick: () => this.o.onNext() }) : null,
          btn(q.win ? T('quest.res.again') : T('quest.res.retry'), { cls: q.win ? 'btn-sky' : 'btn-pink btn-lg', icon: 'refresh', onClick: () => this.o.onAgain() }),
          btn(T('quest.toLevels'), { cls: 'btn-ghost', icon: 'list', onClick: () => this.o.onSetup() }),
          btn(T('res.home'), { cls: 'btn-ghost', icon: 'home', onClick: () => this.o.onHome() })));
      this.overlay.appendChild(h('div', { class: 'result-mask' }, card));
      const btns = card.querySelectorAll('button'); const first = btns[Math.max(0, fidx)] || btns[0]; if (first) first.focus();
    }

    /** 結算畫面（語言切換時會重畫，不重複記錄戰績） */
    renderResult() {
      const { r, ranks, me, win, tie } = this.resCtx;
      const nameOf = x => pname(x);
      let head;
      if (tie && me.rank === 1) head = T('res.tie');
      else head = win ? T('res.youWin') : T('res.wins', { name: nameOf(ranks[0]) });
      const hadFocus = this.overlay.querySelector('.result-card button:focus');
      const fidx = hadFocus ? Array.from(this.overlay.querySelectorAll('.result-card button')).indexOf(hadFocus) : 0;
      this.overlay.textContent = '';
      const maxCl = Math.max(1, ...ranks.map(x => x.cleared));
      const rows = ranks.map(x => h('div', { class: 'rank-row' + (x.rank === 1 ? ' win' : '') + (x.s === this.slot ? ' me' : '') },
        h('span', { class: 'no' }, x.rank === 1 ? '🏆' : x.rank), avatar(x.dragon, 40),
        h('div', { class: 'rk-mid' },
          h('span', { class: 'nm' }, nameOf(x) + (x.s === this.slot ? T('game.you') : '') + (x.fullClear ? T('res.cleared') : '')),
          h('span', { class: 'rk-bar' }, h('i', { style: { width: Math.max(3, Math.round(x.cleared / maxCl * 100)) + '%' } })),
          h('span', { class: 'rk-meta' }, [T('res.shots', { n: x.shots }), T('res.combo', { n: x.maxCombo })].concat(this.cfg.mode === 'duel' ? [T('res.sendRecv', { a: x.garbageOut, b: x.garbageIn })] : []).map(t => h('i', null, t)))),
        h('b', null, T('res.count', { n: x.cleared }))));
      /* 我的（或冠軍的）戰績卡 */
      const who = (me || ranks[0]);
      const tile = (ico, big, label) => h('div', { class: 'stat-tile' }, h('div', { class: 'st-ico' }, ico), h('b', null, big), h('span', null, label));
      const tiles = [
        tile('🫧', who.cleared, T('res.tCleared')),
        tile('🔥', who.maxCombo, T('stat.combo')),
        tile('💥', who.best | 0, T('res.tBest')),
        tile('🍂', who.dropN | 0, T('res.tDrop'))
      ];
      if (this.cfg.mode === 'duel') tiles.push(tile('🎁', who.garbageOut + ' / ' + who.garbageIn, T('res.tSendRecv')));
      const stats = h('div', { class: 'stat-grid', 'aria-label': T('res.yourStats') }, tiles);
      const dragon = this.cfg.players[this.slot].dragon;
      const card = h('div', { class: 'dialog result-card', 'data-result-share': '', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('res.aria') },
        h('div', { class: 'big-result' },
          h('img', { class: 'result-dragon', alt: '', src: Art.svgUrl(Art.dragonSVG(dragon, win ? 'cheer' : 'sad')) }),
          h('div', { class: 'head' }, head),
          h('div', { class: 'muted small' }, r.reason === 'clear' ? T('res.rClear') : T('res.rTime'))),
        h('div', { class: 'stat-title' }, T('res.yourStats')),
        stats,
        h('div', { class: 'rank' }, rows),
        h('div', { class: 'result-actions' },
          btn(T('res.again'), { cls: 'btn-pink btn-lg', icon: 'refresh', onClick: () => this.o.onAgain() }),
          btn(T('pause.settings'), { cls: 'btn-sky', icon: 'back', onClick: () => this.o.onSetup() }),
          btn(T('res.home'), { cls: 'btn-ghost', icon: 'home', onClick: () => this.o.onHome() })));
      const wrap = h('div', { class: 'result-mask' }, card);
      this.overlay.appendChild(wrap);
      const btns = card.querySelectorAll('button'); const first = btns[Math.max(0, fidx)] || btns[0]; if (first) first.focus();
    }

    /** 語言切換：只重畫文字，不動對局狀態 */
    relocalize() {
      if (this.dead) return;
      this.side.setAttribute('aria-label', T('game.info'));
      this.sideTitle.textContent = T('game.info');
      const lab = (el, k) => { el.setAttribute('aria-label', T(k)); el.setAttribute('title', T(k)); };
      lab(this.sideClose, 'game.hideSide');
      lab(this.exitBtn, 'game.pause');
      this.syncSideIcon();
      this.modeEl.textContent = this.modeLabel();
      this.cfg.players.forEach((p, s) => { const el = this.boardsEl.querySelector('.bt-name[data-s="' + s + '"]'); if (el) el.textContent = pname(p) + (p.kind === 'ai' ? ' 🤖' : ''); });
      this.updateHud(this.mt());
      if (this.quest) { this.sumEl && this.renderSummary(); const hk = this.hintBubble && this.hintBubble.querySelector('.q-hint-txt'); if (hk) hk.textContent = T('quest.hint.' + hk.getAttribute('data-k')); }
      if (this.resultShown && this.resCtx) (this.resCtx.quest ? this.renderQuestResult() : this.renderResult());
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.goT); clearTimeout(this.hintT);
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
