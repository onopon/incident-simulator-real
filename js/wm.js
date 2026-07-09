/* ============================================================
   INCIDENT: 02:17 REAL ― ウィンドウマネージャ
   （ウィンドウ / ドック / トースト通知 / モーダル / メニューバー）
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { $, el, esc } = IS;

  const APPS = {}; // id -> { title, icon, mount(bodyEl), onShow? }
  const wins = {}; // id -> { root, body, minimized }
  let zTop = 100;

  /* ---------------- ウィンドウ生成 ---------------- */
  function defaultRect(id) {
    const W = window.innerWidth, H = window.innerHeight - 90;
    const layouts = {
      slack: { x: 24, y: 46, w: Math.min(760, W * 0.52), h: Math.min(640, H * 0.92) },
      aws: { x: W * 0.36, y: 66, w: Math.min(880, W * 0.6), h: Math.min(620, H * 0.88) },
      atlas: { x: W * 0.30, y: 96, w: Math.min(820, W * 0.56), h: Math.min(600, H * 0.84) },
      term: { x: W * 0.42, y: 130, w: Math.min(760, W * 0.52), h: Math.min(500, H * 0.7) },
      wiki: { x: W * 0.25, y: 80, w: Math.min(860, W * 0.58), h: Math.min(620, H * 0.86) },
    };
    return layouts[id] || { x: 80, y: 80, w: 700, h: 520 };
  }

  function createWindow(id) {
    const app = APPS[id];
    const rect = defaultRect(id);
    const root = el('div', 'window opening');
    root.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;`;

    const title = el('div', 'win-title');
    const dots = el('div', 'wt-dots');
    const bClose = el('button', 'wt-dot wt-close');
    const bMin = el('button', 'wt-dot wt-min');
    const bMax = el('button', 'wt-dot wt-max');
    dots.append(bClose, bMin, bMax);
    title.appendChild(dots);
    title.appendChild(el('span', 'wt-icon', app.icon));
    title.appendChild(el('span', 'wt-text', esc(app.title)));

    const body = el('div', 'win-body');
    const resize = el('div', 'win-resize');
    root.append(title, body, resize);
    $('#windows').appendChild(root);

    const win = { root, body, minimized: false, maximized: false, saved: null };
    wins[id] = win;

    bClose.onclick = (e) => { e.stopPropagation(); IS.wm.close(id); };
    bMin.onclick = (e) => { e.stopPropagation(); win.minimized = true; root.classList.add('minimized'); refreshDock(); };
    bMax.onclick = (e) => { e.stopPropagation(); toggleMax(id); };
    title.ondblclick = () => toggleMax(id);
    root.addEventListener('pointerdown', () => IS.wm.focus(id));

    /* ドラッグ移動 */
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wt-dot')) return;
      const sx = e.clientX, sy = e.clientY;
      const ox = root.offsetLeft, oy = root.offsetTop;
      const move = (ev) => {
        root.style.left = `${IS.clamp(ox + ev.clientX - sx, -rectW() + 120, window.innerWidth - 60)}px`;
        root.style.top = `${IS.clamp(oy + ev.clientY - sy, 0, window.innerHeight - 90)}px`;
      };
      const rectW = () => root.offsetWidth;
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    /* リサイズ */
    resize.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const ow = root.offsetWidth, oh = root.offsetHeight;
      const move = (ev) => {
        root.style.width = `${Math.max(380, ow + ev.clientX - sx)}px`;
        root.style.height = `${Math.max(240, oh + ev.clientY - sy)}px`;
        IS.bus.emit('win-resized', { id });
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    app.mount(body);
    setTimeout(() => root.classList.remove('opening'), 250);
    return win;
  }

  function toggleMax(id) {
    const win = wins[id];
    if (!win) return;
    const r = win.root;
    if (!win.maximized) {
      win.saved = { l: r.style.left, t: r.style.top, w: r.style.width, h: r.style.height };
      r.style.left = '6px';
      r.style.top = '40px';
      r.style.width = `${window.innerWidth - 12}px`;
      r.style.height = `${window.innerHeight - 46}px`;
      win.maximized = true;
    } else {
      Object.assign(r.style, { left: win.saved.l, top: win.saved.t, width: win.saved.w, height: win.saved.h });
      win.maximized = false;
    }
    IS.bus.emit('win-resized', { id });
  }

  /* ---------------- 公開API ---------------- */
  IS.wm = {
    register(id, def) { APPS[id] = def; },

    open(id, opts = {}) {
      let win = wins[id];
      if (!win) win = createWindow(id);
      if (win.minimized) { win.minimized = false; win.root.classList.remove('minimized'); }
      this.focus(id);
      if (!opts.silent) IS.bus.emit('app-open', { id });
      this.badge(id, 0);
      refreshDock();
      return win;
    },

    close(id) {
      const win = wins[id];
      if (!win) return;
      win.root.remove();
      delete wins[id];
      refreshDock();
    },

    focus(id) {
      const win = wins[id];
      if (!win) return;
      zTop += 1;
      win.root.style.zIndex = zTop;
      Object.values(wins).forEach((w) => w.root.classList.remove('focused'));
      win.root.classList.add('focused');
      IS.bus.emit('app-focus', { id });
    },

    isVisible(id) {
      const win = wins[id];
      if (!win || win.minimized) return false;
      return Number(win.root.style.zIndex || 0) === zTop;
    },
    isOpen(id) { return !!wins[id] && !wins[id].minimized; },

    badge(id, n) {
      const icon = $(`.dock-icon[data-app="${id}"] .di-badge`);
      if (!icon) return;
      if (n > 0) { icon.textContent = n > 99 ? '99+' : n; icon.classList.remove('hidden'); }
      else icon.classList.add('hidden');
    },
    badgeAdd(id, n = 1) {
      const icon = $(`.dock-icon[data-app="${id}"] .di-badge`);
      if (!icon) return;
      const cur = icon.classList.contains('hidden') ? 0 : Number(icon.textContent) || 0;
      this.badge(id, cur + n);
    },
  };

  function refreshDock() {
    IS.$$('.dock-icon').forEach((b) => {
      const id = b.dataset.app;
      b.classList.toggle('open', !!wins[id] && !wins[id].minimized);
    });
  }

  /* ---------------- トースト通知 ---------------- */
  IS.notify = (appId, { title, body, icon, sev }) => {
    if (IS.state.over) return;
    const box = $('#toasts');
    const t = el('div', `toast ${sev || ''}`);
    t.appendChild(el('span', 'toast-icon', icon || '💬'));
    const tb = el('div', 'toast-body');
    tb.appendChild(el('div', 'toast-title', esc(title)));
    tb.appendChild(el('div', 'toast-text', esc(body)));
    t.appendChild(tb);
    box.appendChild(t);
    t.onclick = () => { IS.wm.open(appId); dismiss(); };
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 260);
    };
    setTimeout(dismiss, 6500);
    while (box.children.length > 5) box.firstChild.remove();
    if (sev === 'crit') IS.sound.alarm();
    else if (sev === 'warn') IS.sound.warn();
    else IS.sound.knock();
  };

  /* ---------------- モーダル ---------------- */
  IS.modal = ({ title, bodyHtml, bodyEl, actions, onClose }) => {
    const layer = $('#modal-layer');
    layer.innerHTML = '';
    layer.classList.remove('hidden');
    const m = el('div', 'modal');
    m.appendChild(el('h3', '', esc(title)));
    const body = el('div', 'modal-body');
    if (bodyHtml) body.innerHTML = bodyHtml;
    if (bodyEl) body.appendChild(bodyEl);
    m.appendChild(body);
    const acts = el('div', 'modal-actions');
    const close = () => { layer.classList.add('hidden'); layer.innerHTML = ''; onClose && onClose(); };
    for (const a of actions || [{ label: '閉じる' }]) {
      const b = el('button', `btn ${a.kind || ''}`, esc(a.label));
      if (a.id) b.id = a.id;
      if (a.disabled) b.disabled = true;
      b.onclick = () => {
        if (a.onClick) { if (a.onClick(body, close) === false) return; }
        if (!a.keepOpen) close();
      };
      acts.appendChild(b);
    }
    m.appendChild(acts);
    layer.appendChild(m);
    return { body, close };
  };

  /* ---------------- メニューバー ---------------- */
  IS.bus.on('tick', () => {
    $('#mb-clock').textContent = IS.clock.fmt(IS.clock.gm);
    const remain = IS.clock.realLimit - IS.clock.realElapsed;
    const se = $('#mb-shift');
    se.textContent = `🕐 ${IS.clock.fmtReal(remain)}`;
    se.className = `mb-shift ${remain < 180 ? 'crit' : remain < 420 ? 'warn' : ''}`;
  });

  IS.bus.on('metrics', () => {
    const sev = IS.metrics.impact();
    const st = $('#mb-status');
    document.body.dataset.sev = sev;
    if (sev === 'crit') { st.textContent = '● SERVICE DISRUPTION'; st.className = 'mb-status crit'; }
    else if (sev === 'warn') { st.textContent = '● DEGRADED PERFORMANCE'; st.className = 'mb-status warn'; }
    else { st.textContent = '● ALL SYSTEMS OK'; st.className = 'mb-status'; }
  });

  /* ドックのクリック */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.dock-icon');
    if (!b) return;
    const id = b.dataset.app;
    if (wins[id] && !wins[id].minimized && IS.wm.isVisible(id)) {
      wins[id].minimized = true;
      wins[id].root.classList.add('minimized');
      refreshDock();
    } else {
      IS.wm.open(id);
    }
  });

  /* サウンド・フルスクリーン */
  $('#mb-sound').onclick = () => {
    IS.sound.setEnabled(!IS.sound.enabled);
    $('#mb-sound').textContent = IS.sound.enabled ? '🔊' : '🔇';
  };
  $('#mb-fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
})();
