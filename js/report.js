/* ============================================================
   INCIDENT: 02:17 REAL ― 振り返りミーティング＆評価レポート
   5カテゴリ × 項目別に、プレイヤーの判断を評価する
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;
  const T = (h, m) => h * 60 + m;
  const INCIDENT_GM = T(9, 52);

  const st = () => IS.state;

  /* ============================================================
     振り返りミーティング（Q1: 原因説明 → Q2: 改善タスク3件）
     ============================================================ */
  const TASK_OPTIONS = [
    { id: 'db', label: '複合インデックス追加＋カーソル方式ページネーションへの移行', desc: '今回の直接原因を恒久的に潰す', value: 1 },
    { id: 'test', label: '検索機能へのテスト追加', desc: '壊れたら困る場所から順に安全網を張る（現在カバレッジ40%）', value: 1 },
    { id: 'obs', label: 'ログのCloudWatch統一＋ディスク容量監視の追加', desc: '次の障害で「EC2にしかない真実」を探さずに済むように', value: 1 },
    { id: 'team', label: 'インシデント対応手順書の更新＋役割分担＋訓練', desc: '自分だけが判断する状態をやめる', value: 1 },
    { id: 'waf', label: 'WAFレート制限とrobots.txtの標準化', desc: 'クローラー対策を場当たりから仕組みへ', value: 1 },
    { id: 'refactor', label: 'ファットControllerの分割とService層への移動', desc: '3,842行・611行メソッドの解体。大仕事', value: 1 },
    { id: 'biz', label: '営業要望の新キャンペーン機能を優先する', desc: '事業は待ってくれない。負債返済は、また今度', value: 0 },
    { id: 'quiet', label: '監視アラートの整理（通知の削減）', desc: 'ノイズを減らす。……本物のシグナルごと減らさなければ、だが', value: 0 },
  ];

  function startMeeting() {
    IS.clock.stop();
    const screen = IS.$('#screen-meeting');
    screen.classList.remove('hidden');
    screen.innerHTML = '';
    const inner = el('div', 'meeting-inner');
    screen.appendChild(inner);

    inner.appendChild(el('p', 'meeting-kicker', 'POSTMORTEM ― 14:00 会議室B'));
    inner.appendChild(el('h1', 'meeting-title', '障害振り返りミーティング'));
    inner.appendChild(el('p', 'meeting-lead',
      '参加者: あなた、高瀬（ディレクター）、森（CS）、木下（営業）、大林（マネージャー）、伊藤（エンジニア）。\nスクリーンには今日の時系列が映し出されている。大林さんが口を開いた。\n\n「それで——今回の原因は、何だったんですか？」'));

    /* Q1: 原因の説明 */
    inner.appendChild(el('div', 'meeting-q', 'Q1. あなたはどう説明する？'));
    const q1 = el('div', 'opt-list');
    const opt1 = el('button', 'opt-item');
    opt1.innerHTML = `<span class="opt-label">「クローラーによる大量アクセスです。WAFで制限済みなので、同種のアクセスは今後防げます」</span>
      <span class="opt-desc">簡潔で、分かりやすい。「外部要因」という結論は誰も傷つけない。そして、何も変えない。</span>`;
    const opt2 = el('button', 'opt-item');
    opt2.innerHTML = `<span class="opt-label">「きっかけはクローラーです。ただ、クローラーが来ただけで全体が落ちる構造だったことが本当の問題です」</span>
      <span class="opt-desc">インデックス不足、深いOFFSET、再試行の嵐、放置された警告ログ、テストのない巨大Controller——構造を説明する。</span>`;
    q1.append(opt1, opt2);
    inner.appendChild(q1);

    const step2 = el('div');
    step2.style.display = 'none';
    inner.appendChild(step2);

    const answered = (kind) => {
      opt1.disabled = opt2.disabled = true;
      (kind === 'structural' ? opt2 : opt1).classList.add('checked');
      if (kind === 'structural') {
        st().mark('rcaStructural', '振り返りで構造的な原因を説明した');
        st().addParams({ orgTrust: 6 });
      } else {
        st().mark('rcaExternal', '振り返りで原因を「外部要因」として説明した');
      }
      renderStep2();
    };
    opt1.onclick = () => answered('external');
    opt2.onclick = () => answered('structural');

    function renderStep2() {
      step2.style.display = '';
      step2.appendChild(el('p', 'meeting-lead',
        st().marked('rcaStructural')
          ? '会議室が静かになった。誰か一人のミスではない。障害は突然起きたように見えて、何年もかけて準備されていた。\n\n大林さん「……分かった。改善の時間を、ちゃんと計画に入れよう」'
          : '「なるほど、外部要因か。じゃあ仕方ないね」——会議は円滑に終わりそうだ。円滑に、何も変わらずに。'));
      step2.appendChild(el('div', 'meeting-q', 'Q2. 振り返りから23件の改善タスクが出た。次のスプリントに入れられるのは3件だけ。どれを選ぶ？'));
      const count = el('div', 'meeting-count', '選択中: 0 / 3');
      step2.appendChild(count);
      const list = el('div', 'opt-list');
      const picked = new Set();
      const btns = [];
      for (const t of TASK_OPTIONS) {
        const b = el('button', 'opt-item');
        b.innerHTML = `<span class="opt-label">${esc(t.label)}</span><span class="opt-desc">${esc(t.desc)}</span>`;
        b.onclick = () => {
          if (picked.has(t.id)) { picked.delete(t.id); b.classList.remove('checked'); }
          else if (picked.size < 3) { picked.add(t.id); b.classList.add('checked'); }
          count.textContent = `選択中: ${picked.size} / 3`;
          confirm.disabled = picked.size !== 3;
        };
        btns.push(b);
        list.appendChild(b);
      }
      step2.appendChild(list);
      const confirm = el('button', 'btn primary', 'この3件でスプリントを計画し、シフトを終える');
      confirm.disabled = true;
      confirm.style.cssText = 'margin-top:16px;padding:12px 30px;font-size:14px;';
      confirm.onclick = () => {
        st().mark('tasksPicked', `改善タスクを選定: ${[...picked].join(', ')}`, [...picked]);
        screen.classList.add('hidden');
        finish('shift-end');
      };
      step2.appendChild(confirm);
      step2.scrollIntoView({ behavior: 'smooth' });
    }
  }

  /* ============================================================
     評価ロジック
     ============================================================ */
  const V = { good: 1, ok: 0.55, bad: 0.1, none: 0 };
  const MARKS = { good: '◎', ok: '○', bad: '✕', none: '－' };

  function item(label, verdict, comment, gm) {
    return { label, verdict, comment, gm };
  }
  const fmtGm = (gm) => (gm ? IS.clock.fmt(gm) : '');

  function evaluate(reason) {
    const s = st();
    const f = s.flags;
    const j = (tag) => s.marked(tag);
    const cats = [];

    /* ---------- 1. 初動対応 ---------- */
    {
      const items = [];
      const ack = j('ack');
      if (ack && ack.gm <= T(9, 50)) items.push(item('最初の問い合わせへの反応', 'good', `高瀬さんの相談に${fmtGm(ack.gm)}に反応した。曖昧な問い合わせを放置しなかった。`, ack.gm));
      else if (ack) items.push(item('最初の問い合わせへの反応', 'ok', `反応はしたが${fmtGm(ack.gm)}と遅め。「毎回ではない」系の報告は初動が肝心。`, ack.gm));
      else items.push(item('最初の問い合わせへの反応', 'bad', '高瀬さんの相談に反応しないまま障害に突入した。'));

      const obs = ['sawDashboard', 'siteChecked', 'sawAlarms', 'processlist'].map(j).filter(Boolean).sort((a, b) => a.gm - b.gm)[0];
      if (obs && obs.gm <= INCIDENT_GM + 10) items.push(item('事象の一次確認（推測より観測）', 'good', `障害発生から${Math.round(obs.gm - INCIDENT_GM)}分以内にダッシュボード・実画面・DBを自分の目で確認した。`, obs.gm));
      else if (obs) items.push(item('事象の一次確認（推測より観測）', 'ok', '事象の確認はしたが、着手までに時間がかかった。', obs.gm));
      else items.push(item('事象の一次確認（推測より観測）', 'bad', 'メトリクスも実画面も確認せず対応を進めた。'));

      const ch = j('channelCreated');
      if (ch && ch.gm <= INCIDENT_GM + 12) items.push(item('情報集約の場づくり', 'good', `${fmtGm(ch.gm)}にインシデントチャンネルを作成。情報の散逸と憶測を防いだ。`, ch.gm));
      else if (ch) items.push(item('情報集約の場づくり', 'ok', `チャンネル作成が${fmtGm(ch.gm)}と遅れ、その間は憶測が飛び交った。`, ch.gm));
      else items.push(item('情報集約の場づくり', 'bad', 'インシデントチャンネルを作らず、情報が最後まで散らばったままだった。'));

      const fr = j('firstReport');
      if (j('firstReportFact')) items.push(item('第一報の質', 'good', '事実と推測を分けた第一報。断定しない誠実さが信頼を作った。', fr && fr.gm));
      else if (j('promisedQuick')) items.push(item('第一報の質', 'bad', '「すぐ直します」——根拠のない約束は、後で自分の首を絞めた。', fr && fr.gm));
      else if (fr) items.push(item('第一報の質', 'ok', '第一報は出したが、内容の整理には改善の余地がある。', fr.gm));
      else items.push(item('第一報の質', 'bad', '第一報を出さなかった。情報の空白は不信で埋まっていく。'));
      cats.push({ id: 'shodo', icon: '⚡', name: '初動対応', items });
    }

    /* ---------- 2. 調査・原因特定 ---------- */
    {
      const items = [];
      const pl = j('processlist');
      if (pl) items.push(item('ボトルネックの直接観測', 'good', 'SHOW PROCESSLISTで「DBで何が詰まっているか」を直接確認した。', pl.gm));
      else items.push(item('ボトルネックの直接観測', 'bad', 'DBの実行状況を一度も直接確認しなかった。当てずっぽうの対処は事故のもと。'));

      const kc = j('knowCrawler');
      if (kc) items.push(item('負荷源（クローラー）の特定', 'good', 'アクセスログのUser-Agent分析でMegaBot/2.4を特定。的を絞った対処を可能にした。', kc.gm));
      else if (j('wafBlind')) items.push(item('負荷源（クローラー）の特定', 'bad', '発信元を特定しないままWAFを撃った。当たっても綺麗には当たらない。'));
      else items.push(item('負荷源（クローラー）の特定', 'bad', '大量アクセスの正体を最後まで特定できなかった。'));

      const struct = j('explain') || j('knowDeepPages');
      if (struct) items.push(item('構造的な原因の理解', 'good', 'EXPLAINやpage分布の分析で「インデックス不足×深いOFFSET」という構造を掴んだ。', struct.gm));
      else items.push(item('構造的な原因の理解', 'bad', 'なぜクローラー程度で落ちたのか、構造まで踏み込まなかった。同じ障害はまた起きる。'));

      const ls = j('sawLogSpam');
      const sd = j('sawDisk');
      if (ls) items.push(item('ディスク肥大の根本調査', 'good', 'SSHで入り、CloudWatchに出ない警告ログの洪水を発見した。「EC2にしかない真実」に辿り着いた。', ls.gm));
      else if (sd) items.push(item('ディスク肥大の根本調査', 'ok', 'df -hで逼迫は確認したが、何がディスクを食っているかまでは掘らなかった。', sd.gm));
      else if (j('workersRecovered') || f.stuckWorkers) items.push(item('ディスク肥大の根本調査', 'bad', 'api-03のディスク警報の中身を調べなかった。'));
      else items.push(item('ディスク肥大の根本調査', 'none', '（この事象には到達しなかった）'));

      if (j('bug2Reported')) {
        const ft = j('foundTemplate');
        if (ft) items.push(item('表示不具合の真因特定', 'good', 'API→wwwの切り分けを経て、テンプレートのarray_merge混入という真因に到達した。', ft.gm));
        else if (j('apiChecked')) items.push(item('表示不具合の真因特定', 'ok', 'APIは正しいという切り分けまで進んだが、真因には届かなかった。', j('apiChecked').gm));
        else if (j('bug2Deferred')) items.push(item('表示不具合の真因特定', 'bad', '「障害の余波」として片付けた。不具合は今もユーザーの画面に出ている。'));
        else items.push(item('表示不具合の真因特定', 'bad', '再発報告を受けたが、調査に着手しなかった。'));
      } else {
        items.push(item('表示不具合の真因特定', 'none', '（表示不具合の再調査には到達しなかった）'));
      }
      cats.push({ id: 'chousa', icon: '🔍', name: '調査・原因特定', items });
    }

    /* ---------- 3. コミュニケーション ---------- */
    {
      const items = [];
      const c = s.counters;
      const ratio = c.asksReceived ? c.asksAnswered / c.asksReceived : 1;
      if (ratio >= 0.7) items.push(item('問いかけへの応答', 'good', `関係者からの${c.asksReceived}件の問いかけのうち${c.asksAnswered}件に応答した。`));
      else if (ratio >= 0.4) items.push(item('問いかけへの応答', 'ok', `応答率${Math.round(ratio * 100)}%。返事のない相手は、各自の判断で動き始める。`));
      else items.push(item('問いかけへの応答', 'bad', `${c.asksReceived}件の問いかけにほとんど応答しなかった（${c.asksAnswered}件）。`));

      if (c.updates >= 3) items.push(item('経過共有の頻度', 'good', `${c.updates}回の経過共有。「今どうなっているか」を絶やさなかった。`));
      else if (c.updates >= 1) items.push(item('経過共有の頻度', 'ok', `経過共有は${c.updates}回。障害対応中は15〜20分おきが目安。`));
      else items.push(item('経過共有の頻度', 'bad', '経過を一度も共有しなかった。情報の空白は不信で埋まる。'));

      if (!j('promisedQuick') && !j('promisedEta')) items.push(item('約束の管理', 'good', '根拠のない復旧時刻・安請け合いをしなかった。'));
      else if (j('promiseFallout') || j('etaFallout')) items.push(item('約束の管理', 'bad', '根拠のない約束が期限切れになり、信頼を削った。営業は顧客に謝罪する羽目になった。'));
      else items.push(item('約束の管理', 'ok', '根拠の薄い約束をしたが、期限前に収束したため事なきを得た。'));

      if (j('csGuided') || j('userNotice')) items.push(item('ユーザー向け対応の支援', 'good', 'CS・ディレクターへ案内文やユーザー告知を提供し、ユーザーへの情報流通を作った。'));
      else if (j('askedImpact')) items.push(item('ユーザー向け対応の支援', 'ok', '影響ヒアリングはしたが、CSは案内文がないまま「調査中です」を繰り返した。'));
      else items.push(item('ユーザー向け対応の支援', 'bad', 'ユーザーへの案内をCS任せにした。'));

      const asked = (c.mentionsSent || 0);
      if (asked >= 2) items.push(item('周囲を頼る力', 'good', `${asked}回のメンションで状況・知見を集めた。一人で抱え込まなかった。`));
      else if (asked === 1) items.push(item('周囲を頼る力', 'ok', 'メンションでの確認は1回。チームはもっと使っていい。'));
      else items.push(item('周囲を頼る力', 'bad', '誰にも状況を聞かなかった。伊藤さんは検索コードの生き字引なのに。'));
      cats.push({ id: 'comm', icon: '💬', name: 'コミュニケーション', items });
    }

    /* ---------- 4. 復旧・技術判断 ---------- */
    {
      const items = [];
      if (j('wafTargeted') && !j('itoDidIt')) items.push(item('流入制御の的確さ', 'good', '特定済みのクローラーだけをレート制限。ユーザー影響なしで負荷源を断った。', j('wafTargeted').gm));
      else if (j('itoDidIt')) items.push(item('流入制御の的確さ', 'bad', '流入を止める判断が遅れ、伊藤さんが代わりにWAFを設定した。判断の空白は誰かが埋める。', j('itoDidIt').gm));
      else if (j('maintenanceOn') || j('degradedOn')) items.push(item('流入制御の的確さ', 'ok', '機能停止/縮退で負荷は断てたが、事業影響という代償を払った。特定→的を絞った制限ならより小さく済んだ。'));
      else if (j('wafBlind')) items.push(item('流入制御の的確さ', 'bad', '確証のない広域ブロック。負荷は下がりきらず、正規Botまで巻き込んだ。', j('wafBlind').gm));
      else items.push(item('流入制御の的確さ', 'bad', '流入制御を行わなかった。'));

      if (j('scaledOut')) items.push(item('ボトルネックの見極め', 'bad', 'DBがボトルネックの状況でEC2を増やし、接続数の枯渇を悪化させた。', j('scaledOut').gm));
      else items.push(item('ボトルネックの見極め', 'good', '「とりあえずサーバー増設」に走らず、ボトルネック（DB）に沿った手を選んだ。'));

      if (j('workersRecovered') && !j('rebootAll')) items.push(item('サーバー復旧の進め方', 'good', '1台ずつ切り離して再起動。地味で神経を使う、正しい手順。', j('workersRecovered').gm));
      else if (j('rebootAll')) items.push(item('サーバー復旧の進め方', 'bad', '全台一斉再起動で数分間の全面停止を招いた。速さと引き換えにユーザーの目に触れた。', j('rebootAll').gm));
      else if (f.stuckWorkers) items.push(item('サーバー復旧の進め方', 'bad', '応答不能のサーバーを復旧しないままシフトが終わった。'));
      else items.push(item('サーバー復旧の進め方', 'none', '（サーバー復旧の判断には到達しなかった）'));

      if (j('pagecap')) items.push(item('構造への手当て', 'good', 'ページ上限＋ソート簡素化をテスト付きでデプロイ。「同じ構造なら同じ障害」を断ち切った。', j('pagecap').gm));
      else if (j('alterOk')) items.push(item('構造への手当て', 'good', 'インデックス追加で検索クエリを構造から軽くした。', j('alterOk').gm));
      else if (f.searchDegraded || f.searchMaintenance) items.push(item('構造への手当て', 'ok', '縮退/停止で凌いだが、恒久対策は次の誰かに残された。'));
      else items.push(item('構造への手当て', 'bad', j('relapse') ? '構造対策のないまま宣言し、別のクローラーで再発した。' : '構造的な対策を打たなかった。再発条件はそのまま残っている。'));

      if (j('rdsReboot')) items.push(item('リスクの大きい操作の管理', 'bad', 'プライマリDBの再起動という賭けに出た。接続問題は再起動では解決しない。', j('rdsReboot').gm));
      else if (j('alterFail')) items.push(item('リスクの大きい操作の管理', 'bad', '本番DDLがロックと衝突し検索を全停止させた。過去の障害レポートに前例があった。', j('alterFail').gm));
      else if (j('alterOk') && j('explain')) items.push(item('リスクの大きい操作の管理', 'good', '本番DDLの前にEXPLAINで実行計画を確認。準備された賭けだった。'));
      else if (j('alterOk')) items.push(item('リスクの大きい操作の管理', 'ok', '本番DDLは成功したが、実行計画を確認しない一発勝負だった。結果オーライは実力ではない。'));
      else items.push(item('リスクの大きい操作の管理', 'good', '本番環境での無謀な賭け（いきなりDDL・DB再起動）を避けた。'));
      cats.push({ id: 'fukkyuu', icon: '🔧', name: '復旧・技術判断', items });
    }

    /* ---------- 5. 収束・再発防止 ---------- */
    {
      const items = [];
      const dec = j('declared');
      if (dec && f.declaredKind === 'observed' && j('fullyClosed')) items.push(item('復旧宣言の質', 'good', '数値の根拠→経過観察→完全復旧宣言。「直ったように見える時間」と「宣言できる時間」を区別した。', dec.gm));
      else if (dec && f.declaredKind === 'observed') items.push(item('復旧宣言の質', 'ok', '経過観察は置いたが、完全復旧の確認まで至らずシフトが終わった。', dec.gm));
      else if (dec) items.push(item('復旧宣言の質', 'bad', '「直りました！」——監視グラフの続きを、誰も見ていない。', dec.gm));
      else items.push(item('復旧宣言の質', reason === 'dead' ? 'none' : 'bad', reason === 'dead' ? '（復旧に至らなかった）' : '復旧宣言に至らないままシフトが終わった。'));

      if (dec && !j('relapse')) items.push(item('再発の抑止', 'good', '宣言後の再発なし。収束のさせ方が正しかった証拠。'));
      else if (j('relapse')) items.push(item('再発の抑止', 'bad', '別のクローラーによる再発を許した。インターネットはこちらの都合を待ってくれない。', j('relapse').gm));
      else items.push(item('再発の抑止', 'none', '（収束前にシフトが終了した）'));

      if (j('templateFixed')) items.push(item('残存不具合への対応', 'good', '負荷障害の裏に隠れていた表示不具合まで修正・テスト追加して収束させた。', j('templateFixed').gm));
      else if (j('bug2Deferred')) items.push(item('残存不具合への対応', 'bad', '「様子見」の名の下に、間違った画面がユーザーに出続けている。'));
      else if (j('bug2Reported')) items.push(item('残存不具合への対応', 'ok', '調査は始めたが修正まで届かなかった。チケット化して引き継ごう。'));
      else items.push(item('残存不具合への対応', 'none', '（表示不具合の再報告には到達しなかった）'));

      if (j('rcaStructural')) items.push(item('振り返りでの原因説明', 'good', '「外部要因」で片付けず、構造の問題として説明した。改善の予算はこうして生まれる。'));
      else if (j('rcaExternal')) items.push(item('振り返りでの原因説明', 'ok', '「クローラーのせい」——誰も傷つけない結論は、何も変えない結論でもある。'));
      else items.push(item('振り返りでの原因説明', 'none', '（振り返りに到達しなかった）'));

      const tasks = j('tasksPicked');
      if (tasks) {
        const goodPicks = (tasks.data || []).filter((id) => (TASK_OPTIONS.find((t) => t.id === id) || {}).value === 1).length;
        if (goodPicks >= 3) items.push(item('改善タスクの選定', 'good', `選んだ3件（${(tasks.data || []).join(', ')}）はすべて再発防止に直結する。負債は返し始めた時だけ減る。`));
        else if (goodPicks === 2) items.push(item('改善タスクの選定', 'ok', '3件中2件は再発防止に効く選定。残り1件の機会費用は次の障害が教えてくれる。'));
        else items.push(item('改善タスクの選定', 'bad', '再発防止につながる選定が少ない。バックログの底に沈んだタスクが浮かぶのは、次の障害のときだ。'));
      } else {
        items.push(item('改善タスクの選定', 'none', '（振り返りに到達しなかった）'));
      }

      if (j('runbookRead') || j('pastIncidentsRead')) items.push(item('ナレッジの活用', 'good', '手順書・過去の障害レポートを参照した。過去の教訓が今日の判断を助けた。'));
      else items.push(item('ナレッジの活用', 'none', '社内Wikiの手順書・過去事例は開かれなかった。先人の失敗は無料の教材なのに。'));
      cats.push({ id: 'saihatsu', icon: '🌱', name: '収束・再発防止', items });
    }

    /* ---- スコア計算 ---- */
    for (const c of cats) {
      const scored = c.items.filter((i) => i.verdict !== 'none');
      c.score = scored.length
        ? Math.round((scored.reduce((a, i) => a + V[i.verdict], 0) / scored.length) * 100)
        : 0;
      c.rank = rankOf(c.score);
    }
    let overall = Math.round(cats.reduce((a, c) => a + c.score, 0) / cats.length);
    /* 大きく崩れた観点があると総合は伸びない（片翼だけでは飛べない） */
    const weakCats = cats.filter((c) => c.score < 45).length;
    if (weakCats >= 2) overall = Math.min(overall, 57);
    else if (weakCats === 1) overall = Math.min(overall, 71);
    if (reason === 'dead') overall = Math.min(overall, 39);
    if (reason === 'timeout' && !st().has('declared')) overall = Math.min(overall, 49);
    return { cats, overall, rank: rankOf(overall) };
  }

  const rankOf = (sc) => (sc >= 85 ? 'S' : sc >= 72 ? 'A' : sc >= 58 ? 'B' : sc >= 42 ? 'C' : 'D');

  /* ---- エンディング文 ---- */
  function endingFor(reason, ev) {
    const f = st().flags;
    const j = (t) => st().marked(t);
    if (reason === 'dead') {
      return {
        title: '全面停止 ― 沈黙するAtlas',
        body: 'サービス健全性がゼロになった。Atlasは全面停止し、復旧は夜勤帯までもつれ込んだ。\n予約は失われ、問い合わせは溢れ、翌日の朝会は静かだった。\n\n障害対応において最悪なのは「間違った判断」ではない。状況を悪化させ続ける流れを、止められないことだ。',
      };
    }
    if (reason === 'timeout') {
      return st().has('declared')
        ? {
          title: 'シフト交代 ― 振り返りなき収束',
          body: '障害は収束したが、振り返りの前にシフトが終わった。\n対応の記憶は揮発する。ドキュメントにならなかった教訓は、次の障害でもう一度、高い授業料を払って学び直すことになる。',
        }
        : {
          title: 'シフト交代 ― 持ち越された夜',
          body: '実時間が尽きた。インシデントは夜のオンコール担当へ引き継がれた。\n引き継ぎ資料にはこう書くしかなかった。\n「原因調査中。対応方針未定。」\n\n決断しないこともまた一つの決断である。ただし、その代償は自分以外の誰かが払う。',
      };
    }
    /* 通常終了: プレイスタイルで分岐 */
    if (ev.rank === 'S') {
      return {
        title: '頼れる当直 ― 混乱を秩序に変える人',
        body: '観測し、集約し、的を絞って止め、根拠を添えて宣言し、構造まで直した。\n数週間後、あなたが不在の日に小さな障害が起きる。チームは手順に沿って対応し、朝には一件の報告が残っている。\n「手順に沿って対応し、復旧済みです。振り返りは本日実施します」\nサービスを守る仕組みが、あなたの手を離れ始めている。',
      };
    }
    if ((j('pagecap') || j('alterOk')) && j('rcaStructural') && ev.rank === 'A') {
      return {
        title: '構造に向き合う人',
        body: '障害を止めただけでなく、「なぜこの構造で壊れたか」まで組織に説明した。\n改善タスクはスプリントに載った。負債が消えたわけではない。だが、負債は返し始めた時だけ減る。\nインシデントは、恐怖から「管理できるリスク」に変わりつつある。',
      };
    }
    if (!j('pagecap') && !j('alterOk') && st().has('declared')) {
      return {
        title: '消防士 ― 火は消えた、火種は残った',
        body: 'あなたは目の前の火を消した。だが構造への手当ては次送りになった。\n数週間後、休暇中のあなたのスマートフォンにSlackの通知が届く。\n「本番が落ちています。見られますか？」\nサービスは守られた。だが、運用は何も変わらなかった。',
      };
    }
    if (ev.cats.find((c) => c.id === 'comm').score < 50) {
      return {
        title: '孤独な戦い ― 正しさは、伝わらなければ守れない',
        body: '手は動いていた。だが情報は流れなかった。\n現場は「調査中です」を繰り返し、営業は謝り、マネージャーは経営会議で口ごもった。\n技術で守れるのはサービスまで。信頼を守るのは、コミュニケーションだ。',
      };
    }
    return {
      title: 'シフト終了 ― 次のアラートまで',
      body: '障害は収束し、振り返りも終えた。完璧ではなかったが、サービスは今日も動いている。\n夕方、Slackに小さな通知が光る。\nSentry: New issue detected.\n発生1件。影響ユーザー1人。緊急度はまだ分からない。\nあなたは冷めたコーヒーを一口飲み、新しいログを開く。',
    };
  }

  /* ============================================================
     レポート描画
     ============================================================ */
  function finish(reason) {
    st().over = true;
    IS.clock.stop();
    IS.$('#screen-meeting').classList.add('hidden');
    const ev = evaluate(reason);
    const end = endingFor(reason, ev);
    const screen = IS.$('#screen-report');
    screen.classList.remove('hidden');
    screen.innerHTML = '';
    const inner = el('div', 'report-inner');
    screen.appendChild(inner);

    inner.appendChild(el('p', 'report-kicker', 'INCIDENT REPORT ― 2026-07-06'));
    inner.appendChild(el('h1', 'report-title', 'シフト評価レポート'));
    const playSec = Math.floor(IS.clock.realElapsed);
    const recov = st().flags.recoveredAtGm;
    inner.appendChild(el('p', 'report-sub',
      `プレイ時間 ${Math.floor(playSec / 60)}分${playSec % 60}秒 ／ ` +
      `障害収束: ${recov ? `${IS.clock.fmt(recov)}（発生から${Math.round(recov - INCIDENT_GM)}分）` : '未収束'}`));

    /* ヒーロー */
    const hero = el('div', 'report-hero');
    hero.appendChild(el('div', `report-rank rank-${ev.rank}`, ev.rank));
    const ht = el('div', 'report-hero-text');
    ht.appendChild(el('div', 'report-ending-title', esc(end.title)));
    ht.appendChild(el('div', 'report-ending-body', esc(end.body)));
    ht.appendChild(el('div', '', `<span style="color:var(--dim);font-size:12px">総合スコア <b style="color:#fff;font-family:var(--mono)">${ev.overall} / 100</b></span>`));
    hero.appendChild(ht);
    inner.appendChild(hero);

    /* 5カテゴリ */
    inner.appendChild(el('div', 'report-section-title', '📊 5つの観点からの評価'));
    const grid = el('div', 'report-grid');
    ev.cats.forEach((c, idx) => {
      const card = el('div', `cat-card${idx === ev.cats.length - 1 && ev.cats.length % 2 === 1 ? ' wide' : ''}`);
      const head = el('div', 'cat-head');
      head.appendChild(el('span', 'cat-icon', c.icon));
      head.appendChild(el('span', 'cat-name', esc(c.name)));
      head.appendChild(el('span', `cat-rank rk-${c.rank}`, `${c.rank}`));
      card.appendChild(head);
      const bar = el('div', 'cat-bar');
      const fill = el('div', 'cat-fill');
      fill.style.background = { S: '#6fd3ff', A: '#3ddc84', B: '#ffcf5c', C: '#f2925c', D: '#f25f5c' }[c.rank];
      fill.style.width = '0%';
      setTimeout(() => { fill.style.width = `${c.score}%`; }, 100);
      bar.appendChild(fill);
      card.appendChild(bar);
      const list = el('div', 'cat-items');
      for (const it of c.items) {
        const row = el('div', 'cat-item');
        row.appendChild(el('span', `ci-mark ${it.verdict}`, MARKS[it.verdict]));
        const b = el('div', 'ci-body');
        b.appendChild(el('div', 'ci-label', esc(it.label) + (it.gm ? ` <span class="ci-ts">(${IS.clock.fmt(it.gm)})</span>` : '')));
        b.appendChild(el('div', 'ci-comment', esc(it.comment)));
        row.appendChild(b);
        list.appendChild(row);
      }
      card.appendChild(list);
      grid.appendChild(card);
    });
    inner.appendChild(grid);

    /* タイムライン */
    inner.appendChild(el('div', 'report-section-title', '🕐 あなたの行動記録'));
    const tl = el('div', 'report-timeline');
    for (const e2 of st().journal) {
      const row = el('div', 'tl-row');
      row.appendChild(el('span', 'tl-time', IS.clock.fmt(e2.gm)));
      row.appendChild(el('span', 'tl-label', esc(e2.label)));
      tl.appendChild(row);
    }
    inner.appendChild(tl);

    /* 隠しパラメータの開示 */
    inner.appendChild(el('div', 'report-section-title', '🎛 シフト終了時の内部パラメータ（プレイ中は非公開）'));
    const pr = el('div', 'report-params');
    const P_DEFS = [
      ['health', 'サービス健全性', true], ['userTrust', 'ユーザー信頼度', true], ['orgTrust', '組織信頼度', true],
      ['bizImpact', '事業影響', false], ['debt', '技術的負債', false], ['fatigue', 'チーム疲労度', false],
    ];
    for (const [k, label, goodHigh] of P_DEFS) {
      const v = Math.round(st().params[k]);
      const good = goodHigh ? v : 100 - v;
      const box = el('div', 'rp-box');
      box.appendChild(el('div', 'rp-label', esc(label)));
      const val = el('div', 'rp-value', String(v));
      val.style.color = good >= 60 ? 'var(--green)' : good >= 35 ? 'var(--yellow)' : 'var(--red)';
      box.appendChild(val);
      pr.appendChild(box);
    }
    inner.appendChild(pr);

    inner.appendChild(el('div', 'report-last',
      'Webサービスは、コードだけで動いているわけではない。\nデータベース。インフラ。ログ。監視。仕様。ユーザー。事業。そして、サービスを運用する人々。\n\nインシデント対応とは、壊れたコードを直す作業ではない。\n不完全な情報の中で、何を守り、何を止め、何を後回しにするかを決断することだ。\n\n午前2時17分。Slackに、新しい通知が表示される。\nSentry: Error rate increased.\n\nあなたは、最初に何を確認する？'));

    const acts = el('div', 'report-actions');
    const again = el('button', 'btn primary', 'もう一度シフトに入る');
    again.style.cssText = 'padding:13px 40px;font-size:15px;';
    again.onclick = () => location.reload();
    acts.appendChild(again);
    inner.appendChild(acts);

    if (reason === 'dead') IS.sound.down();
    else IS.sound.ok();
  }

  IS.report = { finish, startMeeting };
})();
