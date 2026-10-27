/* ===== quest-ui.js — 闖關模式的畫面：難度選擇、選關、開局目標卡（對局與結算在 game.js） =====
 * 流程：單機設定（闖關入口）→ quest（四段難度）→ questLevels（選關）→ 目標卡 → 對局 → 結算（下一關／再玩／回選關）
 * 進度只存本機（Store.quest*）。所有元件都是自繪（不用原生 select／捲軸）。 */
(function (root) {
  'use strict';
  const { h, btn, avatar, modal } = root.UI;
  const R = root.Rules, Art = root.Art, App = root.App, Q = root.Quests, S = root.Store;
  const T = (k, p, fb) => root.I18N.t(k, p, fb);
  const go = (n, p, o) => App.go(n, p, o);
  const LEVELS = R.LEVELS;
  const imgOf = (svg, size, cls) => h('img', { class: cls || '', alt: '', draggable: 'false', src: Art.svgUrl(svg), width: size, height: size });

  /* ---------- 共用：目標文字、圖示、星星 ---------- */
  /** quest = 盤面上的 b.quest（帶 starTotal 等計數）；回傳目前語言的目標文字 */
  function goalText(quest) {
    const g = quest.goal;
    if (g.type === 'star') return T('quest.goal.star', { n: quest.starTotal });
    if (g.type === 'bonus') return T('quest.goal.bonus', { n: g.n });
    if (g.type === 'color') return T('quest.goal.color', { n: g.n });
    return T('quest.goal.clear');
  }
  function goalIcon(quest, size) {
    const g = quest.goal;
    if (g.type === 'star') return imgOf(Art.bubbleSVG(2, { mod: 1 }), size, 'q-goal-bub');
    if (g.type === 'bonus') return imgOf(Art.bubbleSVG(3, { mod: 2 }), size, 'q-goal-bub');
    if (g.type === 'color') return imgOf(Art.bubbleSVG(g.color), size, 'q-goal-bub');
    return h('span', { class: 'q-goal-ico', html: Art.icon('target', size) });
  }
  const miniText = id => T('quest.mini.' + id);
  function stars(n, size) {
    return h('span', { class: 'q-stars', role: 'img', 'aria-label': T('quest.res.starsAria', { n }) },
      [1, 2, 3].map(i => h('i', { class: 'q-star' + (i <= n ? ' on' : '') + ' s' + i, html: Art.icon('star', size || 16) })));
  }
  const bossDragon = no => Art.DRAGONS[(Math.floor((no - 1) / 10)) % Art.DRAGONS.length].id;
  const layoutName = def => T('layout.' + def.layout, null, def.layout);

  /* ---------- 四段難度 ---------- */
  App.screens.quest = function () {
    const st = App.store;
    const cards = LEVELS.map(lv => {
      const cleared = S.questCleared(st, lv), total = Q.count(lv) || Q.PER_LEVEL, ts = S.questTotalStars(st, lv);
      const done = cleared >= total;
      return h('button', { type: 'button', class: 'q-lvl-card lv-' + lv, 'data-level': lv, onClick: () => { root.Sound.sfx('click'); go('questLevels', { level: lv }); } },
        h('span', { class: 'q-lvl-head' }, h('b', null, R.LEVEL_NAME[lv]), done ? h('span', { class: 'q-crown', html: Art.icon('crown', 22) }) : null),
        h('span', { class: 'muted small' }, T('level.hint.' + lv)),
        h('span', { class: 'q-lvl-bar', role: 'presentation' }, h('i', { style: { width: Math.round(cleared / total * 100) + '%' } })),
        h('span', { class: 'q-lvl-meta' }, h('span', null, T('quest.progress', { n: cleared, total })), h('span', { class: 'q-lvl-stars' }, h('i', { html: Art.icon('star', 16) }), T('quest.starsTotal', { n: ts }))));
    });
    return App.util.screenBox('quest-screen', h('div', { class: 'wrap' },
      App.util.topbar(T('quest.entry.h'), () => go('solo')),
      h('p', { class: 'muted' }, T('quest.pick')),
      h('div', { class: 'q-lvl-grid' }, cards)));
  };

  /* ---------- 選關 ---------- */
  App.screens.questLevels = function (p) {
    const lv = LEVELS.indexOf(p.level) >= 0 ? p.level : 'easy';
    const st = App.store;
    const unlocked = S.questUnlocked(st, lv);
    const total = Q.count(lv) || Q.PER_LEVEL;
    const groups = [];
    for (let g = 0; g < total / Q.GROUP; g++) {
      const th = Art.THEMES[g % Art.THEMES.length];
      const cells = [];
      for (let k = 1; k <= Q.GROUP; k++) {
        const no = g * Q.GROUP + k;
        const stn = S.questStars(st, lv, no), locked = no > unlocked, boss = Q.isBoss(no), now = no === unlocked && stn === 0;
        cells.push(h('button', {
          type: 'button', class: 'q-cell' + (boss ? ' boss' : '') + (locked ? ' locked' : '') + (now ? ' now' : '') + (stn ? ' done' : ''), 'data-no': no, disabled: locked,
          'aria-label': locked ? T('quest.cellLocked', { n: no }) : stn ? T('quest.cell', { n: no, s: stn }) : T('quest.cellNew', { n: no }),
          onClick: () => { root.Sound.sfx('click'); App.startQuest(lv, no); }
        },
          locked ? h('span', { class: 'q-lock', html: Art.icon('lock', 22) }) : h('b', null, no),
          boss ? h('span', { class: 'q-bossmark', html: Art.icon('crown', 16) }) : null,
          locked ? null : stars(stn, 12)));
      }
      groups.push(h('section', { class: 'q-group' },
        h('div', { class: 'q-group-head' },
          h('i', { class: 'q-swatch', style: { background: 'linear-gradient(135deg,' + th.sky[0] + ',' + th.sky[1] + ')' } }),
          h('b', null, (g * Q.GROUP + 1) + '–' + (g * Q.GROUP + Q.GROUP)), h('span', { class: 'muted small' }, th.name)),
        h('div', { class: 'q-grid' }, cells)));
    }
    const cleared = S.questCleared(st, lv);
    const el = App.util.screenBox('quest-screen', h('div', { class: 'wrap' },
      App.util.topbar(R.LEVEL_NAME[lv], () => go('quest')),
      h('div', { class: 'q-summary' },
        h('span', { class: 'pill mint' }, T('quest.progress', { n: cleared, total })),
        h('span', { class: 'pill sun' }, T('quest.starsTotal', { n: S.questTotalStars(st, lv) })),
        cleared >= total ? h('span', { class: 'pill pink' }, T('quest.res.allDone')) : null),
      groups));
    setTimeout(() => {
      const now = el.querySelector('.q-cell.now') || el.querySelector('.q-cell:not(.locked):last-of-type');
      if (now && now.scrollIntoView && !p.open) { try { now.scrollIntoView({ block: 'center' }); } catch (e) { /* 忽略 */ } }
      if (p.open) App.startQuest(lv, p.open);
    }, 30);
    return el;
  };

  /* ---------- 開局目標卡 ---------- */
  App.startQuest = function (lv, no) {
    const def = Q.get(lv, no);
    if (!def || no > S.questUnlocked(App.store, lv)) return null;
    const b = R.newQuestBoard(def);
    const row = (ico, label, text) => h('div', { class: 'q-row' }, h('span', { class: 'q-row-ico' }, ico), h('div', { class: 'q-row-txt' }, h('b', null, label), h('span', null, text)));
    const mo = modal({
      cls: 'dialog-sm dialog-quest', dismissible: true,
      render: () => ({
        title: T('quest.levelN', { n: no }) + '・' + R.LEVEL_NAME[lv],
        content: h('div', { class: 'q-intro' },
          def.boss ? h('div', { class: 'q-boss' }, avatar(bossDragon(no), 84), h('div', null, h('span', { class: 'pill pink' }, T('quest.boss')), h('b', { class: 'q-boss-name' }, layoutName(def)))) : null,
          row(goalIcon(b.quest, 38), T('quest.goal.h'), goalText(b.quest)),
          row(h('span', { class: 'q-row-svg', html: Art.icon('flag', 30) }), T('quest.shots.h'), def.shots ? T('quest.shotsMax', { n: def.shots }) : T('quest.shotsFree')),
          def.mini ? row(h('span', { class: 'q-row-svg', html: Art.icon('star', 30) }), T('quest.mini.h'), miniText(def.mini)) : null,
          h('div', { class: 'q-best' }, stars(S.questStars(App.store, lv, no), 26))),
        actions: [
          btn(T('quest.start'), { cls: 'btn-pink btn-lg', icon: 'play', onClick: () => { mo.close(true); App.beginQuest(def); } }),
          btn(T('common.cancel'), { cls: 'btn-ghost', onClick: () => mo.close() })
        ]
      })
    });
    return mo;
  };

  App.beginQuest = function (def) {
    const st = App.store;
    const cfg = Q.matchCfg(def, { name: App.util.myName(), dragon: st.dragon, kind: 'human' });
    go('game', { kind: 'solo', cfg, slot: 0, ai: {}, quest: def });
  };

  root.QuestUI = { goalText, goalIcon, miniText, stars, bossDragon, layoutName };
})(typeof self !== 'undefined' ? self : this);
