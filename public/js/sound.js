/* ===== sound.js — 音效與背景音樂（全部用 WebAudio 即時合成，沒有外部音檔、沒有授權問題） =====
 * Sound.config = { bgm, bgmVol, sfx, sfxVol }（由 app.js 與設定同步）
 * Sound.unlock()    第一次使用者手勢時呼叫（瀏覽器規定）
 * Sound.sfx(name)   click shoot bounce land pop drop swap warn splash rain combo star win lose count go error
 * Sound.bgm(themeKey|null)  播放／停止背景音樂（a～g 對應七個主題的調性）
 */
(function (root) {
  'use strict';
  let ctx = null, master = null, bgmGain = null, sfxGain = null;
  const S = { config: { bgm: true, bgmVol: 0.5, sfx: true, sfxVol: 0.8 }, ready: false };
  let bgmKey = null, bgmTimer = 0, bgmStep = 0, bgmNext = 0, wantBgm = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      bgmGain = ctx.createGain(); bgmGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.connect(master);
      S.apply();
    } catch (e) { ctx = null; }
    return ctx;
  }
  S.unlock = function () {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    S.ready = true;
    if (wantBgm) S.bgm(wantBgm);
  };
  S.apply = function () {
    if (!ctx) return;
    bgmGain.gain.value = S.config.bgm ? 0.22 * S.config.bgmVol : 0;
    sfxGain.gain.value = S.config.sfx ? S.config.sfxVol : 0;
  };

  function tone(freq, t0, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.slide), t0 + dur);
    const v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(o.dest || sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, hp) {
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t0);
  }
  const PENTA = [0, 2, 4, 7, 9];
  const note = (base, i) => base * Math.pow(2, (PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);

  S.sfx = function (name, arg) {
    if (!S.config.sfx) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    switch (name) {
      case 'click': tone(660, t, 0.07, { type: 'triangle', vol: 0.22 }); break;
      case 'shoot': tone(300, t, 0.16, { type: 'sine', slide: 900, vol: 0.28 }); noise(t, 0.05, 0.08, 2500); break;
      case 'bounce': tone(520, t, 0.06, { type: 'triangle', vol: 0.18 }); break;
      case 'land': tone(240, t, 0.09, { type: 'sine', slide: 150, vol: 0.3 }); break;
      case 'swap': tone(520, t, 0.05, { type: 'triangle', vol: 0.2 }); tone(700, t + 0.05, 0.06, { type: 'triangle', vol: 0.2 }); break;
      case 'pop': {   /* arg = 連鎖第幾顆：音階往上爬 */
        const i = Math.min(14, arg || 0);
        tone(note(520, i), t, 0.13, { type: 'sine', vol: 0.3 }); tone(note(520, i) * 2, t, 0.06, { type: 'sine', vol: 0.12 });
        break;
      }
      case 'drop': tone(700, t, 0.22, { type: 'sine', slide: 220, vol: 0.2 }); break;
      case 'star': noise(t, 0.25, 0.25, 600); tone(150, t, 0.25, { type: 'sawtooth', slide: 60, vol: 0.18 }); tone(1200, t + 0.02, 0.2, { type: 'triangle', vol: 0.15 }); break;
      case 'combo': [0, 2, 4].forEach((k, j) => tone(note(660, k), t + j * 0.07, 0.14, { type: 'triangle', vol: 0.24 })); break;
      case 'warn': tone(440, t, 0.12, { type: 'square', vol: 0.1 }); tone(330, t + 0.14, 0.14, { type: 'square', vol: 0.1 }); break;
      case 'splash': noise(t, 0.45, 0.35, 400); tone(400, t, 0.4, { type: 'sine', slide: 120, vol: 0.2 }); break;
      case 'rain': noise(t, 0.7, 0.3, 1500); [0, 1, 2, 3, 4].forEach(k => tone(note(880, 4 - k), t + k * 0.09, 0.2, { type: 'sine', vol: 0.12 })); break;
      case 'count': tone(520, t, 0.16, { type: 'triangle', vol: 0.3 }); break;
      case 'go': tone(784, t, 0.35, { type: 'triangle', vol: 0.34 }); tone(1047, t + 0.08, 0.35, { type: 'triangle', vol: 0.25 }); break;
      case 'win': [0, 2, 4, 5, 7, 9].forEach((k, j) => tone(note(523, k), t + j * 0.11, 0.3, { type: 'triangle', vol: 0.28 })); break;
      case 'lose': [4, 3, 2, 0].forEach((k, j) => tone(note(392, k), t + j * 0.16, 0.34, { type: 'sine', vol: 0.24 })); break;
      case 'error': tone(200, t, 0.16, { type: 'square', vol: 0.1 }); break;
      case 'chat': tone(880, t, 0.07, { type: 'sine', vol: 0.15 }); break;
    }
  };

  /* ---------- 背景音樂：輕快的五聲音階琶音＋低音，依主題換調性與速度 ---------- */
  const KEYS = { a: [262, 100, 0], b: [294, 110, 1], c: [330, 104, 2], d: [247, 96, 3], e: [220, 84, 4], f: [277, 92, 5], g: [233, 80, 2] };
  const PATTERNS = [
    [0, 2, 4, 2, 5, 4, 2, 1], [0, 4, 2, 4, 7, 5, 4, 2], [2, 4, 5, 4, 2, 1, 0, 1],
    [0, 1, 2, 4, 2, 1, 0, 2], [4, 5, 7, 5, 4, 2, 4, 2], [0, 2, 1, 4, 2, 5, 4, 2]
  ];
  function schedule() {
    if (!ctx || !bgmKey) return;
    const [base, bpm, pi] = KEYS[bgmKey] || KEYS.a;
    const stepDur = 60 / bpm / 2;
    while (bgmNext < ctx.currentTime + 0.4) {
      const pat = PATTERNS[(pi + Math.floor(bgmStep / 16)) % PATTERNS.length];
      const i = bgmStep % 8;
      tone(note(base * 2, pat[i]), bgmNext, stepDur * 1.6, { type: 'triangle', vol: 0.5, dest: bgmGain });
      if (i % 4 === 0) tone(note(base / 2, [0, 2, 4, 2][Math.floor(bgmStep / 4) % 4]), bgmNext, stepDur * 3.5, { type: 'sine', vol: 0.55, dest: bgmGain });
      if (i === 4) tone(note(base * 4, pat[(i + 3) % 8]), bgmNext, stepDur * 1.2, { type: 'sine', vol: 0.18, dest: bgmGain });
      bgmNext += stepDur; bgmStep++;
    }
  }
  S.bgm = function (key) {
    wantBgm = key || null;
    if (!ctx || ctx.state !== 'running') return;
    clearInterval(bgmTimer);
    bgmKey = key || null;
    if (!bgmKey) return;
    bgmStep = 0; bgmNext = ctx.currentTime + 0.05;
    schedule();
    bgmTimer = setInterval(schedule, 150);
  };
  root.Sound = S;
})(typeof self !== 'undefined' ? self : this);
