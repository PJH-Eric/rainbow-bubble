/* ===== render.js — 一個盤面的畫面（canvas）：泡泡、飛行、爆開、掉落、泡泡雨、預告雲、瞄準線、砲與龍 =====
 *
 * 規則（rules.js）算出來的結果瞬間就改完盤面；畫面要「慢慢演」。做法：
 *   shown   畫面上目前顯示的盤面（落後於真正的盤面）
 *   jobs    每個事件一個工作（含事後盤面的複本 after），依序演：飛行 → 換成 after → 產生爆開／掉落等特效
 * 特效（fx）彼此獨立、各自計時，所以下一發可以在上一發的爆開還在播的時候就飛出去。
 * 畫面從不直接讀「正在被規則改動」的盤面（砲上的泡泡與瞄準線除外，那些本來就要即時）。
 */
(function (root) {
  'use strict';
  const R = root.Rules, Art = root.Art;
  const SQ3 = R.SQ3;
  const TOP = 1.7;                         /* 天花板上方留給預告雲的空間（世界單位） */
  const FONT = '"Baloo 2","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const ease = t => (t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3));
  const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

  const PAD = 0.85;                 /* 盤面內側留白（世界單位）：泡泡和外框之間不擠 */
  function worldSize(cols) {
    const sy = R.cy(R.LINE_ROW + 1.5);
    return { w: 2 * cols, h: TOP + sy + 2.9, shooterY: TOP + sy, pad: PAD };
  }

  class BoardView {
    constructor(o) {
      this.slot = o.slot; this.mine = !!o.mine; this.name = o.name || ''; this.dragon = o.dragon || 'rainbow';
      this.theme = o.theme || Art.THEMES[0]; Art.preloadSet && Art.preloadSet(this.theme.set); this.getT = o.getT || (() => 0); this.set = o.settings || (() => ({}));
      this.small = !!o.small; this.audio = !!o.audio;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'board-canvas';
      this.ctx = this.canvas.getContext('2d');
      this.el = document.createElement('div');
      this.el.className = 'board-wrap';
      this.el.appendChild(this.canvas);
      this.shown = null; this.live = null;
      this.jobs = []; this.fx = []; this.job = null;
      this.shift = null;                     /* { t0, dur, k } 天花板下降／泡泡落下時，盤面往下滑的動畫 */
      this.pose = 'idle'; this.poseUntil = 0;
      this.aim = 9000; this.showAim = this.mine; this.aimTrace = null; this.aimKey = '';
      this.hint = null; this.reload = 0; this.swapBump = 0;
      this.scale = 10; this.ox = 0; this.oy = 0; this.cols = 8;
      this.shake = 0; this.winner = false; this.dim = false; this.rainBand = null;
      this.dpr = 1;
    }

    /* ---------- 設定盤面 ---------- */
    setup(m) {
      this.m = m;
      const b = m.boards[this.slot];
      this.live = b;
      this.cols = b.cols;
      this.shown = R.cloneBoard(b);
      this.jobs.length = 0; this.job = null; this.fx.length = 0; this.shift = null; this.rainBand = null;
      this.resize(true);
    }

    resize(force) {
      const p = this.el.parentNode;
      const cw = this.el.clientWidth || (p && p.clientWidth) || 300, ch = this.el.clientHeight || (p && p.clientHeight) || 400;
      const dpr = Math.min(2.5, root.devicePixelRatio || 1);
      const ws = worldSize(this.cols);
      const fw = ws.w + 2 * ws.pad, fh = ws.h + 2 * ws.pad;
      const sc = Math.min(cw / fw, ch / fh);
      const pw = Math.max(40, Math.floor(fw * sc)), ph = Math.max(40, Math.floor(fh * sc));
      if (!force && this._w === pw && this._h === ph && this.dpr === dpr) return;
      this._w = pw; this._h = ph; this.dpr = dpr;
      this.canvas.style.width = pw + 'px'; this.canvas.style.height = ph + 'px';
      this.canvas.width = Math.round(pw * dpr); this.canvas.height = Math.round(ph * dpr);
      this.scale = (pw * dpr) / fw; this.ws = ws;
      this.el.style.setProperty('--ar', fw + ' / ' + fh);
      if (p) p.style.setProperty('--ar', fw + ' / ' + fh);
    }

    /* ---------- 事件進場（controller 在 Match.apply 之後呼叫） ---------- */
    push(ev, res) {
      if (!this.shown) return;
      const snd = this.audio ? root.Sound : null;
      if (ev.e === 'shot' && ev.s === this.slot && res) {
        this.jobs.push({ kind: 'shot', ev, res, after: R.cloneBoard(this.live), t: ev.t });
        this.pose = 'shoot'; this.poseUntil = performance.now() + 260;
        this.reload = performance.now();
        if (snd) snd.sfx('shoot');
      } else if (ev.e === 'land' && ev.s === this.slot && res) {
        this.jobs.push({ kind: 'land', ev, res, after: R.cloneBoard(this.live) });
      } else if (ev.e === 'swap' && ev.s === this.slot) {
        this.swapBump = performance.now();
        if (snd) snd.sfx('swap');
      } else if (ev.e === 'pend' && ev.to === this.slot) {
        if (snd) snd.sfx('warn');
      }
    }

    popup(text, x, y, color, big) {
      this.fx.push({ k: 'text', t0: performance.now(), dur: 1100, x, y, text, color: color || '#ff7a9c', big: !!big });
    }

    /* ---------- 工作處理 ---------- */
    runJobs(now) {
      /* 積太多就快轉：舊的直接完成（不演動畫） */
      while (this.jobs.length > 5) { const j = this.jobs.shift(); this.finish(j, now, true); }
      if (this.job) {
        const j = this.job;
        if (j.kind === 'shot') {
          const t = (now - j.t0) / j.dur;
          if (t >= 1) { this.job = null; this.finish(j, now, false); }
        } else this.job = null;
      }
      if (!this.job && this.jobs.length) {
        if (this.shift && now < this.shift.t0 + this.shift.dur * 0.55 && this.jobs[0].kind === 'shot') return;   /* 盤面正在下滑，先別飛 */
        const j = this.jobs.shift();
        if (j.kind === 'shot') {
          const reduce = this.set().reduceMotion;
          const pts = j.res.path;
          let len = 0; const cum = [0];
          for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(len); }
          j.len = len; j.cum = cum; j.t0 = now; j.dur = reduce ? 70 : Math.max(150, Math.min(420, len / 62 * 1000));
          j.bounced = 0;
          this.job = j;
        } else {
          this.finish(j, now, false);
        }
      }
    }

    finish(j, now, quick) {
      const prev = this.shown;
      this.shown = j.after;
      const reduce = this.set().reduceMotion;
      const snd = this.audio ? root.Sound : null;
      const res = j.res;
      let k = 0;
      if (j.kind === 'land') k = res.rows ? res.rows.length : 0;
      else if (res.descended) k = 1;
      if (!quick && k > 0) this.shift = { t0: now, dur: reduce ? 60 : 360, k };
      if (quick) { this.shift = null; return; }
      const pre = (x, y) => ({ x, y });
      const bx = r => 0;   /* 佔位：下面直接用 cx */
      void bx; void pre;
      if (j.kind === 'shot') {
        const lx = R.cx(prev, res.land.r, res.land.c), ly = TOP + R.cy(res.land.r);
        if (snd) snd.sfx('land');
        if (res.laser) this.fx.push({ k: 'beam', t0: now, dur: reduce ? 200 : 520, x: lx, y: ly, h: res.laser.h });
        /* 爆開 */
        const lst = res.popped || [];
        let idx = 0, sx = 0, sy = 0, sn = 0, big = false;
        for (const p of lst) {
          if (p.how === 'fizzle') { this.fx.push({ k: 'spark', t0: now, dur: 500, x: lx, y: ly }); continue; }
          const x = R.cx(prev, p.r, p.c), y = TOP + R.cy(p.r);
          const delay = reduce ? 0 : idx * 28;
          this.fx.push({ k: 'pop', t0: now + delay, dur: reduce ? 150 : 420, x, y, v: p.v, how: p.how, pre: k, idx });
          if (p.how === 'star') big = true;
          sx += x; sy += y; sn++; idx++;
          if (snd) setTimeout(() => snd.sfx(p.how === 'star' || p.how === 'laser' ? 'star' : 'pop', idx), delay);
        }
        const dr = res.dropped || [];
        dr.forEach((p, i) => {
          const x = R.cx(prev, p.r, p.c), y = TOP + R.cy(p.r);
          this.fx.push({ k: 'fall', t0: now + (reduce ? 0 : 120 + i * 18), dur: reduce ? 200 : 900, x, y, v: p.v, vx: (Math.random() - 0.5) * 3, pre: k });
          sx += x; sy += y; sn++;
        });
        if (dr.length && snd) setTimeout(() => snd.sfx('drop'), 150);
        if (sn && res.gained >= 3) {
          const cx0 = sx / sn, cy0 = sy / sn;
          this.popup('+' + res.gained, cx0, cy0 - 0.5, '#ff6f9c', res.gained >= 7);
          if (res.combo >= 2) this.popup('連擊 ×' + res.combo, cx0, cy0 + 1.4, '#ffa21f', false);
          if (res.gained >= 7 || big) { this.shake = now; this.pose = 'cheer'; this.poseUntil = now + 900; if (snd) snd.sfx('combo'); }
        }
        if (res.fullClear) { this.pose = 'cheer'; this.poseUntil = now + 3000; this.popup('全部清光！', this.ws.w / 2, this.ws.h * 0.4, '#ff6f9c', true); }
      } else if (j.kind === 'land') {
        if (snd) snd.sfx('splash');
        this.shake = now;
      }
      if (res.rain) this.startRain(res.rain, prev, now, k, reduce);
    }

    startRain(rain, board, now, k, reduce) {
      const snd = this.audio ? root.Sound : null;
      if (snd) setTimeout(() => snd.sfx('rain'), 250);
      this.pose = 'sad'; this.poseUntil = now + 1400;
      this.rainBand = { t0: now + 250, dur: reduce ? 300 : 1100, from: rain.from, to: rain.to };
      const all = rain.cells.concat(rain.drops || []);
      all.forEach((p, i) => {
        const x = R.cx(this.shown, p.r, p.c), y = TOP + R.cy(p.r);
        this.fx.push({ k: 'wash', t0: now + 250 + i * 14, dur: reduce ? 300 : 1100, x, y, v: p.v, post: true });
      });
      this.popup('泡泡雨來幫忙！', this.ws.w / 2, TOP + R.cy(R.LINE_ROW - 3), '#3d9bff', true);
    }

    /* ---------- 輸入座標 ---------- */
    toWorld(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const fw = this.ws.w + 2 * this.ws.pad, fh = this.ws.h + 2 * this.ws.pad;
      return { x: (clientX - r.left) / r.width * fw - this.ws.pad, y: (clientY - r.top) / r.height * fh - this.ws.pad };
    }
    /** 回傳點擊資訊：{ angle(百分之一度), swap, inside } */
    hit(clientX, clientY) {
      const w = this.toWorld(clientX, clientY);
      const s = R.shooterPos(this.live);
      const sy = TOP + s.y;
      const sp = this.swapPos(s, sy);
      if (w.x >= sp.x - 0.2 && w.x <= sp.x + sp.w + 0.2 && w.y >= sp.y - 0.3 && w.y <= sp.y + sp.h + 0.3) return { swap: true, inside: true };
      if (Math.hypot(w.x - sp.nx, w.y - sp.ny) < 1.6) return { swap: true, inside: true };
      let dx = w.x - s.x, dy = sy - w.y;
      if (dy < 0.4) dy = 0.4;
      const a = Math.atan2(dy, dx) * 18000 / Math.PI;
      return { angle: R.clampAngle(a), swap: false, inside: true };
    }
    /** 「交換泡泡」按鈕：夾在發射台與下一顆泡泡中間的小長方形、只用圖示 */
    swapPos(s, sy) { return { x: s.x + 2.85, y: sy - 0.3, w: 1.6, h: 1.6, nx: s.x + 6.95, ny: sy + 0.5 }; }
    setAim(a) { this.aim = R.clampAngle(a); }

    /* ---------- 畫面 ---------- */
    frame(now) {
      if (!this.shown) return;
      this.runJobs(now);
      if (this.pose !== 'idle' && now > this.poseUntil) this.pose = 'idle';
      const g = this.ctx, sc = this.scale, ws = this.ws;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.setTransform(sc, 0, 0, sc, ws.pad * sc, ws.pad * sc);
      const th = this.theme;
      /* 震動 */
      let shx = 0, shy = 0;
      if (this.shake && now - this.shake < 260 && !this.set().reduceMotion) { const a = 1 - (now - this.shake) / 260; shx = Math.sin(now * 0.09) * 0.22 * a; shy = Math.cos(now * 0.11) * 0.16 * a; }
      g.translate(shx, shy);
      this.drawPanel(g, now);
      /* 盤面（含下滑） */
      let boardOff = 0, preOff = 0;
      if (this.shift) {
        const t = (now - this.shift.t0) / this.shift.dur;
        if (t >= 1) this.shift = null;
        else { const e = ease(t); boardOff = -SQ3 * this.shift.k * (1 - e); preOff = SQ3 * this.shift.k * e; }
      }
      g.save();
      g.beginPath(); g.rect(0, 0.1, ws.w, ws.h); g.clip();
      this.drawBubbles(g, now, boardOff);
      this.drawFx(g, now, boardOff, preOff);
      g.restore();
      this.drawPending(g, now);
      this.drawShooter(g, now);
      this.drawFlight(g, now);
      this.drawTexts(g, now);
      if (this.dim) { g.fillStyle = 'rgba(40,30,70,.25)'; g.fillRect(-ws.pad - 1, -ws.pad - 1, ws.w + 2 * ws.pad + 2, ws.h + 2 * ws.pad + 2); }
    }

    drawPanel(g, now) {
      const ws = this.ws, th = this.theme, b = this.live;
      g.save();
      const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
      const P = ws.pad;
      rr(0.05 - P, 0.05 - P, ws.w + 2 * P - 0.1, ws.h + 2 * P - 0.1, 1.1);
      g.fillStyle = th.boardFill; g.fill();
      g.lineWidth = 0.22; g.strokeStyle = th.boardLine; g.stroke();
      /* 天花板 */
      const gr = g.createLinearGradient(0, -P, 0, TOP);
      gr.addColorStop(0, th.frame[1]); gr.addColorStop(1, th.frame[0]);
      g.save(); rr(0.05 - P, 0.05 - P, ws.w + 2 * P - 0.1, ws.h + 2 * P - 0.1, 1.1); g.clip();
      g.fillStyle = gr; g.fillRect(-P, -P, ws.w + 2 * P, TOP + P - 0.55);
      g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(-P, 0.1 - P, ws.w + 2 * P, 0.18);
      /* 底線 */
      const ly = TOP + R.cy(R.LINE_ROW) - 1;
      const low = R.lowestRow(b);
      const danger = low >= R.LINE_ROW - 2;
      g.setLineDash([0.5, 0.4]); g.lineWidth = 0.14;
      g.strokeStyle = danger ? 'rgba(255,70,90,' + (0.55 + 0.4 * Math.sin(now / 150)) + ')' : 'rgba(255,255,255,.85)';
      g.beginPath(); g.moveTo(0.4 - P * 0.5, ly); g.lineTo(ws.w - 0.4 + P * 0.5, ly); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(80,60,130,.08)'; g.fillRect(-P, ly + 0.1, ws.w + 2 * P, ws.h + P);
      g.restore();
      g.restore();
    }

    drawBubbles(g, now, off) {
      const b = this.shown, hintSet = this.hint && !this.job ? this.hint.cells : null;
      const blink = 0.5 + 0.5 * Math.sin(now / 170);
      for (let r = 0; r < b.rows.length; r++) {
        const row = b.rows[r];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          if (!v) continue;
          const x = R.cx(b, r, c), y = TOP + R.cy(r) + off;
          if (y < -2) continue;
          this.bubble(g, v, x, y, 1);
          if (hintSet && hintSet.has(r * 64 + c)) {
            g.save(); g.globalAlpha = 0.35 + 0.5 * blink; g.lineWidth = 0.22; g.strokeStyle = '#fff59a'; g.shadowColor = '#ffd23a'; g.shadowBlur = 12;
            g.beginPath(); g.arc(x, y, 1.12 + 0.1 * blink, 0, 7); g.stroke(); g.restore();
          }
        }
      }
    }

    bubble(g, v, x, y, s, alpha) {
      const img = Art.sprite(Art.spriteKeyOf(v, this.theme.set));
      const d = 2.12 * s;
      if (alpha != null) g.globalAlpha = alpha;
      if (img) g.drawImage(img, x - d / 2, y - d / 2, d, d);
      else { g.fillStyle = '#ddd'; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); }
      if (alpha != null) g.globalAlpha = 1;
    }
    item(g, it, x, y, s, alpha) {
      let key = it.k === 'n' ? 'b:' + it.c + ':0' + (this.theme.set && this.theme.set !== 'default' ? ':' + this.theme.set : '') : 's:' + it.k;
      const img = Art.sprite(key);
      const d = 2.12 * s;
      if (alpha != null) g.globalAlpha = alpha;
      if (img) g.drawImage(img, x - d / 2, y - d / 2, d, d);
      if (alpha != null) g.globalAlpha = 1;
    }

    drawFx(g, now, boardOff, preOff) {
      const list = this.fx;
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        const t = (now - f.t0) / f.dur;
        if (t >= 1) { list.splice(i, 1); continue; }
        if (t < 0) {
          /* 還沒開始：爆開的泡泡要先留在原地 */
          if (f.k === 'pop' || f.k === 'fall') { this.bubble(g, f.v, f.x, f.y + (f.pre ? preOff : 0), 1); }
          continue;
        }
        const yoff = f.post ? boardOff : (f.pre ? preOff : 0);
        if (f.k === 'pop') {
          const e = ease(t);
          const y = f.y + yoff;
          const s = 1 + 0.35 * Math.sin(Math.min(1, t * 2.2) * Math.PI / 1.4);
          if (t < 0.45) this.bubble(g, f.v, f.x, y, s, 1 - t * 1.6);
          g.save();
          g.globalAlpha = (1 - e) * 0.9; g.lineWidth = 0.16 * (1 - e) + 0.03; g.strokeStyle = '#fff';
          g.beginPath(); g.arc(f.x, y, 1 + e * 1.3, 0, 7); g.stroke();
          const col = Art.COLORS[f.v & 15] ? Art.COLORS[f.v & 15].main : '#fff';
          if (!this.set().reduceMotion) for (let k = 0; k < 6; k++) {
            const a = k * 1.047 + f.idx;
            const rr = 0.6 + e * 1.9;
            g.fillStyle = k % 2 ? '#fff' : col; g.globalAlpha = (1 - e);
            g.beginPath(); g.arc(f.x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.22 * (1 - e) + 0.05, 0, 7); g.fill();
          }
          if (f.how === 'star') { g.globalAlpha = 1 - e; g.fillStyle = '#ffe14a'; this.star(g, f.x, y, 0.8 + e * 2.2); }
          g.restore();
        } else if (f.k === 'fall') {
          const tt = t * f.dur / 1000;
          const y = f.y + yoff + 14 * tt * tt;
          const x = f.x + f.vx * tt;
          this.bubble(g, f.v, x, y, 1, 1 - clamp01((t - 0.65) / 0.35));
        } else if (f.k === 'wash') {
          const tt = t * f.dur / 1000;
          const y = f.y + yoff + 11 * tt * tt;
          const x = f.x + Math.sin(tt * 9 + f.x) * 0.35;
          this.bubble(g, f.v, x, y, 1 - t * 0.2, 1 - clamp01((t - 0.5) / 0.5));
        } else if (f.k === 'beam') {
          /* 雷射光束：橫向貫穿整個盤面寬、縱向貫穿整個盤面高，很快淡出 */
          const w = (1 - t) * 1.1 + 0.15, ws = this.ws;
          g.save(); g.globalAlpha = Math.min(1, (1 - t) * 1.6); g.lineCap = 'round';
          const x0 = f.h ? 0 : f.x, x1 = f.h ? ws.w : f.x, y0 = f.h ? f.y : 0, y1 = f.h ? f.y : ws.h;
          g.strokeStyle = '#7fd1ff'; g.lineWidth = w * 2.2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          g.strokeStyle = '#fff'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          g.restore();
        } else if (f.k === 'spark') {
          g.save(); g.globalAlpha = 1 - t; g.fillStyle = '#fff'; this.star(g, f.x, f.y, 0.5 + t * 1.5); g.restore();
        }
      }
      /* 泡泡雨的水帶 */
      if (this.rainBand) {
        const rb = this.rainBand, t = (now - rb.t0) / rb.dur;
        if (t >= 1) this.rainBand = null;
        else if (t >= 0) {
          const y0 = TOP + R.cy(rb.from) - 1 + boardOff, y1 = TOP + R.cy(rb.to) + 1.2 + boardOff;
          g.save(); g.globalAlpha = 0.5 * Math.sin(Math.min(1, t) * Math.PI);
          const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(120,200,255,0)'); gr.addColorStop(1, 'rgba(70,160,255,.75)');
          g.fillStyle = gr; g.fillRect(0, y0, this.ws.w, y1 - y0);
          g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 0.1;
          for (let i = 0; i < 14; i++) { const x = (i * 1.37 + t * 6) % this.ws.w; const y = y0 + ((i * 0.77 + t * 9) % (y1 - y0)); g.beginPath(); g.moveTo(x, y); g.lineTo(x - 0.15, y + 0.7); g.stroke(); }
          g.restore();
        }
      }
    }

    star(g, x, y, r) {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }

    drawPending(g, now) {
      const list = this.m ? this.m.pending[this.slot] : null;
      if (!list || !list.length) return;
      const T = this.getT();
      const ws = this.ws;
      let x = 2.0;
      for (const p of list) {
        const total = this.live.cfg.warnMs;
        const left = Math.max(0, p.at - T);
        const frac = clamp01(left / total);
        const urgent = frac < 0.4;
        const shake = urgent && !this.set().reduceMotion ? Math.sin(now / 45) * 0.1 : 0;
        const bob = Math.sin(now / 220 + x) * 0.1;
        const cx0 = x + shake, cy0 = 1.05 + bob;
        g.save();
        /* 雨雲 */
        g.fillStyle = urgent ? '#ff8aa0' : '#8da2e6'; g.strokeStyle = '#fff'; g.lineWidth = 0.16; g.lineJoin = 'round';
        g.beginPath();
        g.arc(cx0 - 0.75, cy0 + 0.1, 0.62, Math.PI * 0.5, Math.PI * 1.5);
        g.arc(cx0 - 0.25, cy0 - 0.3, 0.7, Math.PI, Math.PI * 2);
        g.arc(cx0 + 0.5, cy0 - 0.15, 0.6, Math.PI * 1.2, Math.PI * 2.1);
        g.arc(cx0 + 0.8, cy0 + 0.2, 0.5, Math.PI * 1.5, Math.PI * 2.5);
        g.closePath(); g.fill(); g.stroke();
        /* 數字 */
        g.font = '900 0.95px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 0.22; g.strokeStyle = urgent ? '#c23a56' : '#4a5fb0'; g.fillStyle = '#fff';
        g.strokeText(p.n, cx0, cy0 + 0.05); g.fillText(p.n, cx0, cy0 + 0.05);
        /* 倒數條 */
        g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(cx0 - 0.9, cy0 + 0.78, 1.8, 0.16);
        g.fillStyle = urgent ? '#ff4d6d' : '#fff'; g.fillRect(cx0 - 0.9, cy0 + 0.78, 1.8 * frac, 0.16);
        /* 雨滴 */
        g.fillStyle = '#7cc4ff';
        for (let k = 0; k < 3; k++) { const ph = ((now / 500) + k * 0.37) % 1; g.globalAlpha = 1 - ph; g.beginPath(); g.arc(cx0 - 0.5 + k * 0.5, cy0 + 0.85 + ph * 0.5, 0.08, 0, 7); g.fill(); }
        g.restore();
        x += 2.5;
        if (x > ws.w - 1.2) break;
      }
    }

    drawShooter(g, now) {
      const b = this.live, s = R.shooterPos(b), sy = TOP + s.y, ws = this.ws;
      /* 龍（左下） */
      const dpose = this.pose;
      const dimg = Art.sprite('dragon:' + this.dragon + ':' + dpose);
      const ds = Math.min(5.4, ws.w * 0.34);
      const bounce = this.pose === 'cheer' ? Math.abs(Math.sin(now / 120)) * 0.5 : 0;
      if (dimg) g.drawImage(dimg, 0.2, sy - ds * 0.52 - bounce, ds, ds);
      /* 砲 */
      const img = Art.sprite('cannon');
      const k = 3.4 / 100;
      const th = (90 - this.aim / 100) * Math.PI / 180;
      g.save(); g.translate(s.x, sy); g.rotate(th);
      if (img) g.drawImage(img, -50 * k, -110 * k, 100 * k, 160 * k);
      g.restore();
      /* 手上的泡泡 */
      const rel = clamp01((performance.now() - this.reload) / 160);
      if (!b.fullClear) {
        const sc2 = 0.4 + 0.6 * ease(rel);
        g.save(); g.translate(s.x, sy);
        this.item(g, b.cur, 0, 0, 0.92 * sc2);
        g.restore();
        /* 下一顆 */
        const bump = clamp01((performance.now() - this.swapBump) / 220);
        const sp = this.swapPos(s, sy), nx = sp.nx, ny = sp.ny;
        g.save();
        /* 下一顆：發射台右邊 */
        g.fillStyle = 'rgba(255,255,255,.7)'; g.strokeStyle = this.theme.boardLine; g.lineWidth = 0.12;
        g.beginPath(); g.arc(nx, ny, 1.45, 0, 7); g.fill(); g.stroke();
        this.item(g, b.nxt, nx, ny, 0.72 + 0.2 * Math.sin(bump * Math.PI));
        /* 交換按鈕：發射台與下一顆之間，小長方形＋圖示（⇄） */
        if (this.mine) {
          const down = clamp01((performance.now() - this.swapBump) / 220);
          g.fillStyle = 'rgba(255,255,255,.94)'; g.strokeStyle = '#f0b24a'; g.lineWidth = 0.2;
          g.beginPath(); g.roundRect ? g.roundRect(sp.x, sp.y, sp.w, sp.h, 0.5) : g.rect(sp.x, sp.y, sp.w, sp.h); g.fill(); g.stroke();
          const cx0 = sp.x + sp.w / 2, cy0 = sp.y + sp.h / 2, hw = 0.46, ah = 0.22;
          g.strokeStyle = down < 1 ? '#ff7eb6' : '#6a46b8'; g.lineWidth = 0.2; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(cx0 - hw, cy0 - 0.3); g.lineTo(cx0 + hw, cy0 - 0.3); g.moveTo(cx0 + hw - ah, cy0 - 0.3 - ah); g.lineTo(cx0 + hw, cy0 - 0.3); g.lineTo(cx0 + hw - ah, cy0 - 0.3 + ah); g.stroke();
          g.beginPath(); g.moveTo(cx0 + hw, cy0 + 0.3); g.lineTo(cx0 - hw, cy0 + 0.3); g.moveTo(cx0 - hw + ah, cy0 + 0.3 - ah); g.lineTo(cx0 - hw, cy0 + 0.3); g.lineTo(cx0 - hw + ah, cy0 + 0.3 + ah); g.stroke();
        }
        g.restore();
        if (b.protect > 0) {
          g.save(); g.font = '800 0.75px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#3d9bff'; g.fillText('保護中 ' + b.protect, s.x, sy - 2.4); g.restore();
        }
      }
      /* 瞄準線 */
      if (this.showAim && this.set().aimLine !== false && !b.fullClear && !this.m.over) {
        const key = this.aim + ':' + b.shots + ':' + b.parity + ':' + b.cleared + ':' + b.garbageIn + ':' + b.cur.k + b.cur.c;
        if (key !== this.aimKey) { this.aimKey = key; this.aimTrace = R.trace(b, this.aim); }
        const pts = this.aimTrace.path;
        g.save(); g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = 'rgba(90,70,160,.55)'; g.lineWidth = 0.05;
        let acc = 0, ph = (now / 900) % 1;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], bb = pts[i];
          const L = Math.hypot(bb.x - a.x, bb.y - a.y);
          for (let d = (1 - ph) * 1.1 - acc % 1.1 + 0.0; d < L; d += 1.1) {
            if (d < 1.4 && i === 1) continue;
            const t = d / L, x = a.x + (bb.x - a.x) * t, y = TOP + a.y + (bb.y - a.y) * t;
            g.beginPath(); g.arc(x, y, 0.2, 0, 7); g.fill(); g.stroke();
          }
          acc += L;
        }
        const last = pts[pts.length - 1];
        g.globalAlpha = 0.45; this.item(g, b.cur, last.x, TOP + last.y, 0.95); g.globalAlpha = 1;
        g.restore();
      }
      /* 幼幼班提示：小手指 */
      if (this.hint && this.hint.point && !this.job) {
        const hp = this.hint.point;
        g.save(); g.font = '1.7px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('👆', hp.x, TOP + hp.y + 1.3 + Math.sin(now / 200) * 0.3);
        g.restore();
      }
    }

    drawFlight(g, now) {
      const j = this.job;
      if (!j || j.kind !== 'shot') return;
      const t = clamp01((now - j.t0) / j.dur);
      const d = j.len * ease(t * 0.6 + t * 0.4 * t) ;   /* 近乎等速，起步稍快 */
      const dist = j.len * t;
      void d;
      const pts = j.res.path, cum = j.cum;
      let i = 1; while (i < pts.length - 1 && cum[i] < dist) i++;
      const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1;
      const u = clamp01((dist - cum[i - 1]) / seg);
      const x = a.x + (b.x - a.x) * u, y = TOP + a.y + (b.y - a.y) * u;
      /* 碰牆聲 */
      const bounces = Math.max(0, i - 1);
      if (bounces > j.bounced) { j.bounced = bounces; if (root.Sound && this.audio) root.Sound.sfx('bounce'); }
      /* 拖尾 */
      g.save();
      for (let k = 1; k <= 3; k++) {
        const bd = dist - k * 1.3; if (bd < 0) break;
        let ii = 1; while (ii < pts.length - 1 && cum[ii] < bd) ii++;
        const aa = pts[ii - 1], bb2 = pts[ii], sg = cum[ii] - cum[ii - 1] || 1, uu = clamp01((bd - cum[ii - 1]) / sg);
        g.globalAlpha = 0.28 - k * 0.07;
        this.item(g, j.res.item, aa.x + (bb2.x - aa.x) * uu, TOP + aa.y + (bb2.y - aa.y) * uu, 1 - k * 0.12);
      }
      g.restore();
      this.item(g, j.res.item, x, y, 1);
    }

    drawTexts(g, now) {
      const list = this.fx;
      for (const f of list) {
        if (f.k !== 'text') continue;
        const t = (now - f.t0) / f.dur;
        if (t < 0 || t >= 1) continue;
        g.save();
        const y = f.y - t * 2.2, a = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        const sz = (f.big ? 1.5 : 1.05) * (0.7 + 0.3 * ease(t * 4));
        g.globalAlpha = a; g.font = '900 ' + sz + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineJoin = 'round'; g.lineWidth = 0.3; g.strokeStyle = 'rgba(255,255,255,.95)';
        const x = Math.max(2.5, Math.min(this.ws.w - 2.5, f.x));
        g.strokeText(f.text, x, y); g.fillStyle = f.color; g.fillText(f.text, x, y);
        g.restore();
      }
      void now;
    }
  }

  /** 找一個「可以消掉」的發射角度（給幼幼班閃爍提示用）。回傳 { cells:Set(r*64+c), point:{x,y}, angle } 或 null */
  function findHint(b) {
    let best = null;
    for (let a = 1500; a <= 16500; a += 150) {
      const res = R.preview(b, a, false);
      if (res.gained >= 3 && (!best || res.gained > best.gained)) best = { gained: res.gained, a, res };
    }
    if (!best) return null;
    const cells = new Set();
    best.res.popped.forEach(p => { if (p.how !== 'fizzle') cells.add(p.r * 64 + p.c); });
    const last = best.res.path[best.res.path.length - 1];
    return { cells, point: { x: last.x, y: last.y }, angle: best.a };
  }

  root.BoardView = BoardView;
  root.BoardMath = { TOP, worldSize, findHint };
})(typeof self !== 'undefined' ? self : this);
