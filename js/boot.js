/* ============================================================
   INCIDENT: 02:17 REAL ― 起動処理
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;

  const btn = IS.$('#btn-start');
  btn.onclick = () => {
    const sound = IS.$('#opt-sound').checked;
    const fs = IS.$('#opt-fullscreen').checked;
    IS.sound.setEnabled(sound);
    IS.$('#mb-sound').textContent = sound ? '🔊' : '🔇';
    if (fs) document.documentElement.requestFullscreen().catch(() => {});

    IS.$('#screen-title').classList.add('hidden');
    IS.$('#desktop').classList.remove('hidden');
    IS.scenario.start();
  };

  /* デバッグ: ?autostart=1 で即開始（動作確認用） */
  const qs = new URLSearchParams(location.search);
  if (qs.get('autostart') === '1') {
    IS.$('#opt-fullscreen').checked = false;
    IS.$('#opt-sound').checked = qs.get('sound') === '1';
    btn.click();
  }
})();
