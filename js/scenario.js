/* ============================================================
   INCIDENT: 02:17 REAL ― シナリオ「クローラーの千本ノック REAL」
   タイムライン / NPC / 運用オペレーション / メトリクスモデル
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;
  const T = (h, m) => h * 60 + m;
  const INCIDENT_GM = T(9, 52);

  /* ---------------- 登場人物 ---------------- */
  IS.PEOPLE = {
    takase: { name: '高瀬 美咲', role: 'ディレクター', color: '#b48cf2' },
    kinoshita: { name: '木下 陸', role: '営業', color: '#f28b4b' },
    mori: { name: '森 さやか', role: 'カスタマーサポート', color: '#3ddc84' },
    obayashi: { name: '大林 修', role: 'マネージャー', color: '#f25f5c' },
    ito: { name: '伊藤 健', role: 'エンジニア', color: '#4aa3ff' },
    sentry: { name: 'Sentry', role: 'bot', color: '#5b2c6f' },
    cwatch: { name: 'CloudWatch', role: 'bot', color: '#e07941' },
    system: { name: 'system', role: '', color: '#555' },
  };

  const CH_DEV = 'atlas-dev';
  const CH_ALERT = 'atlas-alerts';
  const CH_INC = 'inc-20260706-atlas';
  const DM_TAKASE = 'dm-takase';

  const slack = () => IS.slackApp;
  const st = IS.state;

  /* ============================================================
     運用オペレーション層（AWS/Atlas/Terminalからの操作を受ける）
     ============================================================ */
  const instances = [
    { name: 'www-production-01', id: 'i-0a91cc21e4', type: 'www', state: 'running', canReboot: false },
    { name: 'www-production-02', id: 'i-0b22de95f1', type: 'www', state: 'running', canReboot: false },
    { name: 'api-production-01', id: 'i-0c37ab119d', type: 'api', state: 'running', canReboot: true },
    { name: 'api-production-02', id: 'i-0d48bc22a3', type: 'api', state: 'running', canReboot: true },
    { name: 'api-production-03', id: 'i-0e59cd33b7', type: 'api', state: 'running', canReboot: true },
    { name: 'api-production-04', id: 'i-0f6ade44c2', type: 'api', state: 'running', canReboot: true },
    { name: 'api-production-05', id: 'i-1a7bef55d9', type: 'api', state: 'running', canReboot: true },
    { name: 'api-production-06', id: 'i-2b8cfa66e1', type: 'api', state: 'running', canReboot: true },
  ];
  const featureFlags = { search_maintenance: false, search_degraded: false };
  const wafRules = [];
  let desiredCapacity = 6;
  let scalingNow = false;
  let flashMsg = null;
  let disk03 = 61;

  function apiInstances() { return instances.filter((i) => i.type === 'api'); }
  function impairedList() { return apiInstances().filter((i) => i.impaired); }

  const OPS = (IS.ops = {
    getInstances() {
      const cpu = IS.metrics.now.cpu;
      return instances.map((i) => ({
        ...i,
        cpu: i.state !== 'running' ? 0 : i.impaired ? IS.rand(1, 4) : IS.clamp(cpu + (i.name.charCodeAt(15) % 9) - 4, 2, 99),
      }));
    },
    getDesired: () => desiredCapacity,
    scaling: () => scalingNow,
    awsFlash: () => flashMsg,
    featureFlag: (k) => featureFlags[k],

    setFeatureFlag(k, v) {
      featureFlags[k] = v;
      if (k === 'search_maintenance' && v) {
        st.mark('maintenanceOn', '検索機能をメンテナンス表示に切り替え（流入停止・主要機能停止）');
        st.flag('searchMaintenance', true);
        st.addParams({ bizImpact: 8 });
        if (st.has('incident')) {
          slack().npcPost(CH_DEV, 'kinoshita', '検索が「メンテナンス中」になってるんですが！？ お客様が予約できません！ いつ戻りますか？', 1.5);
          st.counters.asksReceived++;
        }
      }
      if (k === 'search_maintenance' && !v) {
        st.flag('searchMaintenance', false);
        st.mark('maintenanceOff!', '検索機能のメンテナンス表示を解除');
      }
      if (k === 'search_degraded') {
        st.flag('searchDegraded', v);
        if (v) {
          st.mark('degradedOn', '検索を縮退運転へ切り替え（重いクエリを遮断）');
          st.addParams({ bizImpact: 4, userTrust: -3 });
          if (st.has('incident')) slack().npcPost(CH_DEV, 'takase', '検索、並び替えが消えてなんだか素っ気なくなってません……？ユーザーから見え方が変わっています。', 2);
        }
      }
      IS.bus.emit('ops-changed');
      IS.bus.emit('chips-changed');
    },

    /* ---- EC2 ---- */
    rebootInstance(name) {
      const inst = instances.find((i) => i.name === name);
      if (!inst || inst.state !== 'running') return;
      inst.state = 'rebooting';
      flashMsg = { html: `⏳ <b>${esc(name)}</b> を再起動しています（ロードバランサーから切り離し済み）…`, sev: '' };
      st.mark(`reboot-${name}!`, `${name} を切り離して再起動`);
      IS.bus.emit('ops-changed');
      IS.sound.warn();
      IS.clock.afterGm(1.3, () => {
        inst.state = 'running';
        const wasImpaired = inst.impaired;
        inst.impaired = false;
        st.flag(`rebooted-${name}`);
        flashMsg = { html: `✅ <b>${esc(name)}</b> がヘルスチェックに合格し、ロードバランサーへ復帰しました。` };
        if (wasImpaired && impairedList().length === 0 && st.has('stuckWorkers')) {
          st.flag('stuckWorkers', false);
          st.mark('workersRecovered', '応答不能だったAPIサーバーを段階的な再起動で全台復旧');
          slack().post(CH_ALERT, { from: 'cwatch', attach: { sev: 'ok', title: '✅ OK: api-prod healthy hosts', body: 'api-production-01〜06 ヘルスチェック: 全台 healthy' } });
        }
        IS.bus.emit('ops-changed');
        IS.clock.afterGm(2, () => { flashMsg = null; IS.bus.emit('ops-changed'); });
      });
    },

    rebootAll() {
      st.flag('restartingAll', true);
      st.mark('rebootAll', 'APIサーバー全台を一斉再起動（数分間の全面停止を許容）');
      apiInstances().forEach((i) => { i.state = 'rebooting'; });
      flashMsg = { html: '🚨 <b>api-production 全台を再起動中。</b> 健全なホストは 0 台です。', sev: 'warn' };
      IS.bus.emit('ops-changed');
      IS.sound.down();
      slack().post(CH_ALERT, { from: 'cwatch', attach: { sev: 'crit', title: '🚨 ALARM: alb-atlas-UnHealthyHostCount', body: 'HealthyHostCount = 0\nすべてのターゲットがヘルスチェックに失敗しています' }, mentionMe: true });
      slack().npcPost(CH_DEV, 'mori', '全部つながらなくなったと問い合わせが殺到しています！！トップページも予約も全部です！', 1.2);
      st.addParams({ userTrust: -8 });
      IS.clock.afterGm(2.4, () => {
        apiInstances().forEach((i) => { i.state = 'running'; i.impaired = false; });
        st.flag('restartingAll', false);
        if (st.has('stuckWorkers')) {
          st.flag('stuckWorkers', false);
          st.mark('workersRecovered', '一斉再起動でAPIサーバーを復旧（全面停止を伴った）');
        }
        flashMsg = { html: '✅ 全インスタンスが復帰しました。' };
        slack().post(CH_ALERT, { from: 'cwatch', attach: { sev: 'ok', title: '✅ OK: alb-atlas-UnHealthyHostCount', body: 'HealthyHostCount = 6' } });
        IS.bus.emit('ops-changed');
        IS.clock.afterGm(2, () => { flashMsg = null; IS.bus.emit('ops-changed'); });
      });
    },

    scaleOut() {
      if (scalingNow) return;
      scalingNow = true;
      desiredCapacity += 2;
      st.mark('scaledOut', 'EC2をスケールアウト（DBがボトルネックの状況で接続数がさらに増加）');
      flashMsg = { html: '⏳ Auto Scaling: 新しいインスタンスを起動しています…' };
      IS.bus.emit('ops-changed');
      IS.clock.afterGm(2, () => {
        instances.push(
          { name: 'api-production-07', id: 'i-3c9dfb77f2', type: 'api', state: 'running', canReboot: true },
          { name: 'api-production-08', id: 'i-4daefc88a5', type: 'api', state: 'running', canReboot: true },
        );
        scalingNow = false;
        st.flag('scaledOut', true);
        flashMsg = null;
        IS.bus.emit('ops-changed');
        if (st.has('incident') && !st.has('crawlerContained')) {
          slack().post(CH_ALERT, { from: 'sentry', attach: { sev: 'crit', title: '🚨 Error rate increased — api-production', body: "PDOException: SQLSTATE[HY000] [1040] Too many connections\n発生頻度が上昇しています（新規インスタンスの接続追加後）" }, mentionMe: true });
          slack().npcPost(CH_DEV, 'ito', 'あれ、台数増やしました？ DBの接続数が上限に張り付いてます。ボトルネックがDBのときのスケールアウトは逆効果になりますよ…', 2);
        }
      });
    },

    rdsReboot() {
      st.flag('rdsRebooting', true);
      st.mark('rdsReboot', 'プライマリDBを再起動（全面停止・接続問題の解決にならず）');
      IS.sound.down();
      slack().npcPost(CH_DEV, 'ito', 'DB再起動しました！？ 全部止まってますよ！ 接続数の問題はクライアント側が生きてる限り再発します…！', 1);
      IS.clock.afterGm(2.5, () => {
        st.flag('rdsRebooting', false);
        IS.bus.emit('ops-changed');
      });
      IS.bus.emit('ops-changed');
    },

    /* ---- WAF ---- */
    getWafRules: () => wafRules,
    wafRuleWizard() {
      const know = st.has('knowCrawler');
      const body = el('div');
      body.appendChild(el('p', '', 'atlas-prod-acl に追加するルールを選択してください。'));
      const list = el('div', 'opt-list');
      const optTarget = el('button', 'opt-item');
      optTarget.innerHTML = `<span class="opt-label">🎯 レートベース制限（特定条件）</span>
        <span class="opt-desc">${know
          ? 'User-Agent「MegaBot/2.4」+ 該当IP帯からの /search へのアクセスを 60req/分 に制限する。特定済みの攻撃元だけを止める。'
          : '対象のUser-Agent・IP帯が<b>まだ特定できていません</b>。アクセスログの分析（CloudWatch Logs Insights）が必要です。'}</span>`;
      optTarget.disabled = !know;
      const optBlind = el('button', 'opt-item');
      optBlind.innerHTML = `<span class="opt-label">🌐 広域ブロック（推測）</span>
        <span class="opt-desc">「怪しく見える」海外IP帯をまとめてブロックする。確証はないが今すぐ実行できる。正規のユーザーや検索エンジンBotを巻き込むリスクがある。</span>`;
      list.append(optTarget, optBlind);
      body.appendChild(list);
      const { close } = IS.modal({
        title: 'WAF ルールの追加',
        bodyEl: body,
        actions: [{ label: 'キャンセル' }],
      });
      optTarget.onclick = () => { close(); applyWaf('targeted'); };
      optBlind.onclick = () => { close(); applyWaf('blind'); };
    },
  });

  function applyWaf(kind) {
    const rule = kind === 'targeted'
      ? { name: 'rate-limit-megabot', desc: 'UA "MegaBot/2.4" + AS12389 → /search を60req/分に制限', action: 'Block(rate)', pending: true }
      : { name: 'block-suspicious-ranges', desc: '推測による海外IP帯の広域ブロック', action: 'Block', pending: true };
    wafRules.push(rule);
    IS.bus.emit('ops-changed');
    IS.clock.afterGm(0.9, () => {
      rule.pending = false;
      IS.bus.emit('ops-changed');
      IS.sound.ok();
      if (kind === 'targeted') {
        st.flag('wafTargeted', true);
        st.mark('wafTargeted', '特定済みのクローラーだけをWAFレート制限（的確な流入制御）');
        slack().post(CH_ALERT, { from: 'cwatch', attach: { sev: 'warn', title: '⚠ 検索APIリクエスト数: 急減', body: 'ALB RequestCount が制限ルール適用後に低下しています' } });
      } else {
        st.flag('wafBlind', true);
        st.mark('wafBlind', '確証のないままWAFで広域IPブロック（一部流入は継続・巻き添えリスク）');
        IS.clock.afterGm(4, () => {
          if (st.over) return;
          st.flag('seoDamage', true);
          slack().npcPost(CH_DEV, 'ito', 'WAFのブロック範囲、正規の検索エンジンBotまで巻き込んでませんか？ Search Consoleにクロールエラーが出始めてます。SEOに響くかも…', 1);
          st.addParams({ userTrust: -4 });
        });
      }
      IS.bus.emit('chips-changed');
    });
  }

  /* ---- deployctl ジョブ ---- */
  const deployState = { retryTuned: false, pagecap: false, fixTemplate: false };
  OPS.deployJobs = () => {
    const jobs = [];
    if (st.has('knowRetry')) {
      jobs.push({
        id: 'retry-tune', desc: 'wwwのAPIリトライ回数 3→1（再試行の嵐の抑制）', branch: 'hotfix/retry-tune',
        tests: '12 passed', gmCost: 1.2, done: deployState.retryTuned,
        after() {
          deployState.retryTuned = true;
          st.flag('retryReduced', true);
          st.mark('retryTuned', 'wwwの自動リトライを一時的に削減（負荷増幅を抑制）');
        },
      });
    }
    if (st.has('knowExplain') || st.has('knowDeepPages')) {
      jobs.push({
        id: 'pagecap', desc: '検索の最大100ページ制限＋人気順ソート一時停止（深いOFFSET対策）', branch: 'hotfix/search-pagecap',
        tests: '18 passed (境界テスト追加)', gmCost: 1.8, done: deployState.pagecap,
        after() {
          deployState.pagecap = true;
          st.flag('pagecapDeployed', true);
          st.mark('pagecap', '検索ページ上限とソート簡素化をデプロイ（構造的な負荷対策）');
          st.addParams({ bizImpact: 3, debt: -4 });
          slack().npcPost(CH_INC_OR_DEV(), 'ito', 'pagecapのデプロイ確認しました。100ページ超えは適切なエラーを返してますね。LGTMです。クエリも軽くなってるはず。', 1.5);
        },
      });
    }
    if (st.has('foundTemplate')) {
      jobs.push({
        id: 'fix-template', desc: '検索結果とおすすめ店舗の変数分離＋テンプレートテスト追加（表示不具合の恒久修正）', branch: 'fix/search-template-merge',
        tests: '21 passed (テンプレートテスト追加)', gmCost: 1.5, done: deployState.fixTemplate,
        after() {
          deployState.fixTemplate = true;
          st.flag('templateFixed', true);
          st.mark('templateFixed', '表示不具合（別地域の店舗混入）を恒久修正しテストを追加');
          st.addParams({ userTrust: 10, debt: -4 });
          if (slack().channel(DM_TAKASE)) {
            slack().npcPost(DM_TAKASE, 'takase', '直っていることを確認しました！問い合わせいただいたユーザーにも案内します。ありがとうございます。', 2);
          }
        },
      });
    }
    return jobs;
  };

  function CH_INC_OR_DEV() { return slack().channel(CH_INC) ? CH_INC : CH_DEV; }

  /* ---- 本番DDL（ALTER TABLE）ギャンブル ---- */
  let alterDone = false;
  OPS.alterTable = (print, stream) => {
    if (alterDone || st.has('dbIndexAdded')) { print('ERROR 1061 (42000): Duplicate key name', 't-err'); return; }
    const know = st.marked('explain');
    const p = know ? 0.7 : 0.3;
    stream([
      { text: 'ALTER TABLE shops ADD INDEX idx_area_status_pop (area_id, status, popularity_score), ALGORITHM=INPLACE, LOCK=NONE;', cls: 't-dim', wait: 800 },
      { text: '実行中…（対象: 約294万行）', cls: 't-warn', wait: 2000 },
    ], () => {
      if (Math.random() < p) {
        alterDone = true;
        st.flag('dbIndexAdded', true);
        st.mark('alterOk', `本番DBへオンラインDDLで複合インデックスを追加（${know ? '実行計画を確認済み' : '実行計画を確認せず・結果的に成功'}）`);
        stream([
          { text: 'Query OK, 0 rows affected (4 min 12.08 sec)', cls: 't-ok', wait: 400 },
          { text: '→ 検索クエリの実行時間が数秒 → 数十ミリ秒へ。賭けには勝った。', cls: 't-ok' },
        ]);
        st.addParams({ debt: -6 });
        IS.sound.ok();
      } else {
        st.flag('lockStorm', true);
        st.mark('alterFail', `本番DBのALTER TABLEがメタデータロックと衝突（${know ? '' : '実行計画を確認せず実行・'}検索全停止を招いた）`);
        stream([
          { text: 'ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction', cls: 't-err', wait: 600 },
          { text: '→ 実行中の長いクエリとメタデータロックが衝突。shopsテーブルへの全クエリが待機状態に入った！', cls: 't-err' },
          { text: '→ ALTERを緊急中断中…', cls: 't-warn' },
        ]);
        IS.sound.down();
        slack().post(CH_ALERT, { from: 'sentry', attach: { sev: 'crit', title: '🚨 Lock wait timeout exceeded — api-production', body: '全検索クエリが待機状態です' }, mentionMe: true });
        st.addParams({ health: -8, fatigue: 8 });
        IS.clock.afterGm(1.8, () => {
          st.flag('lockStorm', false);
          print('ALTER中断完了。ロックは解放されました。数分間、検索は完全に停止していました。', 't-warn');
        });
      }
    });
  };

  /* ---- CloudWatch Logs Insights クエリ ---- */
  OPS.logQueries = [
    {
      id: 'ua-top', label: 'ALB: User-Agent別リクエスト数（直近1時間・上位）', gmCost: 1.2,
      run() {
        if (st.has('incident')) {
          st.flag('knowCrawler', true);
          st.mark('knowCrawler', 'アクセスログ分析でクローラー（MegaBot/2.4）を特定');
          IS.bus.emit('chips-changed');
          return [
            'user_agent                                   | count   | 傾向',
            '--------------------------------------------- | ------- | ----',
            'MegaBot/2.4 (+http://megabot.example/crawler) |  54,812 | ★異常（通常時の300倍・約180req/分）',
            'Mozilla/5.0 (iPhone; ...) Safari              |   9,412 | 通常',
            'Mozilla/5.0 (Windows NT 10.0; ...) Chrome     |   8,177 | 通常',
            'Googlebot/2.1                                 |   1,208 | 通常',
            '',
            '→ MegaBot/2.4 が /search を1ページ目から千ページ目まで機械的に巡回している。',
            '→ 発信元は AS12389 の連続したIP帯。WAFのレートベースルールで的確に制限できる。',
          ].join('\n');
        }
        return 'user_agent | count\nMozilla/5.0 (iPhone...) | 9,231\nGooglebot/2.1 | 1,190\n（異常な傾向はありません）';
      },
    },
    {
      id: 'page-dist', label: 'ALB: /search の page パラメータ分布', gmCost: 1,
      run() {
        if (st.has('incident')) {
          st.flag('knowDeepPages', true);
          st.mark('knowDeepPages', '深いページネーション（OFFSET肥大）への大量アクセスを特定');
          IS.bus.emit('chips-changed');
          return [
            'page帯      | リクエスト数 | 平均応答時間',
            '----------- | ------------ | ------------',
            'page 1-10   |       12,431 |        420ms',
            'page 11-100 |       18,022 |      1,830ms',
            'page 101-500|       21,873 |      4,610ms  ★',
            'page 501-987|       11,204 |      7,940ms  ★',
            '',
            '→ 通常ユーザーはpage 1-3で離脱する。深いページはOFFSETが大きく、DBが大量の行を読み飛ばしている。',
            '→ ページ数上限（例: 100）の導入が構造的な対策になる（deployctl: pagecap）。',
          ].join('\n');
        }
        return 'page帯 | リクエスト数\npage 1-10 | 11,893\npage 11+ | 302\n（正常な分布です）';
      },
    },
    {
      id: 'status-5xx', label: 'ALB: ステータスコード別件数（直近15分）', gmCost: 0.8,
      run() {
        const m = IS.metrics.now;
        const total = Math.round(m.reqs * 15);
        const err = Math.round(total * m.err / 100);
        return `status | count\n200    | ${total - err}\n5xx    | ${err}  （エラー率 ${m.err.toFixed(1)}%）\n504    | ${Math.round(err * 0.4)}（タイムアウト）`;
      },
    },
    {
      id: 'api-errors', label: '/atlas/api: ERROR レベルのログ抽出', gmCost: 0.8,
      run() {
        if (IS.metrics.now.db >= 480) {
          return `[ERROR] PDOException: SQLSTATE[HY000] [1040] Too many connections（直近15分で 1,204 件）\n[ERROR] Fatal error: Allowed memory size of 536870912 bytes exhausted — api-production-03\n\n→ DB接続数の枯渇と、api-03のメモリ不足が同時に起きている。`;
        }
        if (st.has('incident')) return '[ERROR] cURL timeout: api internal call（直近15分で 88 件）\n→ 接続エラーは沈静化傾向。';
        return 'ERRORレベルのログはありません。';
      },
    },
  ];

  /* ============================================================
     メトリクスモデル
     ============================================================ */
  IS.metrics.targetsFn = (state, prev) => {
    const f = state.flags;
    const gm = IS.clock.gm;

    /* クローラー流入 */
    let inflow = 0;
    if (f.incident) {
      const ramp = IS.clamp((gm - INCIDENT_GM) / 5, 0, 1);
      if (!f.wafTargeted && !f.searchMaintenance) inflow = f.wafBlind ? 0.35 : 1;
      inflow *= ramp;
      /* 第二波クローラー（弱い緩和のまま復旧宣言した場合） */
      if (f.crawler2 && !f.searchMaintenance) inflow = Math.max(inflow, 0.75);
    }
    /* クエリの重さ（恒久対策で軽くなる） */
    const queryCost = (f.pagecapDeployed || f.dbIndexAdded) ? 0.1 : f.searchDegraded ? 0.3 : 1;
    /* リトライ増幅（レイテンシが高いと www が再試行して負荷を増やす） */
    const amp = (!f.retryReduced && prev.lat > 2600) ? 1.3 : 1;
    const load = inflow * queryCost * amp;

    st.flag('crawlerContained', inflow < 0.15);

    let cpu = 14 + 76 * load;
    let db = 40 + 430 * load + (f.scaledOut && load > 0.25 ? 55 : 0);
    let err = 0.2 + load * (db >= 495 ? 15 : 8);
    let lat = 430 * ((f.pagecapDeployed || f.dbIndexAdded) ? 0.9 : 1) + 7200 * load;
    let reqs = 220 + 900 * inflow;

    if (f.scaledOut) cpu *= 0.82;
    if (f.stuckWorkers) { err += 4.5; lat += 1400; }
    if (f.lockStorm) { err += 30; lat += 5000; }
    if (f.rdsRebooting) { err = 96; lat = 12000; }

    const healthy = f.restartingAll ? 0
      : apiInstances().filter((i) => i.state === 'running').length;

    return {
      cpu: IS.clamp(cpu, 2, 98),
      db: IS.clamp(db, 20, 500),
      err: IS.clamp(err, 0, 100),
      lat: IS.clamp(lat, 200, 14000),
      reqs: Math.max(60, reqs),
      disk03,
      healthy,
    };
  };

  /* 事業影響・疲労の蓄積 ＋ api-03ディスクの成長（ゲーム内時間ベース） */
  let lastAccrueGm = null;
  IS.bus.on('tick', ({ gm }) => {
    if (st.over || !st.started) return;
    if (lastAccrueGm === null) lastAccrueGm = gm;
    const dRaw = gm - lastAccrueGm;
    /* ディスクは毎tick少しずつ */
    const f = st.flags;
    if (f.incident && !f.logCleaned && !st.has('crawlerContained')) disk03 = Math.min(97, disk03 + 1.5 * dRaw);
    else if (f.incident && !f.logCleaned) disk03 = Math.min(97, disk03 + 0.06 * dRaw);
    else if (f.logCleaned && disk03 > 71) disk03 = Math.max(71, disk03 - 3 * dRaw);
    if (dRaw < 1) return;
    lastAccrueGm = gm;
    const delta = {};
    if (featureFlags.search_maintenance) delta.bizImpact = 0.5 * dRaw;
    else if (featureFlags.search_degraded) delta.bizImpact = 0.18 * dRaw;
    if (st.has('incident') && !st.has('declared')) delta.fatigue = 0.12 * dRaw;
    if (Object.keys(delta).length) st.addParams(delta);
  });

  /* 安定継続時間の追跡（復旧宣言の条件） */
  let okStreak = 0;
  let lastOkGm = null;
  IS.bus.on('tick', ({ gm }) => {
    if (!st.has('incident') || st.over) return;
    if (lastOkGm === null) lastOkGm = gm;
    const d = gm - lastOkGm;
    lastOkGm = gm;
    if (IS.metrics.impact() === 'ok') {
      const before = okStreak;
      okStreak += d;
      if (before < 4 && okStreak >= 4) IS.bus.emit('chips-changed');
    } else {
      if (okStreak >= 4) IS.bus.emit('chips-changed');
      okStreak = 0;
    }
  });
  const canDeclare = () => okStreak >= 4 && !st.has('declared');

  /* ============================================================
     Slack: チャンネル初期化・タイムライン
     ============================================================ */
  function setupChannels() {
    slack().addChannel(CH_DEV, { name: 'atlas-dev', topic: 'Atlas開発・運用の雑談と連絡' }, { activate: true });
    slack().addChannel(CH_ALERT, { name: 'atlas-alerts', topic: '監視ツールからの自動通知（Sentry / CloudWatch）' });

    slack().post(CH_DEV, { from: 'ito', body: '週末のリリース、特に問題なさそうです。今週もよろしくお願いします〜', quiet: true });
    slack().post(CH_DEV, { from: 'kinoshita', body: '【共有】キャンペーンLPの件、木曜までに一度すり合わせさせてください🙏', quiet: true });
    slack().post(CH_ALERT, { from: 'cwatch', attach: { sev: 'ok', title: '✅ OK: nightly-batch-atlas', body: '深夜バッチ 全17ジョブ正常終了 (03:42)' }, quiet: true });
    slack().system(CH_DEV, 'あなたは今週のオンコール担当です。Slackの通知に注意してください。');
  }

  /* ---- タイムラインイベント ---- */
  function setupTimeline() {
    const E = IS.engine;

    /* 9:42 高瀬さんの相談 */
    E.at(T(9, 42), 'takase-report', () => {
      slack().post(CH_DEV, {
        from: 'takase', mentionMe: true,
        body: '@あなた おはようございます。\nユーザーから問い合わせがあったのですが、店舗検索画面で条件を変更すると、違う地域の店舗が表示されることがあるようです。毎回ではなさそうです。確認できますか？',
        shot: [
          { name: '和食処 やまびこ 銀座本店', area: '東京都' },
          { name: 'Trattoria Lupo 恵比寿', area: '東京都' },
          { name: '浦和 うなぎ処 かわせ', area: '埼玉県', bad: true },
          { name: 'Cafe Bleu 吉祥寺', area: '東京都' },
        ],
      });
      st.counters.asksReceived++;
      IS.bus.emit('chips-changed');
    });

    /* 9:48 未応答なら催促 */
    E.add({
      id: 'takase-nudge', at: T(9, 49),
      when: () => !st.marked('ack'),
      fire: () => {
        slack().npcPost(CH_DEV, 'takase', 'すみません、先ほどの検索の件、見れそうですか？ユーザーには何と返しておけばよいでしょう…', 0.5);
      },
    });

    /* 9:52 インシデント発生 */
    E.at(INCIDENT_GM, 'incident-start', () => {
      st.flag('incident', true);
      st.mark('incidentStart', '― 障害発生（9:52）―');
    });
    E.at(INCIDENT_GM + 1.5, 'alert-sentry', () => {
      slack().post(CH_ALERT, {
        from: 'sentry', mentionMe: true,
        attach: { sev: 'crit', title: '🚨 Error rate increased — api-production', body: 'PDOException: SQLSTATE[HY000] [1040] Too many connections\n直近5分で 214 events（通常: 0）' },
      });
      IS.bus.emit('chips-changed');
    });
    E.at(INCIDENT_GM + 2.5, 'alert-cpu', () => {
      slack().post(CH_ALERT, {
        from: 'cwatch',
        attach: { sev: 'crit', title: '🚨 ALARM: api-prod-HighCPU', body: 'CPUUtilization > 85%（5分間継続）\nしきい値超過: api-production-01〜06' },
      });
    });
    E.at(INCIDENT_GM + 4, 'kinoshita-panic', () => {
      slack().post(CH_DEV, { from: 'kinoshita', body: 'お客様から「予約ページが開かない」と連絡が来ています。見れる方いますか？' });
      st.counters.asksReceived++;
    });
    E.at(INCIDENT_GM + 5, 'mori-panic', () => {
      slack().post(CH_DEV, { from: 'mori', mentionMe: true, body: '@あなた 問い合わせが増えています。検索が開かない・予約でエラーになると。全ユーザーに影響していますか？' });
      st.counters.asksReceived++;
      st.flag('moriAsked', true);
      IS.bus.emit('chips-changed');
    });
    E.at(INCIDENT_GM + 6.5, 'takase-link', () => {
      slack().post(CH_DEV, { from: 'takase', body: 'さっきの検索結果の件と関係ありますか？タイミングが近い気がして……' });
    });
    E.at(INCIDENT_GM + 8, 'obayashi-ask', () => {
      slack().post(CH_DEV, { from: 'obayashi', mentionMe: true, body: '@あなた 状況分かる人いますか？経営会議が11時からあるので、分かった時点で一報ください。' });
      st.counters.asksReceived++;
      IS.bus.emit('chips-changed');
    });

    /* 10:10 情報の空白への圧力 */
    E.add({
      id: 'obayashi-pressure', at: T(10, 10),
      when: () => !st.marked('channelCreated') && !st.marked('firstReport'),
      fire: () => {
        slack().npcPost(CH_DEV, 'obayashi', '誰か状況まとめてくれないか。情報がバラバラで、経営層に何も説明できない。EC2増やせば直るんじゃないの？', 0.5);
        st.addParams({ orgTrust: -5 });
        st.mark('infoVacuum', '初動の情報集約が遅れ、憶測が飛び交った');
      },
    });

    /* 10:14 第二波: api-03のメモリ・ディスク */
    E.add({
      id: 'wave2', at: T(10, 14),
      when: () => st.has('incident'),
      fire: () => {
        st.flag('stuckWorkers', true);
        instances.filter((i) => ['api-production-03', 'api-production-05', 'api-production-06'].includes(i.name)).forEach((i) => { i.impaired = true; });
        IS.bus.emit('ops-changed');
        slack().post(CH_ALERT, {
          from: 'sentry', mentionMe: true,
          attach: { sev: 'crit', title: '🚨 Fatal error: Allowed memory size exhausted', body: 'api-production-03 / 05 / 06\nワーカープロセスが応答していません（ヘルスチェック 1/2 失敗）' },
        });
      },
    });

    /* api-03 ディスク90%超えの警報 */
    E.add({
      id: 'disk-alarm',
      when: () => disk03 >= 90 && !st.has('logCleaned'),
      fire: () => {
        slack().post(CH_ALERT, {
          from: 'cwatch', mentionMe: true,
          attach: { sev: 'crit', title: '🚨 ALARM: api-production-03-DiskUsage', body: `disk_used_percent > 90%（現在 ${Math.round(disk03)}%）\n※ このホストのアプリログはCloudWatchに送られていません。中を見るにはSSHが必要です` },
        });
      },
    });

    /* 10:22 誰も流入を止めないなら伊藤さんが動く */
    E.add({
      id: 'ito-acts', at: T(10, 22),
      when: () => st.has('incident') && !st.has('wafTargeted') && !st.has('wafBlind') && !featureFlags.search_maintenance && !featureFlags.search_degraded,
      fire: () => {
        st.flag('wafTargeted', true);
        st.flag('itoDidIt', true);
        st.mark('itoDidIt', '流入制御の判断が遅れ、伊藤さんが代わりにWAF制限を実施した');
        wafRules.push({ name: 'rate-limit-megabot (by ito)', desc: 'UA "MegaBot/2.4" → /search 制限（伊藤さんが追加）', action: 'Block(rate)', pending: false });
        IS.bus.emit('ops-changed');
        slack().npcPost(CH_DEV, 'ito', 'すみません、見かねてWAFに検索ページへのレート制限を入れました。クローラーっぽいUA（MegaBot/2.4）が大量に来ていたので。ログ、確認しました？', 0.5);
        st.addParams({ orgTrust: -8 });
      },
    });

    /* 10:18 木下さんが復旧見込みを聞く */
    E.add({
      id: 'kinoshita-eta', at: T(10, 18),
      when: () => st.has('incident') && !st.has('declared'),
      fire: () => {
        slack().post(CH_DEV, { from: 'kinoshita', mentionMe: true, body: '@あなた 復旧見込みって分かりますか？お客様に説明しないといけなくて……時間だけでも……' });
        st.counters.asksReceived++;
        st.flag('etaAsked', true);
        IS.bus.emit('chips-changed');
      },
    });

    /* 根拠のない約束の清算 */
    E.add({
      id: 'promise-fallout',
      when: () => st.marked('promisedQuick') && !st.has('declared') && IS.clock.gm > INCIDENT_GM + 30,
      fire: () => {
        slack().npcPost(CH_DEV, 'obayashi', '「すぐ直ります」って言ってたよね？もう30分以上経ってるけど……次の報告はいつもらえる？', 0.5);
        st.addParams({ orgTrust: -8 });
        st.mark('promiseFallout', '根拠のない「すぐ直ります」が跳ね返ってきた');
      },
    });
    E.add({
      id: 'eta-fallout',
      when: () => st.has('promisedEta') && !st.has('declared') && IS.clock.gm > T(11, 30),
      fire: () => {
        slack().npcPost(CH_DEV, 'kinoshita', 'すみません、「11:30までに復旧」とお客様に伝えてしまったのですが……まだですよね？先方がかなり怒ってしまって……', 0.5);
        st.addParams({ orgTrust: -10, userTrust: -4 });
        st.mark('etaFallout', '根拠なく宣言した復旧時刻が過ぎ、顧客への謝罪が発生');
      },
    });

    /* 復旧宣言後: 弱い緩和のままなら第二のクローラーが来る */
    E.add({
      id: 'crawler2',
      when: () => st.has('declared')
        && !st.has('pagecapDeployed') && !st.has('dbIndexAdded') && !st.has('searchDegraded') && !featureFlags.search_maintenance
        && !st.has('wafTargeted')
        && IS.clock.gm > (st.flags.declaredGm || 0) + 6,
      fire: () => {
        st.flag('crawler2', true);
        st.mark('relapse', '構造的な対策を打たないまま復旧宣言し、別のクローラーで再発した');
        slack().post(CH_ALERT, {
          from: 'cwatch', mentionMe: true,
          attach: { sev: 'crit', title: '🚨 ALARM: api-prod-HighCPU（再発）', body: 'CPUUtilization が再び上昇しています' },
        });
        slack().npcPost(CH_DEV, 'ito', '別のクローラーが来てます。User-Agentは違いますが、やってることは同じ「深いページの巡回」です。構造が同じなら、障害も同じように起きますよ。', 1);
      },
    });
    /* 第二波クローラーは構造対策が入れば止まる */
    E.add({
      id: 'crawler2-stop',
      when: () => st.has('crawler2') && (st.has('pagecapDeployed') || st.has('dbIndexAdded') || st.has('searchDegraded') || featureFlags.search_maintenance),
      fire: () => {
        st.flag('crawler2', false);
        slack().npcPost(CH_DEV, 'ito', '対策入りましたね。クローラーが来てもクエリが軽いので、もう刺さらなくなってます。', 1.5);
      },
    });

    /* 復旧宣言後: 高瀬さんのDM（表示不具合は残っている） */
    E.add({
      id: 'bug2',
      when: () => st.has('declared') && IS.clock.gm > (st.flags.declaredGm || 0) + 4 && !st.has('templateFixed'),
      fire: () => {
        slack().addChannel(DM_TAKASE, { name: '高瀬 美咲', kind: 'dm', topic: 'ディレクター' });
        slack().post(DM_TAKASE, {
          from: 'takase', mentionMe: true,
          body: '検索画面、表示は速くなりました。ありがとうございます。\nただ、最初に相談した「東京都で埼玉県の店舗が混ざる件」、さっきもユーザーから再発の報告がありました。負荷の障害とは別の問題……ってことはありますか？',
        });
        st.counters.asksReceived++;
        st.mark('bug2Reported', '高瀬さんから表示不具合の再発報告（負荷障害とは別原因）');
        IS.termApp && IS.termApp.refreshHints();
        IS.bus.emit('chips-changed');
      },
    });

    /* 振り返りへの誘導 */
    E.add({
      id: 'postmortem-call',
      when: () => st.has('declared') && IS.clock.gm > (st.flags.declaredGm || 0) + 10,
      fire: () => {
        slack().npcPost(CH_INC_OR_DEV(), 'obayashi', 'おつかれさま。落ち着いたところで、今日の障害の振り返りをやろう。準備ができたら画面右上の「振り返りへ進む」から会議室へどうぞ。', 1);
        st.flag('postmortemReady', true);
        IS.$('#mb-postmortem').style.display = '';
        IS.notify('slack', { title: '振り返りミーティング', body: '準備ができたら右上の「振り返りへ進む」からどうぞ', icon: '📋' });
      },
    });

    /* シフト終盤の警告 */
    E.add({
      id: 'shift-warning',
      when: () => IS.clock.realElapsed > IS.clock.realLimit - 300 && !st.has('postmortemReady'),
      fire: () => {
        slack().npcPost(CH_DEV, 'obayashi', 'そろそろシフト交代の時間が近い。状況はどこまで進んでる？（実時間の残りが5分を切りました）', 0.3);
      },
    });
  }

  /* ============================================================
     プレイヤー操作: chips（文脈に応じた発言候補）
     ============================================================ */
  let lastUpdateGm = -99;

  function chipsFor(chId) {
    const chips = [];
    const f = st.flags;

    /* ---- 高瀬さんの最初の相談への応答 ---- */
    if (chId === CH_DEV && !st.marked('ack') && IS.clock.gm >= T(9, 42)) {
      chips.push({
        label: '「確認します。発生ユーザーのID・時刻・操作手順をもらえますか？」',
        primary: true,
        run() {
          slack().post(CH_DEV, { from: 'me', body: '確認します。再現条件を絞りたいので、発生したユーザーのID・時刻・操作手順・ブラウザをもらえますか？分かり次第調査します。' });
          st.mark('ack', '高瀬さんの相談に反応し、再現条件の確認を依頼');
          st.counters.asksAnswered++;
          slack().npcPost(CH_DEV, 'takase', 'ありがとうございます！ユーザーに確認してみます。分かっているのは「東京都で検索して埼玉の店が混ざった・毎回ではない」です。', 1.5);
        },
      });
      chips.push({
        label: '「再現しないようなら一旦様子見でもいいですか？」',
        run() {
          slack().post(CH_DEV, { from: 'me', body: '手元では再現しませんでした。緊急度は高くなさそうなので、一旦様子見でもいいですか？再発したら教えてください。' });
          st.mark('ack', '高瀬さんの相談に反応（様子見と回答）');
          st.mark('deferredBug', '初報の不具合を様子見にした');
          st.counters.asksAnswered++;
          slack().npcPost(CH_DEV, 'takase', '分かりました……再発したらまた連絡しますね。', 1.5);
        },
      });
    }

    /* ---- インシデント発生後 ---- */
    if (f.incident && !st.marked('channelCreated')) {
      chips.push({
        label: '🚨 インシデントチャンネルを作成して情報を集約する',
        primary: true,
        run() {
          slack().addChannel(CH_INC, { name: 'inc-20260706-atlas', topic: '📌 検索遅延・API障害の対応チャンネル（情報はここへ集約）' });
          slack().post(CH_DEV, { from: 'me', body: '#inc-20260706-atlas を作成しました。障害関連の情報はそちらへ集約してください。' });
          slack().system(CH_INC, 'あなたが #inc-20260706-atlas を作成しました');
          st.mark('channelCreated', 'インシデントチャンネルを作成し情報を一元化');
          st.addParams({ orgTrust: 6 });
          slack().npcPost(CH_INC, 'obayashi', '把握しました。情報はここに集約しよう。', 1.2);
          slack().switchTo(CH_INC);
        },
      });
    }

    if (chId === CH_INC && !st.marked('firstReport')) {
      chips.push({
        label: '第一報: 「事実と推測を分けて」現状を共有する',
        primary: true,
        run() {
          slack().post(CH_INC, { from: 'me', body: `${IS.clock.fmt(IS.clock.gm)}時点の状況です。\n【確認できていること】APIのCPU使用率上昇・DB接続数が上限付近・複数画面の遅延/エラー\n【推測（未確認）】検索APIへの負荷集中が起点の可能性\n【対応】原因と影響範囲を調査中。新しい情報はこのチャンネルに集約します。` });
          st.mark('firstReport', '第一報を投稿（事実と推測を分離）');
          st.mark('firstReportFact', '第一報で事実と推測を区別した');
          st.counters.updates++;
          lastUpdateGm = IS.clock.gm;
          st.addParams({ orgTrust: 8 });
          slack().npcPost(CH_INC, 'mori', 'ありがとうございます。問い合わせには「原因調査中・復旧作業中」と案内しますね。', 1.5);
        },
      });
      chips.push({
        label: '第一報: 「原因は分かっています。すぐ直します」と言い切る',
        run() {
          slack().post(CH_INC, { from: 'me', body: '原因はだいたい分かっています。すぐ直しますので少々お待ちください！' });
          st.mark('firstReport', '第一報を投稿');
          st.mark('promisedQuick', '根拠なく「すぐ直します」と宣言した');
          st.addParams({ orgTrust: 4 });
          slack().npcPost(CH_INC, 'obayashi', '頼もしい！よろしく！', 1);
        },
      });
    }

    /* 経過共有（定期） */
    if (chId === CH_INC && st.marked('firstReport') && !f.declared && IS.clock.gm - lastUpdateGm > 6) {
      chips.push({
        label: '📢 経過を共有する（現在の状態から自動要約）',
        run() {
          slack().post(CH_INC, { from: 'me', body: composeStatusUpdate() });
          st.mark(`update-${Math.round(IS.clock.gm)}!`, '経過を共有');
          st.counters.updates++;
          lastUpdateGm = IS.clock.gm;
          st.addParams({ orgTrust: 3 });
        },
      });
    }

    /* CS対応 */
    if (f.moriAsked && !st.marked('csGuided') && f.incident && !f.declared) {
      chips.push({
        label: '森さんへ: ユーザー向け案内文を渡す',
        run() {
          const ch = slack().channel(CH_INC) ? CH_INC : CH_DEV;
          slack().post(ch, { from: 'me', body: '@森 さやか ユーザーへの案内はこちらでお願いします。\n「現在、検索・予約が利用しづらい事象が発生しており、復旧作業を行っています。復旧見込みは確認中です。分かり次第お知らせします。」' });
          st.mark('csGuided', 'CSへユーザー向け案内文を提供');
          st.counters.asksAnswered++;
          st.addParams({ userTrust: 4 });
          slack().npcPost(ch, 'mori', '助かります！その文言でテンプレ化して展開します。', 1.2);
        },
      });
    }

    /* 復旧見込みへの回答 */
    if (f.etaAsked && !st.marked('etaAnswered') && !f.declared) {
      chips.push({
        label: '木下さんへ: 「根拠のある範囲」で見込みを伝える',
        primary: true,
        run() {
          const ch = slack().channel(CH_INC) ? CH_INC : CH_DEV;
          slack().post(ch, { from: 'me', body: '@木下 陸 現時点で確実な復旧時刻は約束できません。原因への対処は進んでいて、進展があり次第15分単位でこのチャンネルに書きます。お客様には「復旧作業中・見込みは追って連絡」でお願いします。' });
          st.mark('etaAnswered', '復旧見込みに事実ベースで回答（根拠のない時刻を約束しない）');
          st.counters.asksAnswered++;
          slack().npcPost(ch, 'kinoshita', '了解です……! こまめに共有もらえるだけで説明できるので助かります。', 1.2);
        },
      });
      chips.push({
        label: '木下さんへ: 「11:30までに復旧します」と言い切る',
        run() {
          const ch = slack().channel(CH_INC) ? CH_INC : CH_DEV;
          slack().post(ch, { from: 'me', body: '@木下 陸 11:30までに復旧見込みです。お客様にはそうお伝えください。' });
          st.mark('etaAnswered', '復旧見込みを回答');
          st.flag('promisedEta', true);
          st.mark('promisedEta', '根拠のない復旧時刻（11:30）を宣言した');
          st.counters.asksAnswered++;
          slack().npcPost(ch, 'kinoshita', '助かります！お客様にそう伝えます！', 1);
        },
      });
    }

    /* 復旧宣言 */
    if (chId === CH_INC && canDeclare()) {
      chips.push({
        label: '✅ 復旧報告: 数値の根拠つき＋しばらく経過観察を宣言する',
        primary: true,
        run() {
          const m = IS.metrics.now;
          slack().post(CH_INC, { from: 'me', body: `${IS.clock.fmt(IS.clock.gm)}時点で、主要画面の表示・検索APIの応答（p90 ${IS.metrics.fmtLat(m.lat)}）・DB接続数（${Math.round(m.db)}/500）・エラー率（${m.err.toFixed(1)}%）が正常範囲に戻ったことを確認しました。\nこのまま30分間の安定稼働を確認した後、完全復旧を宣言します。実施した対応と残課題は改めて共有します。` });
          declare('observed');
        },
      });
      chips.push({
        label: '復旧宣言: 「直りました！」と宣言してすぐ通常業務へ戻る',
        run() {
          slack().post(CH_INC, { from: 'me', body: '復旧しました！ご迷惑をおかけしました。通常業務に戻ります💪' });
          declare('rushed');
        },
      });
    }

    /* 経過観察後の完全復旧 */
    if (chId === CH_INC && f.declared && f.declaredKind === 'observed' && !st.marked('fullyClosed')
      && IS.clock.gm > (f.declaredGm || 0) + 5 && IS.metrics.impact() === 'ok') {
      chips.push({
        label: '✅ 安定稼働を確認、完全復旧を宣言する',
        primary: true,
        run() {
          slack().post(CH_INC, { from: 'me', body: '経過観察の結果、メトリクスの安定を確認しました。本障害は完全復旧といたします。対応の詳細と再発防止策は振り返りで共有します。' });
          st.mark('fullyClosed', '安定稼働を確認してから完全復旧を宣言');
          slack().npcPost(CH_INC, 'obayashi', '了解。助かった。', 1);
        },
      });
    }

    /* 高瀬さんDM（表示不具合） */
    if (chId === DM_TAKASE && st.marked('bug2Reported') && !st.marked('bug2Ack')) {
      chips.push({
        label: '「別原因の可能性が高いです。調査します」',
        primary: true,
        run() {
          slack().post(DM_TAKASE, { from: 'me', body: '負荷の障害は収束しましたが、この表示の件は別の原因の可能性が高いです。APIと表示側を切り分けて調査します。' });
          st.mark('bug2Ack', '表示不具合を別原因として調査を約束');
          st.counters.asksAnswered++;
          slack().npcPost(DM_TAKASE, 'takase', 'お願いします！ユーザーには「調査中」と案内しておきますね。', 1.2);
        },
      });
      chips.push({
        label: '「さっきの障害の余波だと思います。様子を見てください」',
        run() {
          slack().post(DM_TAKASE, { from: 'me', body: '先ほどの障害でキャッシュが不安定になっていた可能性があります。しばらく様子を見てもらえますか。' });
          st.mark('bug2Ack', '表示不具合への反応');
          st.mark('bug2Deferred', '表示不具合を「障害の余波」として様子見にした');
          st.counters.asksAnswered++;
          slack().npcPost(DM_TAKASE, 'takase', '……そうですか。再発したら、ユーザーには何と説明すればいいでしょう？', 1.5);
        },
      });
    }

    return chips;
  }

  function composeStatusUpdate() {
    const m = IS.metrics.now;
    const f = st.flags;
    const done = [];
    if (f.wafTargeted) done.push('特定したクローラーへのWAFレート制限');
    if (f.wafBlind) done.push('WAFでの広域アクセス制限');
    if (featureFlags.search_maintenance) done.push('検索機能の一時停止（メンテナンス表示）');
    if (featureFlags.search_degraded) done.push('検索の縮退運転');
    if (f.retryReduced) done.push('wwwのリトライ削減');
    if (st.marked('workersRecovered')) done.push('応答不能だったAPIサーバーの再起動');
    if (f.logCleaned) done.push('api-03の肥大化ログの整理');
    if (f.pagecapDeployed) done.push('検索ページ上限のデプロイ');
    if (f.dbIndexAdded) done.push('検索用インデックスの追加');
    const sev = IS.metrics.impact();
    return `【経過 ${IS.clock.fmt(IS.clock.gm)}】\n状態: ${sev === 'ok' ? '主要メトリクスは正常範囲' : sev === 'warn' ? '遅延が継続（改善傾向の確認中）' : 'エラー多発が継続'}（CPU ${Math.round(m.cpu)}% / DB ${Math.round(m.db)}/500 / 5xx ${m.err.toFixed(1)}% / p90 ${IS.metrics.fmtLat(m.lat)}）\n実施済み: ${done.length ? done.join('、') : 'まだ有効な対策を打てていません（調査中）'}\n次のアクション: ${nextActionHint()}`;
  }

  function nextActionHint() {
    const f = st.flags;
    if (!f.crawlerContained && !f.wafTargeted) return '負荷源の特定と流入制御';
    if (f.stuckWorkers) return '応答不能サーバーの復旧';
    if (!f.pagecapDeployed && !f.dbIndexAdded) return '再発防止のための構造対策（検索クエリの軽量化）';
    return '安定稼働の監視';
  }

  function declare(kind) {
    st.flag('declared', true);
    st.flag('declaredKind', kind);
    st.flags.declaredGm = IS.clock.gm;
    st.mark('declared', kind === 'observed'
      ? '数値の根拠を添えて復旧を報告し、経過観察を宣言'
      : '経過観察なしで即座に復旧を宣言');
    st.flags.recoveredAtGm = IS.clock.gm;
    if (kind === 'observed') {
      st.addParams({ orgTrust: 6 });
      slack().npcPost(CH_INC, 'obayashi', '了解。数字が添えてあると経営層にそのまま説明できて助かる。', 1.5);
    } else {
      st.addParams({ fatigue: -4 });
      slack().npcPost(CH_INC, 'kinoshita', '復旧ありがとうございます！お客様にも伝えます！', 1);
    }
    IS.bus.emit('chips-changed');
  }

  /* ============================================================
     @メンション（人を選んで状況を聞く）
     ============================================================ */
  const ASK_TOPICS = {
    takase: [
      {
        id: 't-detail', label: '問い合わせの詳細を教えてください',
        when: () => true,
        run(ch) {
          st.counters.asksAnswered += 0;
          slack().npcPost(ch, 'takase', 'ユーザーは「東京都で検索したのに埼玉県の店舗が混ざっていた」と。発生は今朝9時すぎ、毎回ではないそうです。スクリーンショットは #atlas-dev に貼ってあります。', 1.2);
          st.mark('askedDetail', '高瀬さんに問い合わせの詳細をヒアリング');
        },
      },
      {
        id: 't-notice', label: 'ユーザーへの告知をお願いできますか',
        when: () => st.has('incident') && !st.has('declared'),
        run(ch) {
          slack().npcPost(ch, 'takase', '承知しました。トップページのお知らせ欄に「現在つながりにくい状況」の告知を出します。文言はCSと合わせますね。', 1.2);
          st.mark('userNotice', 'サイト上のユーザー告知を手配');
          st.addParams({ userTrust: 3 });
        },
      },
    ],
    ito: [
      {
        id: 'i-help', label: '調査を手伝ってもらえますか（何から見るべき？）',
        when: () => st.has('incident'),
        run(ch) {
          slack().npcPost(ch, 'ito', 'まず「DBで何が詰まってるか」ですね。ターミナルから mysql で `SHOW PROCESSLIST` を。あと発信元の特定は CloudWatch Logs Insights の「User-Agent別集計」が早いです。負荷の正体が分かるまで、大きな変更はしないほうがいいですよ。', 1.5);
          st.mark('itoHinted', '伊藤さんに調査の方針を相談');
        },
      },
      {
        id: 'i-ddl', label: '本番DBにインデックスを直接足すのはアリですか？',
        when: () => st.has('incident'),
        run(ch) {
          slack().npcPost(ch, 'ito', '効果は大きいですが賭けです。2023年に本番DDLがメタデータロックと衝突して全クエリが止まった事故があります。やるなら必ず EXPLAIN で実行計画を確認して、実行中のクエリが落ち着いたタイミングで。個人的には、まずアプリ側（ページ上限）が安全だと思います。', 1.5);
          st.flag('knowDdlRisk');
          st.mark('askedDdl', '本番DDLのリスクを事前に相談');
        },
      },
      {
        id: 'i-template', label: '「別地域が混ざる」表示不具合、心当たりあります？',
        when: () => st.marked('bug2Reported') !== null || st.marked('ack') !== null,
        run(ch) {
          slack().npcPost(ch, 'ito', 'APIが正しいなら www 側ですね。何年か前のデザイン変更で「近隣エリアのおすすめ」を検索結果の下に足したんですが、あのへんのテンプレートは怪しいです。`repo grep array_merge` してみてください。', 1.5);
          st.mark('itoTemplateHint', '伊藤さんから表示不具合のヒントを得た');
        },
      },
    ],
    mori: [
      {
        id: 'm-impact', label: '問い合わせの状況（件数・内容）を教えてください',
        when: () => st.has('incident'),
        run(ch) {
          slack().npcPost(ch, 'mori', `現時点で${Math.min(60, 8 + Math.round((IS.clock.gm - INCIDENT_GM) * 1.2))}件です。内訳は「検索が開かない」が6割、「予約確定でエラー」が3割。件数はまだ増えています。ユーザー向けの案内文があると助かります！`, 1.2);
          st.mark('askedImpact', 'CSへ問い合わせ状況をヒアリング（影響範囲の把握）');
        },
      },
    ],
    kinoshita: [
      {
        id: 'k-clients', label: '大口のお客様の状況を教えてください',
        when: () => st.has('incident'),
        run(ch) {
          slack().npcPost(ch, 'kinoshita', '3社から問い合わせが来ています。特にA社は今日キャンペーン初日で、予約が入らないと広告費が丸損だと……。「いつ直るか」を何より聞かれます。', 1.2);
          st.mark('askedClients', '営業へ顧客影響をヒアリング');
        },
      },
    ],
    obayashi: [
      {
        id: 'o-report', label: '現状を報告する（経営層向けの要約を渡す）',
        when: () => st.has('incident'),
        run(ch) {
          slack().post(ch, { from: 'me', body: '@大林 修 経営層向けの要約です。\n' + composeStatusUpdate() });
          slack().npcPost(ch, 'obayashi', 'ありがとう、これで説明できる。判断に迷ったら遠慮なく相談して。止める判断ならおれが責任を持つ。', 1.5);
          st.mark('escalated', 'マネージャーへ整理された報告を実施');
          st.counters.updates++;
          st.addParams({ orgTrust: 5 });
        },
      },
      {
        id: 'o-decision', label: '「検索停止」の判断について相談したい',
        when: () => st.has('incident') && !featureFlags.search_maintenance,
        run(ch) {
          slack().npcPost(ch, 'obayashi', '事業影響はあるが、全面ダウンよりマシだ。必要だと思うなら止めていい。そのかわり、止めたことと理由をこのチャンネルに残しておいてくれ。', 1.5);
          st.mark('consultedStop', '機能停止の判断をマネージャーと合意');
        },
      },
    ],
  };

  IS.bus.on('slack-mention-picker', ({ chId }) => {
    const body = el('div');
    body.appendChild(el('p', '', '誰にメンションしますか？'));
    const list = el('div', 'opt-list');
    for (const [pid, p] of Object.entries(IS.PEOPLE)) {
      if (p.role === 'bot' || pid === 'system') continue;
      const topics = (ASK_TOPICS[pid] || []).filter((t) => t.when());
      const b = el('button', 'opt-item');
      b.innerHTML = `<span class="opt-label">@${esc(p.name)} <span style="color:var(--dim);font-weight:400">${esc(p.role)}</span></span>
        <span class="opt-desc">${topics.length ? topics.map((t) => '・' + t.label).join('<br>') : '（今は聞けることがありません）'}</span>`;
      b.disabled = !topics.length;
      b.onclick = () => {
        close();
        pickTopic(pid, topics, chId);
      };
      list.appendChild(b);
    }
    body.appendChild(list);
    const { close } = IS.modal({ title: 'メンバーに状況を聞く', bodyEl: body, actions: [{ label: 'キャンセル' }] });
  });

  function pickTopic(pid, topics, chId) {
    const p = IS.PEOPLE[pid];
    const body = el('div');
    const list = el('div', 'opt-list');
    for (const t of topics) {
      const b = el('button', 'opt-item');
      b.innerHTML = `<span class="opt-label">${esc(t.label)}</span>`;
      b.onclick = () => {
        close();
        slack().post(chId, { from: 'me', body: `@${p.name} ${t.label}` });
        st.counters.mentionsSent = (st.counters.mentionsSent || 0) + 1;
        st.mark(`ask-${t.id}!`, `@${p.name} へ確認: ${t.label}`);
        t.run(chId);
      };
      list.appendChild(b);
    }
    body.appendChild(list);
    const { close } = IS.modal({ title: `@${p.name} に聞く`, bodyEl: body, actions: [{ label: 'キャンセル' }] });
  }

  /* ---- 自由入力のルーティング ---- */
  IS.bus.on('slack-send', ({ chId, text }) => {
    const low = text.toLowerCase();
    /* メンション付き自由入力 → 該当者の話題にキーワードマッチ */
    for (const [pid, p] of Object.entries(IS.PEOPLE)) {
      if (!text.includes(p.name.split(' ')[0]) && !text.includes(`@${p.name}`)) continue;
      const topics = (ASK_TOPICS[pid] || []).filter((t) => t.when());
      if (topics.length) {
        topics[0].run(chId);
        st.counters.mentionsSent = (st.counters.mentionsSent || 0) + 1;
        return;
      }
    }
    /* インシデントチャンネルへのまとまった発言は「経過共有」として扱う */
    if (chId === CH_INC && text.length >= 20 && st.has('incident') && !st.has('declared')) {
      st.counters.updates++;
      lastUpdateGm = IS.clock.gm;
      st.mark(`update-free-${Math.round(IS.clock.gm)}!`, '経過を共有（自由入力）');
      if (Math.random() < 0.6) slack().npcPost(chId, IS.pick(['obayashi', 'mori', 'takase']), IS.pick(['把握しました。', 'ありがとうございます、その方向でお願いします。', '共有ありがとうございます！']), 1.2);
      return;
    }
    /* その他は軽い相槌 */
    if (Math.random() < 0.4 && st.has('incident')) {
      slack().npcPost(chId, IS.pick(['ito', 'obayashi']), IS.pick(['ですね。', '👍', '把握です。']), 1.5, { quiet: true });
    }
  });

  /* ============================================================
     終了処理
     ============================================================ */
  IS.bus.on('service-dead', () => endShift('dead'));
  IS.bus.on('timeup', () => endShift('timeout'));

  function endShift(reason) {
    if (st.over) return;
    st.over = true;
    st.overReason = reason;
    IS.clock.stop();
    IS.report.finish(reason);
  }

  /* ============================================================
     起動
     ============================================================ */
  IS.scenario = {
    start() {
      st.started = true;
      IS.metrics.init();
      setupChannels();
      setupTimeline();
      slack().setChipsProvider(chipsFor);
      IS.wm.open('slack');
      IS.clock.start();

      /* 冒頭のガイド（世界観を壊さない程度に） */
      setTimeout(() => {
        IS.notify('slack', { title: 'Atlas Ops Desktop', body: 'シフト開始。下のドックからアプリを行き来できます。まずはSlackを確認。', icon: '🗻' });
      }, 1200);
    },
    endShift,
    canDeclare,
    CH_INC, CH_DEV, CH_ALERT, DM_TAKASE,
  };

  /* メニューバーの振り返りボタン */
  document.addEventListener('DOMContentLoaded', () => {
    IS.$('#mb-postmortem').onclick = () => {
      if (!st.has('postmortemReady')) return;
      IS.report.startMeeting();
    };
  });
})();
