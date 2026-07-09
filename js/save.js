/* ============================================================
   INCIDENT: 02:17 REAL ― セーブ/再開
   ブラウザのlocalStorageへ保存。手動保存＋30秒ごとの自動保存＋
   ページ離脱時の自動保存で、リロードや中断から再開できる
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;

  const KEY = 'incident-0217-real:save:v1';

  function snapshot() {
    return {
      v: 1,
      savedAt: Date.now(),
      clock: { gm: IS.clock.gm, realElapsed: IS.clock.realElapsed },
      state: {
        flags: IS.state.flags,
        params: { ...IS.state.params },
        journal: IS.state.journal,
        counters: { ...IS.state.counters },
      },
      metrics: {
        now: { ...IS.metrics.now },
        target: { ...IS.metrics.target },
        hist: IS.metrics.hist,
      },
      slack: IS.slackApp.serialize(),
      ops: IS.scenario.serializeOps(),
      engineDone: IS.engine.doneIds(),
    };
  }

  const save = (IS.save = {
    canSave() { return IS.state.started && !IS.state.over; },

    store() {
      if (!this.canSave()) return false;
      try {
        localStorage.setItem(KEY, JSON.stringify(snapshot()));
        return true;
      } catch (e) {
        console.error('save failed', e);
        return false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        return d && d.v === 1 ? d : null;
      } catch (e) { return null; }
    },

    exists() { return !!this.load(); },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* no-op */ } },

    /* セーブデータからゲームを再開する（タイトル画面から呼ぶ） */
    resume() {
      const d = this.load();
      if (!d) return false;
      IS.state.flags = d.state.flags || {};
      Object.assign(IS.state.params, d.state.params || {});
      IS.state.journal = d.state.journal || [];
      Object.assign(IS.state.counters, d.state.counters || {});
      IS.clock.gm = d.clock.gm;
      IS.clock.realElapsed = d.clock.realElapsed;
      Object.assign(IS.metrics.now, d.metrics.now || {});
      Object.assign(IS.metrics.target, d.metrics.target || {});
      IS.metrics.hist = d.metrics.hist || [];
      IS.slackApp.restore(d.slack || { channels: [] });
      IS.scenario.resume(d);
      return true;
    },
  });

  /* ---- 自動保存（実時間30秒ごと） ---- */
  let autosaveAcc = 0;
  IS.bus.on('tick', ({ dt }) => {
    if (!save.canSave()) return;
    autosaveAcc += dt;
    if (autosaveAcc >= 30) {
      autosaveAcc = 0;
      save.store();
    }
  });

  /* ---- ページ離脱時: 保存＋誤リロード防止 ---- */
  window.addEventListener('beforeunload', (e) => {
    if (!save.canSave()) return;
    save.store();
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', () => { if (save.canSave()) save.store(); });

  /* ---- メニューバーの手動保存ボタン ---- */
  document.addEventListener('DOMContentLoaded', () => {
    const btn = IS.$('#mb-save');
    if (!btn) return;
    btn.onclick = () => {
      if (save.store()) {
        IS.notify('slack', { title: '保存しました', body: 'このブラウザに保存されました。タイトル画面の「続きから再開」で復帰できます。', icon: '💾' });
      }
    };
  });
})();
