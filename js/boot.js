/* ============================================================
   INCIDENT: 02:17 REAL ― 起動処理
   （新規開始 / セーブからの再開 / 共有レポートの閲覧）
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;

  /* ---- 共有レポートのリンクで開かれた場合はレポートだけ表示 ---- */
  if (location.hash.startsWith('#report=')) {
    IS.report.renderShared(location.hash.slice('#report='.length));
    return;
  }

  function applyOptions() {
    const sound = IS.$('#opt-sound').checked;
    const fs = IS.$('#opt-fullscreen').checked;
    IS.sound.setEnabled(sound);
    IS.$('#mb-sound').textContent = sound ? '🔊' : '🔇';
    if (fs) document.documentElement.requestFullscreen().catch(() => {});
  }

  function enterDesktop() {
    IS.$('#screen-title').classList.add('hidden');
    IS.$('#desktop').classList.remove('hidden');
  }

  const btn = IS.$('#btn-start');
  btn.onclick = () => {
    applyOptions();
    IS.save.clear(); // 新規開始時は古いセーブを破棄
    enterDesktop();
    IS.scenario.start();
  };

  /* ---- セーブがあれば「続きから再開」を出す ---- */
  const saved = IS.save.load();
  if (saved) {
    const area = IS.$('#resume-area');
    const resume = IS.el('button', 'btn-resume');
    const gm = IS.clock.fmt(saved.clock.gm);
    const when = new Date(saved.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    resume.innerHTML = `▶ 続きから再開する <span class="btn-resume-meta">ゲーム内 ${gm} ／ 保存: ${when}</span>`;
    resume.onclick = () => {
      applyOptions();
      enterDesktop();
      if (!IS.save.resume()) {
        // 壊れたセーブは新規開始へフォールバック
        IS.save.clear();
        IS.scenario.start();
      }
    };
    area.appendChild(resume);
  }

  /* デバッグ: ?autostart=1 で即開始（動作確認用） */
  const qs = new URLSearchParams(location.search);
  if (qs.get('autostart') === '1') {
    IS.$('#opt-fullscreen').checked = false;
    IS.$('#opt-sound').checked = qs.get('sound') === '1';
    btn.click();
  }
})();
