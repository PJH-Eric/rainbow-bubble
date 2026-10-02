/* ===== ui.js — 自訂介面元件（按鈕、分段選項、步進器、開關、音量滑桿、彈窗） =====
 * 全部是自家樣式；需要原生語意的地方用 <button>＋ARIA，保留鍵盤、觸控與可見焦點。
 * 不使用原生 <select>、<input type=range|checkbox>。
 */
(function (root) {
  'use strict';
  const doc = root.document;

  function h(tag, attrs) {
    const el = doc.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(k => add(el, k)); return; }
    el.appendChild(kid.nodeType ? kid : doc.createTextNode(String(kid)));
  }

  /* ---------- 按鈕 ---------- */
  function btn(label, o) {
    o = o || {};
    const b = h('button', {
      type: 'button', class: 'btn ' + (o.cls || 'btn-sky'), 'aria-label': o.aria, disabled: o.disabled, title: o.title,
      onClick: e => { if (root.Sound) root.Sound.sfx('click'); if (o.onClick) o.onClick(e); }
    });
    if (o.icon) b.appendChild(h('span', { class: 'btn-ico', html: root.Art.icon(o.icon, o.iconSize || 22) }));
    if (label != null && label !== '') b.appendChild(h('span', { class: 'btn-label' }, label));
    return b;
  }
  function iconBtn(name, aria, onClick, cls) {
    return h('button', { type: 'button', class: 'icon-btn ' + (cls || ''), 'aria-label': aria, title: aria, html: root.Art.icon(name, 22), onClick: e => { if (root.Sound) root.Sound.sfx('click'); onClick(e); } });
  }

  /* ---------- 分段選項（radiogroup） ---------- */
  function seg(o) {
    const wrap = h('div', { class: 'seg ' + (o.cls || ''), role: 'radiogroup', 'aria-label': o.label || '' });
    const btns = [];
    const render = value => {
      btns.forEach((b, i) => {
        const on = o.options[i].v === value;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on || (value == null && i === 0) ? 0 : -1;
      });
    };
    o.options.forEach((opt, i) => {
      const b = h('button', {
        type: 'button', role: 'radio', class: 'seg-btn', disabled: o.disabled || opt.disabled, title: opt.title,
        onClick: () => { if (root.Sound) root.Sound.sfx('click'); render(opt.v); o.onChange && o.onChange(opt.v); },
        onKeydown: e => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const n = btns[(i + d + btns.length) % btns.length];
          n.focus(); n.click();
        }
      }, opt.icon ? h('span', { html: root.Art.icon(opt.icon, 18) }) : null, opt.label);
      btns.push(b); wrap.appendChild(b);
    });
    render(o.value);
    wrap.setValue = render;
    return wrap;
  }

  /* ---------- 步進器 ---------- */
  function stepper(o) {
    let v = o.value;
    const out = h('output', { class: 'stepper-val', 'aria-live': 'polite' });
    const minus = h('button', { type: 'button', class: 'step-btn', 'aria-label': (o.label || '') + ' 減少', html: root.Art.icon('minus', 20) });
    const plus = h('button', { type: 'button', class: 'step-btn', 'aria-label': (o.label || '') + ' 增加', html: root.Art.icon('plus', 20) });
    const wrap = h('div', { class: 'stepper', role: 'group', 'aria-label': o.label || '' }, minus, out, plus);
    const paint = () => {
      out.textContent = o.fmt ? o.fmt(v) : String(v);
      minus.disabled = v <= o.min || !!o.disabled; plus.disabled = v >= o.max || !!o.disabled;
    };
    const set = n => { n = Math.max(o.min, Math.min(o.max, n)); if (n === v) return; v = n; paint(); if (root.Sound) root.Sound.sfx('click'); o.onChange && o.onChange(v); };
    minus.addEventListener('click', () => set(v - (o.step || 1)));
    plus.addEventListener('click', () => set(v + (o.step || 1)));
    wrap.setValue = n => { v = n; paint(); };
    paint();
    return wrap;
  }

  /* ---------- 開關 ---------- */
  function toggle(o) {
    let on = !!o.value;
    const b = h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': on ? 'true' : 'false', 'aria-label': o.label, disabled: o.disabled },
      h('span', { class: 'sw-knob' }));
    b.addEventListener('click', () => { on = !on; b.setAttribute('aria-checked', on ? 'true' : 'false'); if (root.Sound) root.Sound.sfx('click'); o.onChange && o.onChange(on); });
    b.setValue = v => { on = !!v; b.setAttribute('aria-checked', on ? 'true' : 'false'); };
    return b;
  }

  /* ---------- 音量滑桿（自訂，支援拖曳與方向鍵） ---------- */
  function volume(o) {
    let v = o.value;
    const fill = h('span', { class: 'vol-fill' });
    const thumb = h('span', { class: 'vol-thumb' });
    const track = h('div', { class: 'vol', role: 'slider', tabindex: o.disabled ? -1 : 0, 'aria-label': o.label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-disabled': o.disabled ? 'true' : null }, fill, thumb);
    const paint = () => {
      const pct = Math.round(v * 100);
      fill.style.width = pct + '%'; thumb.style.left = pct + '%';
      track.setAttribute('aria-valuenow', pct); track.setAttribute('aria-valuetext', pct + '%');
    };
    const setFromX = x => {
      const r = track.getBoundingClientRect();
      v = Math.max(0, Math.min(1, (x - r.left) / r.width)); v = Math.round(v * 20) / 20;
      paint(); o.onChange && o.onChange(v);
    };
    track.addEventListener('pointerdown', e => {
      if (o.disabled) return;
      track.setPointerCapture(e.pointerId); setFromX(e.clientX);
      const move = ev => setFromX(ev.clientX);
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); if (root.Sound) root.Sound.sfx('click'); };
      track.addEventListener('pointermove', move); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    });
    track.addEventListener('keydown', e => {
      if (o.disabled) return;
      const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
      if (e.key === 'Home') { v = 0; } else if (e.key === 'End') { v = 1; } else if (d) { v = Math.max(0, Math.min(1, Math.round((v + d) * 20) / 20)); } else return;
      e.preventDefault(); paint(); o.onChange && o.onChange(v);
    });
    paint();
    track.setValue = n => { v = n; paint(); };
    track.setDisabled = d => { o.disabled = d; track.tabIndex = d ? -1 : 0; track.classList.toggle('is-off', d); };
    if (o.disabled) track.classList.add('is-off');
    return track;
  }


  /* ---------- 下拉選單（自訂，不用原生 <select>）：彈出清單浮在最上層，不會被捲動區裁掉 ---------- */
  let openPop = null;
  function closePop(back) {
    if (!openPop) return;
    const p = openPop; openPop = null;
    p.list.remove(); p.btn.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', p.onDown, true); doc.removeEventListener('keydown', p.onKey, true);
    root.removeEventListener('resize', p.onAway); root.removeEventListener('scroll', p.onAway, true);
    if (back) try { p.btn.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
  }
  function dropdown(o) {
    let value = o.value;
    const cur = h('span', { class: 'dd-cur' });
    const b = h('button', { type: 'button', class: 'dd ' + (o.cls || ''), 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': o.label || '', disabled: o.disabled }, cur, h('i', { class: 'dd-caret', 'aria-hidden': 'true' }));
    const paint = () => { const f = o.options.find(x => x.v === value); cur.textContent = ''; if (f && f.swatch) cur.appendChild(h('i', { class: 'dd-sw', style: { background: f.swatch } })); cur.appendChild(doc.createTextNode(f ? f.label : (o.placeholder || '請選擇'))); };
    function open() {
      closePop();
      const list = h('div', { class: 'dd-list', role: 'listbox', 'aria-label': o.label || '' });
      const items = o.options.map(opt => {
        const it = h('button', { type: 'button', role: 'option', class: 'dd-opt', 'aria-selected': opt.v === value ? 'true' : 'false', tabindex: -1,
          onClick: () => { if (root.Sound) root.Sound.sfx('click'); value = opt.v; paint(); closePop(true); o.onChange && o.onChange(opt.v); } },
          opt.swatch ? h('i', { class: 'dd-sw', style: { background: opt.swatch } }) : null, h('span', { class: 'dd-name' }, opt.label), opt.hint ? h('small', null, opt.hint) : null);
        list.appendChild(it); return it;
      });
      let layer = doc.getElementById('pop-layer');
      if (!layer) { layer = h('div', { id: 'pop-layer', class: 'pop-layer' }); doc.body.appendChild(layer); }
      layer.appendChild(list);
      const r = b.getBoundingClientRect(), vh = root.innerHeight, vw = root.innerWidth;
      const w = Math.min(vw - 16, Math.max(r.width, 200));
      let left = Math.min(Math.max(8, r.right - w), vw - w - 8);
      const need = Math.min(list.scrollHeight, 320), below = vh - r.bottom - 10, above = r.top - 10;
      const up = below < need && above > below;
      list.style.width = w + 'px'; list.style.left = left + 'px';
      list.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
      if (up) list.style.bottom = (vh - r.top + 6) + 'px'; else list.style.top = (r.bottom + 6) + 'px';
      b.setAttribute('aria-expanded', 'true');
      const pop = { list, btn: b };
      pop.onDown = e => { if (!list.contains(e.target) && !b.contains(e.target)) closePop(); };
      pop.onAway = e => { if (e && e.target && list.contains(e.target)) return; closePop(); };
      pop.onKey = e => {
        const idx = items.indexOf(doc.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
        else if (e.key === 'Tab') closePop();
        else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      };
      doc.addEventListener('pointerdown', pop.onDown, true); doc.addEventListener('keydown', pop.onKey, true);
      root.addEventListener('resize', pop.onAway); root.addEventListener('scroll', pop.onAway, true);
      openPop = pop;
      const sel = items.find(x => x.getAttribute('aria-selected') === 'true') || items[0];
      setTimeout(() => sel.focus({ preventScroll: false }), 0);
    }
    b.addEventListener('click', () => { if (root.Sound) root.Sound.sfx('click'); if (openPop && openPop.btn === b) closePop(true); else open(); });
    b.setValue = v => { value = v; paint(); };
    paint();
    return b;
  }

  function avatar(dragon, size) {
    const img = h('img', { class: 'avatar-img', alt: '', draggable: 'false', src: root.Art.svgUrl(root.Art.dragonFaceSVG(dragon || 'rainbow')) });
    return h('span', { class: 'avatar', style: { width: (size || 48) + 'px', height: (size || 48) + 'px' } }, img);
  }
  function keycap(text, extra) { return h('kbd', { class: 'key ' + (extra || '') }, text); }

  /* ---------- 提示 ---------- */
  function toast(text, ms) {
    const box = doc.getElementById('toasts');
    if (!box) return;
    const t = h('div', { class: 'toast', role: 'status' }, text);
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms || 2600);
  }

  /* ---------- 彈窗：遮罩、焦點鎖定、Esc、關閉後焦點回到原處 ---------- */
  const stack = [];
  const FOCUS = 'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function modal(o) {
    o = o || {};
    const opener = doc.activeElement;
    const titleId = 'm' + Math.random().toString(36).slice(2, 7);
    const dialog = h('div', { class: 'dialog ' + (o.cls || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': o.title ? titleId : null, 'aria-label': o.title ? null : o.aria, tabindex: -1 });
    if (o.title || o.dismissible !== false) {
      dialog.appendChild(h('div', { class: 'dialog-head' },
        o.title ? h('h2', { id: titleId, class: 'dialog-title' }, o.title) : h('span'),
        o.dismissible === false ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': '關閉', html: root.Art.icon('close', 22), onClick: () => api.close() })));
    }
    dialog.appendChild(h('div', { class: 'dialog-body' }, o.content));
    if (o.actions && o.actions.length) dialog.appendChild(h('div', { class: 'dialog-actions' }, o.actions));
    const mask = h('div', { class: 'mask' }, dialog);
    if (o.dismissible !== false) mask.addEventListener('pointerdown', e => { if (e.target === mask) api.close(); });
    doc.getElementById('modals').appendChild(mask);
    const app = doc.getElementById('app');
    if (app) { app.setAttribute('aria-hidden', 'true'); app.inert = true; }
    const api = {
      el: dialog, mask, closed: false,
      close(silent) {
        if (api.closed) return;
        api.closed = true;
        const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        mask.classList.add('out');
        setTimeout(() => mask.remove(), 160);
        if (!stack.length && app) { app.removeAttribute('aria-hidden'); app.inert = false; }
        if (!silent && o.onClose) o.onClose();
        if (opener && opener.focus && doc.contains(opener)) try { opener.focus(); } catch (e) { /* 忽略 */ }
      },
      dismissible: o.dismissible !== false
    };
    stack.push(api);
    setTimeout(() => {
      const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUS);
      (first || dialog).focus();
    }, 30);
    return api;
  }
  doc.addEventListener('keydown', e => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (openPop) return;
    if (e.key === 'Escape' && top.dismissible) { e.preventDefault(); e.stopPropagation(); top.close(); return; }
    if (e.key === 'Tab') {
      const nodes = Array.from(top.el.querySelectorAll(FOCUS)).filter(n => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (doc.activeElement === first || !top.el.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (doc.activeElement === last || !top.el.contains(doc.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }, true);
  const modalOpen = () => stack.length > 0;
  function closeAllModals() { while (stack.length) stack[stack.length - 1].close(); }
  /** 返回鍵用：只關最上層、而且要是可關閉的（對局結果這種不能被返回鍵關掉） */
  function closeTopModal() { const top = stack[stack.length - 1]; if (top && top.dismissible) top.close(); }

  function confirmBox(o) {
    const m = modal({
      title: o.title, content: h('p', { class: 'dialog-text' }, o.text), cls: 'dialog-sm',
      actions: [
        btn(o.cancel || '取消', { cls: 'btn-ghost', onClick: () => m.close() }),
        btn(o.ok || '確定', { cls: o.danger ? 'btn-pink' : 'btn-mint', onClick: () => { m.close(true); o.onOk && o.onOk(); } })
      ]
    });
    return m;
  }

  /* ---------- 複製 ---------- */
  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) return root.navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', opacity: '0', left: '-9999px' } });
    ta.value = text; doc.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  root.UI = { h, btn, iconBtn, seg, stepper, toggle, volume, dropdown, closePop, avatar, keycap, toast, modal, confirmBox, copyText, modalOpen, closeAllModals, closeTopModal };
})(typeof self !== 'undefined' ? self : this);
