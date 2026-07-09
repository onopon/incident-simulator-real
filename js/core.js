/* ============================================================
   INCIDENT: 02:17 REAL ― コアエンジン
   （イベントバス / ゲーム内時計 / 状態 / メトリクス）
   ============================================================ */
(() => {
  'use strict';

  const IS = (window.IS = {});

  /* ---------------- ユーティリティ ---------------- */
  IS.$ = (sel, root) => (root || document).querySelector(sel);
  IS.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  IS.el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  IS.esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  IS.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  IS.rand = (lo, hi) => lo + Math.random() * (hi - lo);
  IS.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ---------------- イベントバス ---------------- */
  const listeners = {};
  IS.bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(evt, e); } }); },
  };

  /* ---------------- ゲーム内時計 ----------------
     現実1秒 = ゲーム内 SPEED 秒。URLパラメータ ?speed=N でデバッグ変速可 */
  const qs = new URLSearchParams(location.search);
  const SPEED = IS.clamp(Number(qs.get('speed')) || 8, 1, 240);
  const REAL_LIMIT_SEC = IS.clamp(Number(qs.get('limit')) || 30 * 60, 60, 3600);
  const START_GM = 9 * 60 + 40; // 09:40

  IS.clock = {
    gm: START_GM,          // ゲーム内時刻（分・小数）
    running: false,
    speed: SPEED,
    realElapsed: 0,        // 実時間経過（秒）
    realLimit: REAL_LIMIT_SEC,
    _last: 0,
    _timer: null,

    fmt(gm) {
      const m = Math.floor(gm);
      return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    },
    fmtReal(sec) {
      sec = Math.max(0, Math.floor(sec));
      return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    },

    start() {
      this.running = true;
      this._last = performance.now();
      this._timer = setInterval(() => this._tick(), 250);
    },
    stop() {
      this.running = false;
      clearInterval(this._timer);
    },
    _tick() {
      const now = performance.now();
      // タブ非表示などで間隔が飛んでも最大1.2秒分しか進めない（公平性のため）
      const dt = Math.min((now - this._last) / 1000, 1.2);
      this._last = now;
      if (!this.running) return;
      this.realElapsed += dt;
      this.gm += (dt * this.speed) / 60;
      IS.bus.emit('tick', { dt, gm: this.gm });
      if (this.realElapsed >= this.realLimit) {
        IS.bus.emit('timeup');
      }
    },
    /* ゲーム内 n 分後に fn を実行（tick駆動なのでタブ復帰でも整合する） */
    afterGm(minutes, fn) {
      const target = this.gm + minutes;
      const h = (d) => {
        if (d.gm >= target) {
          const i = listeners.tick.indexOf(h);
          if (i >= 0) listeners.tick.splice(i, 1);
          fn();
        }
      };
      IS.bus.on('tick', h);
    },
  };

  /* ---------------- ゲーム状態 ---------------- */
  IS.state = {
    started: false,
    over: false,
    overReason: null, // 'timeout' | 'dead' | 'shift-end'
    flags: {},
    params: { health: 100, userTrust: 90, orgTrust: 70, bizImpact: 5, debt: 60, fatigue: 20 },
    journal: [],      // { gm, tag, label, data }
    counters: { updates: 0, asksReceived: 0, asksAnswered: 0, searches: 0 },

    flag(k, v = true) {
      if (this.flags[k] === v) return;
      this.flags[k] = v;
      IS.bus.emit('flag', { key: k, value: v });
    },
    has(k) { return !!this.flags[k]; },

    mark(tag, label, data) {
      // 同じtagの二重記録を防ぐ（onceでない記録は tag+'!' を使う）
      if (!tag.endsWith('!') && this.journal.some((j) => j.tag === tag)) return;
      this.journal.push({ gm: IS.clock.gm, tag, label, data: data || null });
      IS.bus.emit('journal', { tag, label });
    },
    marked(tag) { return this.journal.find((j) => j.tag === tag) || null; },

    addParams(delta) {
      for (const [k, v] of Object.entries(delta || {})) {
        if (!(k in this.params)) continue;
        this.params[k] = IS.clamp(this.params[k] + v, 0, 100);
      }
      if (this.params.health <= 0 && !this.over) IS.bus.emit('service-dead');
    },
  };

  /* ---------------- メトリクスシミュレーション ----------------
     ターゲット値は scenario.js が状態から算出。ここでは補間・履歴・派生効果を扱う */
  const HIST_MAX = 720; // 0.5ゲーム分ごとに1点 → 6時間分
  IS.metrics = {
    now: { cpu: 14, db: 40, err: 0.2, lat: 430, disk03: 61, healthy: 6, reqs: 220 },
    target: { cpu: 14, db: 40, err: 0.2, lat: 430, disk03: 61, healthy: 6, reqs: 220 },
    hist: [], // { gm, cpu, db, err, lat }
    targetsFn: null, // scenario が設定
    _histAccum: 0,
    _drainAccum: 0,

    /* ユーザー影響が出ているか（健全性ドレイン・演出判定に使用） */
    impact() {
      const m = this.now;
      if (m.healthy === 0) return 'crit';
      if (m.err >= 8 || m.lat >= 6000) return 'crit';
      if (m.err >= 2 || m.lat >= 3000) return 'warn';
      return 'ok';
    },

    init() {
      // 開始前の平常履歴を用意しておく（グラフが最初から自然に見える）
      const g0 = IS.clock.gm - 120;
      for (let i = 0; i < 240; i++) {
        this.hist.push({
          gm: g0 + i * 0.5,
          cpu: 13 + Math.random() * 5,
          db: 36 + Math.random() * 10,
          err: Math.max(0, 0.15 + (Math.random() - 0.5) * 0.2),
          lat: 400 + Math.random() * 70,
          reqs: 200 + Math.random() * 60,
        });
      }
    },

    tick(dt, gmDelta) {
      if (this.targetsFn) this.target = this.targetsFn(IS.state, this.target);
      const t = this.target;
      const n = this.now;
      const k = 1 - Math.pow(0.86, dt * 4); // 補間係数
      n.cpu += (t.cpu - n.cpu) * k;
      n.db += (t.db - n.db) * k;
      n.err += (t.err - n.err) * k;
      n.lat += (t.lat - n.lat) * k;
      n.reqs += (t.reqs - n.reqs) * k;
      n.disk03 = t.disk03;
      n.healthy = t.healthy;

      // 履歴サンプリング（ゲーム内0.5分ごと）
      this._histAccum += gmDelta;
      if (this._histAccum >= 0.5) {
        this._histAccum = 0;
        const j = (v, r) => Math.max(0, v + (Math.random() - 0.5) * r);
        this.hist.push({
          gm: IS.clock.gm,
          cpu: IS.clamp(j(n.cpu, 5), 0, 100),
          db: IS.clamp(j(n.db, 14), 0, 520),
          err: n.healthy === 0 ? 100 : j(n.err, Math.max(0.3, n.err * 0.15)),
          lat: j(n.lat, n.lat * 0.1),
          reqs: j(n.reqs, 40),
        });
        if (this.hist.length > HIST_MAX) this.hist.shift();
        IS.bus.emit('metrics-sample');
      }

      // 障害中のパラメータドレイン（ゲーム内1分ごとにまとめて適用）
      const sev = this.impact();
      if (sev !== 'ok' && !IS.state.over) {
        this._drainAccum += gmDelta;
        if (this._drainAccum >= 1) {
          const mins = Math.floor(this._drainAccum);
          this._drainAccum -= mins;
          const mult = sev === 'crit' ? 1.6 : 1;
          IS.state.addParams({ health: -0.5 * mins * mult, userTrust: -0.2 * mins * mult });
          IS.state.counters.impactMins = (IS.state.counters.impactMins || 0) + mins;
        }
      }
      IS.bus.emit('metrics', this.now);
    },

    /* 表示用フォーマッタ */
    fmtLat(ms) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; },
  };

  let lastGm = null;
  IS.bus.on('tick', ({ dt, gm }) => {
    if (lastGm === null) lastGm = gm;
    const gmDelta = gm - lastGm;
    lastGm = gm;
    if (!IS.state.over) IS.metrics.tick(dt, gmDelta);
  });

  /* ---------------- シナリオイベントスケジューラ ---------------- */
  const events = [];
  IS.engine = {
    /* at: ゲーム内時刻(分)。when: 条件関数。両方指定時はAND */
    add({ id, at, when, fire }) {
      events.push({ id, at, when, fire, done: false });
    },
    at(atGm, id, fire) { this.add({ id, at: atGm, fire }); },
    when(pred, id, fire) { this.add({ id, when: pred, fire }); },
    /* セーブ/ロード用: 発火済みイベントIDの取得と復元 */
    doneIds() { return events.filter((e) => e.done).map((e) => e.id); },
    markDone(ids) {
      const set = new Set(ids || []);
      for (const ev of events) if (set.has(ev.id)) ev.done = true;
    },
  };

  IS.bus.on('tick', ({ gm }) => {
    if (IS.state.over || !IS.state.started) return;
    for (const ev of events) {
      if (ev.done) continue;
      if (ev.at !== undefined && gm < ev.at) continue;
      if (ev.when && !ev.when(IS.state, gm)) continue;
      ev.done = true;
      try { ev.fire(IS.state, gm); } catch (e) { console.error('event', ev.id, e); }
    }
  });
})();
