/* ============================================================
   INCIDENT: 02:17 REAL ― 効果音（WebAudioで合成・外部アセットなし）
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;

  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 880, dur = 0.12, type = 'sine', gain = 0.06, when = 0, slide = 0 }) {
    if (!enabled) return;
    try {
      const a = ac();
      const t0 = a.currentTime + when;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (e) { /* no-op */ }
  }

  IS.sound = {
    setEnabled(v) { enabled = v; if (v) ac(); },
    get enabled() { return enabled; },

    /* Slack風ノック音 */
    knock() {
      tone({ freq: 740, dur: 0.09, type: 'sine', gain: 0.055 });
      tone({ freq: 990, dur: 0.14, type: 'sine', gain: 0.05, when: 0.09 });
    },
    /* 重大アラート */
    alarm() {
      tone({ freq: 620, dur: 0.16, type: 'square', gain: 0.045 });
      tone({ freq: 470, dur: 0.2, type: 'square', gain: 0.045, when: 0.18 });
      tone({ freq: 620, dur: 0.16, type: 'square', gain: 0.04, when: 0.4 });
    },
    /* 軽い警告 */
    warn() {
      tone({ freq: 520, dur: 0.14, type: 'triangle', gain: 0.05 });
      tone({ freq: 420, dur: 0.16, type: 'triangle', gain: 0.045, when: 0.13 });
    },
    /* 操作成功 */
    ok() {
      tone({ freq: 660, dur: 0.09, type: 'sine', gain: 0.05 });
      tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.05, when: 0.08 });
      tone({ freq: 1180, dur: 0.16, type: 'sine', gain: 0.045, when: 0.16 });
    },
    /* 障害悪化・失敗 */
    bad() {
      tone({ freq: 220, dur: 0.3, type: 'sawtooth', gain: 0.05, slide: -120 });
    },
    /* 全面停止 */
    down() {
      tone({ freq: 300, dur: 0.5, type: 'sawtooth', gain: 0.06, slide: -220 });
      tone({ freq: 180, dur: 0.7, type: 'square', gain: 0.045, when: 0.35, slide: -120 });
    },
    /* キー入力（ターミナル） */
    key() {
      tone({ freq: 1400 + Math.random() * 500, dur: 0.02, type: 'square', gain: 0.008 });
    },
  };
})();
