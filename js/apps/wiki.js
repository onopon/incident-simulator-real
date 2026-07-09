/* ============================================================
   INCIDENT: 02:17 REAL ― 社内Wikiアプリ
   読む者だけが救われる手順書と過去の障害レポート
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;

  let mainEl = null;
  let page = 'arch';

  const PAGES = [
    { id: 'arch', title: 'Atlas システム構成' },
    { id: 'runbook', title: 'インシデント対応手順書' },
    { id: 'incidents', title: '過去の障害レポート' },
    { id: 'contacts', title: '連絡先・オンコール' },
  ];

  const CONTENT = {
    arch: `
      <h2>Atlas システム構成</h2>
      <div class="wiki-meta">最終更新: 3年前 ・ 作成者: （退職済み）</div>
      <p>Atlasは15年運用されている検索・予約サービス。月間アクセス数は数百万。</p>
      <pre>ユーザー
  │ https
  ▼
[ALB] ──→ [www-production-01/02]  … フロント (PHP)
                │  内部API呼び出し（タイムアウト時 3回まで自動リトライ）
                ▼
        [api-production-01〜06]   … API (PHP) ※Auto Scaling
                │
                ▼
        [atlas-mysql-prd]         … MySQL 8.0 (max_connections=500)</pre>
      <h3>既知の注意点</h3>
      <ul>
        <li><code>ShopSearchController.php</code> は3,842行。<b>テストカバレッジ40%</b>。壊れたら困る古い機能ほどテストがない。</li>
        <li>apiサーバーは各台がDBコネクションプールを持つ。<b>台数を増やすとDB接続数も増える</b>。</li>
        <li>古い処理の一部はCloudWatchにログを送っておらず、<b>EC2のローカルファイルにのみ書いている</b>（/var/log/atlas/）。</li>
        <li>wwwはAPIタイムアウト時に<b>自動で3回リトライ</b>する。APIが遅いときにリクエストを増幅させる面がある。</li>
      </ul>`,
    runbook: `
      <h2>インシデント対応手順書</h2>
      <div class="wiki-meta">最終更新: 8ヶ月前 ・ 作成者: SRE勉強会</div>
      <div class="wiki-callout">💡 <span>この手順書は「完璧にやる」ためではなく「パニックのときに次の一手を思い出す」ためにある。</span></div>
      <h3>1. 覚知したら（最初の5分）</h3>
      <ol>
        <li>事象を確認する（ダッシュボード・実際のユーザー画面）。<b>推測より観測</b>。</li>
        <li><b>インシデントチャンネルを作成</b>し、情報を1箇所へ集約する。</li>
        <li>第一報を出す。<b>「分かっていること」と「推測」を分ける</b>。根拠のない復旧見込みは言わない。</li>
      </ol>
      <h3>2. 応急対応</h3>
      <ul>
        <li>まず<b>ボトルネックがどこか</b>（CPU / DB / ディスク / 外部）を見極めてから手を打つ。</li>
        <li>負荷が原因なら「流入を止める」が最速（WAF・機能停止・縮退）。ただし<b>何を止めるかの確証</b>を先に取る。</li>
        <li>DBがボトルネックのときにAPPサーバーを増やすと<b>悪化する</b>ことがある（接続数）。</li>
      </ul>
      <h3>3. 経過共有</h3>
      <ul>
        <li>15〜20分おきに状況を共有する。情報の空白は不信で埋まる。</li>
        <li>CS・営業には「ユーザーへ何と案内できるか」を渡す。</li>
      </ul>
      <h3>4. 復旧判断</h3>
      <ul>
        <li>「直ったように見える時間」と「復旧を宣言できる時間」は違う。<b>安定稼働を確認（目安30分）してから宣言</b>する。</li>
        <li>再起動は<b>1台ずつ切り離して</b>行う。全台一斉はサービス全停止になる。</li>
      </ul>
      <h3>5. 収束後</h3>
      <ul>
        <li>振り返りでは「誰が悪いか」ではなく<b>「なぜその構造で壊れたか」</b>を扱う。</li>
        <li>改善タスクを決め、<b>次のスプリントに実際に入れる</b>。</li>
      </ul>`,
    incidents: `
      <h2>過去の障害レポート</h2>
      <div class="wiki-meta">直近3年分</div>
      <h3>📄 2025-11: 再試行の嵐</h3>
      <p>APIの軽微な遅延をwwwの自動リトライ（3回）が増幅し、雪だるま式に負荷が拡大。<b>リトライ回数を一時的に1回へ下げる設定変更</b>（deployジョブ: <code>retry-tune</code>）で沈静化した。</p>
      <h3>📄 2024-08: EC2にしかない真実</h3>
      <p>CloudWatchに出ないログが原因調査を遅らせた。古い処理は<b>EC2ローカル（/var/log/atlas/）にのみログを書く</b>。ディスク系のアラートが出たら、まずsshで入って<code>df -h</code>と<code>tail</code>。肥大化時の応急処置は<code>sudo logrotate-atlas</code>。</p>
      <h3>📄 2023-06: 深夜バッチのロック競合</h3>
      <p>本番中のALTER TABLE（DDL）がメタデータロックと衝突し、全クエリが待機状態に。<b>本番DDLは実行計画と実行中クエリを確認してから</b>。オンラインDDLでも安全とは限らない。</p>
      <div class="wiki-callout">🔥 <span>共通の教訓: 障害は突然生まれない。何年も前からコードの中で静かに待っている。</span></div>`,
    contacts: `
      <h2>連絡先・オンコール</h2>
      <div class="wiki-meta">今週のオンコール: <b>あなた</b></div>
      <table class="wiki-table">
        <tr><th>名前</th><th>役割</th><th>頼れること</th></tr>
        <tr><td>高瀬 美咲</td><td>ディレクター</td><td>ユーザーからの問い合わせ内容の確認・ユーザーへの連絡</td></tr>
        <tr><td>伊藤 健</td><td>エンジニア（先輩）</td><td>検索まわりのコードに詳しい。レビュー・技術相談</td></tr>
        <tr><td>森 さやか</td><td>カスタマーサポート</td><td>問い合わせ状況の集計・ユーザー案内文の展開</td></tr>
        <tr><td>木下 陸</td><td>営業</td><td>大口顧客への説明。復旧見込みを何より求めている</td></tr>
        <tr><td>大林 修</td><td>マネージャー</td><td>経営層への報告。判断の後ろ盾</td></tr>
      </table>
      <p>Slackの <b>@ボタン</b> から各メンバーへメンションして状況を確認できます。</p>`,
  };

  function render() {
    if (!mainEl) return;
    mainEl.innerHTML = CONTENT[page];
    IS.$$('.wiki-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    const st = IS.state;
    if (page === 'runbook') st.mark('runbookRead', 'インシデント対応手順書を確認');
    if (page === 'incidents') {
      st.mark('pastIncidentsRead', '過去の障害レポートを確認（教訓を参照）');
      st.flag('knowRetry');
      st.flag('knowLocalLogs');
      IS.bus.emit('chips-changed');
    }
    if (page === 'arch') st.mark('archRead', 'システム構成資料を確認');
  }

  IS.wm.register('wiki', {
    title: '社内Wiki — Atlas運用',
    icon: '📖',
    mount(body) {
      body.innerHTML = '';
      const app = el('div', 'wiki-app');
      const side = el('div', 'wiki-side');
      side.appendChild(el('div', 'wiki-side-title', 'ATLAS 運用ドキュメント'));
      for (const p of PAGES) {
        const b = el('button', 'wiki-item', esc(p.title));
        b.dataset.page = p.id;
        b.onclick = () => { page = p.id; render(); };
        side.appendChild(b);
      }
      mainEl = el('div', 'wiki-main');
      app.append(side, mainEl);
      body.appendChild(app);
      render();
    },
  });
})();
