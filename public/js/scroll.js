/* ===== scroll.js — 自訂卷軸：隱藏瀏覽器原生卷軸，改用自家樣式的滑軌／滑塊 =====
 * 直向：右側浮動滑塊（可拖曳、點軌道翻頁）；橫向：底部細滑軌＋兩端漸層，滑鼠可拖曳、滾輪可橫移。
 * 觸控、鍵盤與原生捲動行為不變，只是外觀換成自訂。內容放不下時一定看得到卷軸。
 */
(function (root) {
  'use strict';
  const doc = root.document;
  const V_SEL = '.screen, .dialog-body, .chat-log, .game-side, .summary, .dd-list';
  const H_SEL = '.seg, .chips, .quick-chat, .ai-faces, .seat-actions';
  const reg = new Set();

  function mk(cls) { const d = doc.createElement('div'); d.className = cls; return d; }

  function attach(el, axis) {
    if (el._sc) return;
    const parent = el.parentNode;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const track = mk('sc-track ' + axis), thumb = mk('sc-thumb');
    track.appendChild(thumb);
    el.after(track);
    el.classList.add('sc-hide');
    const o = { el, axis, track, thumb, hideT: 0 };
    el._sc = o; reg.add(o);

    const flash = () => { track.classList.add('show'); clearTimeout(o.hideT); o.hideT = setTimeout(() => track.classList.remove('show'), 1100); };
    o.update = () => {
      if (!el.isConnected) return;
      const v = axis === 'v';
      const size = v ? el.clientHeight : el.clientWidth, total = v ? el.scrollHeight : el.scrollWidth;
      const pos = v ? el.scrollTop : el.scrollLeft;
      const can = total > size + 2;
      track.hidden = !can;
      el.classList.toggle('can-' + (v ? 't' : 'l'), can && pos > 2);
      el.classList.toggle('can-' + (v ? 'b' : 'r'), can && pos < total - size - 2);
      if (!can) return;
      if (v) {
        const inset = 6, th = Math.max(0, el.offsetHeight - inset * 2);
        track.style.cssText = 'left:' + (el.offsetLeft + el.offsetWidth - 12) + 'px;top:' + (el.offsetTop + inset) + 'px;height:' + th + 'px';
        const len = Math.max(36, th * size / total), maxTop = th - len;
        thumb.style.height = len + 'px'; thumb.style.transform = 'translateY(' + (maxTop * pos / (total - size)) + 'px)';
      } else {
        const inset = 8, tw = Math.max(0, el.offsetWidth - inset * 2);
        track.style.cssText = 'left:' + (el.offsetLeft + inset) + 'px;top:' + (el.offsetTop + el.offsetHeight - 1) + 'px;width:' + tw + 'px';
        const len = Math.max(28, tw * size / total), maxL = tw - len;
        thumb.style.width = len + 'px'; thumb.style.transform = 'translateX(' + (maxL * pos / (total - size)) + 'px)';
      }
    };
    el.addEventListener('scroll', () => { o.update(); flash(); }, { passive: true });
    track.addEventListener('pointerenter', () => track.classList.add('show'));
    track.addEventListener('pointerleave', () => { if (!o.drag) flash(); });

    /* 拖曳滑塊／點軌道 */
    thumb.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      const v = axis === 'v';
      o.drag = { start: v ? e.clientY : e.clientX, pos: v ? el.scrollTop : el.scrollLeft };
      thumb.classList.add('drag');
    });
    thumb.addEventListener('pointermove', e => {
      if (!o.drag) return;
      const v = axis === 'v';
      const trackLen = v ? track.clientHeight : track.clientWidth, thumbLen = v ? thumb.offsetHeight : thumb.offsetWidth;
      const total = v ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      const d = ((v ? e.clientY : e.clientX) - o.drag.start) * total / Math.max(1, trackLen - thumbLen);
      if (v) el.scrollTop = o.drag.pos + d; else el.scrollLeft = o.drag.pos + d;
    });
    const end = () => { o.drag = null; thumb.classList.remove('drag'); flash(); };
    thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    track.addEventListener('pointerdown', e => {
      if (e.target !== track) return;
      const r = track.getBoundingClientRect(), v = axis === 'v';
      const frac = v ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      const total = v ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      const target = frac * total - (v ? el.clientHeight : el.clientWidth) / 2;
      el.scrollTo({ [v ? 'top' : 'left']: target, behavior: 'smooth' });
    });

    if (axis === 'h') {
      /* 滾輪橫移、滑鼠拖曳 */
      el.addEventListener('wheel', e => {
        if (el.scrollWidth <= el.clientWidth + 2 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        el.scrollLeft += e.deltaY; e.preventDefault();
      }, { passive: false });
      /* document 的 move/up 只在拖曳期間掛上：元素常被重繪丟掉，常駐掛著會一直累積 */
      let down = null, moved = false;
      const onMove = e => {
        if (!down || !el.isConnected) return;
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 6) { moved = true; el.scrollLeft = down.left - dx; }
      };
      const onUp = () => { down = null; doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onUp); };
      el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        down = { x: e.clientX, left: el.scrollLeft }; moved = false;
        doc.addEventListener('pointermove', onMove); doc.addEventListener('pointerup', onUp);
      });
      el.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    }
    o.update();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    const hit = (sel, axis) => { if (node.matches(sel)) attach(node, axis); node.querySelectorAll(sel).forEach(n => attach(n, axis)); };
    hit(V_SEL, 'v'); hit(H_SEL, 'h');
  }
  function sweep() {
    for (const o of Array.from(reg)) {
      if (!o.el.isConnected) { o.track.remove(); reg.delete(o); clearTimeout(o.hideT); }
      else o.update();
    }
  }
  function init() {
    const mo = new MutationObserver(list => { for (const m of list) m.addedNodes.forEach(scan); sweep(); });
    mo.observe(doc.body, { childList: true, subtree: true });
    scan(doc.body);
    setInterval(sweep, 400);
    root.addEventListener('resize', sweep);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  root.ScrollKit = { sweep };
})(typeof self !== 'undefined' ? self : this);
