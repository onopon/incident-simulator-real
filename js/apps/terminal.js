/* ============================================================
   INCIDENT: 02:17 REAL ― ターミナルアプリ
   ssh / mysql / deployctl / repo などの調査・作業コマンドを再現
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;

  let scrollEl = null, inputEl = null, ps1El = null, hintsEl = null;
  let ctx = { mode: 'local', host: null }; // local | ssh | mysql
  let busy = false;
  const history = [];
  let histIdx = -1;

  const HOSTS = ['api-production-01', 'api-production-02', 'api-production-03', 'api-production-04', 'api-production-05', 'api-production-06', 'www-production-01', 'www-production-02'];

  function ps1() {
    if (ctx.mode === 'ssh') return `[ops@${ctx.host} ~]$ `;
    if (ctx.mode === 'mysql') return 'mysql> ';
    return 'you@ops-macbook ~ % ';
  }
  function ps1Cls() { return ctx.mode === 'ssh' ? 'remote' : ctx.mode === 'mysql' ? 'mysql' : ''; }

  function print(text, cls = '') {
    const line = el('div', `term-line ${cls}`);
    line.textContent = text;
    scrollEl.appendChild(line);
    scrollEl.scrollTop = scrollEl.scrollHeight;
    return line;
  }
  function printHtml(html, cls = '') {
    const line = el('div', `term-line ${cls}`, html);
    scrollEl.appendChild(line);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
  function echoCmd(cmd) {
    printHtml(`<span class="t-prompt ${ps1Cls()}">${esc(ps1())}</span>${esc(cmd)}`);
  }

  /* 行を順番に出力（リアル感のためのディレイ付き）。busy中の入力は先行入力として実行待ちに積む */
  const typeahead = [];
  function stream(lines, done, msPerLine = 40) {
    busy = true;
    let i = 0;
    const step = () => {
      if (i >= lines.length) {
        busy = false;
        refreshHints();
        done && done();
        drainTypeahead();
        return;
      }
      const l = lines[i++];
      if (typeof l === 'string') print(l);
      else print(l.text, l.cls);
      setTimeout(step, l && l.wait ? l.wait : msPerLine);
    };
    step();
  }
  function drainTypeahead() {
    if (busy || !typeahead.length) return;
    exec(typeahead.shift());
  }

  /* ---------------- コマンド実装 ---------------- */
  function exec(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    echoCmd(cmd);
    history.push(cmd);
    histIdx = history.length;
    const low = cmd.toLowerCase().replace(/;+\s*$/, '');

    if (low === 'clear') { scrollEl.innerHTML = ''; return; }

    if (ctx.mode === 'mysql') return execMysql(cmd, low);
    if (ctx.mode === 'ssh') return execSsh(cmd, low);
    return execLocal(cmd, low);
  }

  /* ----- ローカル ----- */
  function execLocal(cmd, low) {
    const st = IS.state;

    if (low === 'help') {
      stream([
        { text: '利用できる主なコマンド:', cls: 't-dim' },
        '  ssh <host>            本番サーバーへ接続 (例: ssh api-production-03)',
        '  mysql                 本番DB (atlas-mysql-prd) へ接続',
        '  deployctl list        デプロイ可能なジョブの一覧',
        '  deployctl run <job>   デプロイの実行',
        '  repo grep <keyword>   アプリのソースコードを検索',
        '  repo show <path>      ソースファイルの表示',
        '  curl <url>            APIレスポンスの確認',
        '  clear / help',
      ]);
      return;
    }
    if (low === 'ls') { print('memo.txt  runbooks/  screenshots/'); return; }
    if (low === 'whoami') { print('ops-engineer'); return; }
    if (low === 'date') { print(`Mon Jul  6 ${IS.clock.fmt(IS.clock.gm)}:00 JST 2026`); return; }

    let m = cmd.match(/^ssh\s+(\S+)/i);
    if (m) {
      const host = m[1].replace(/^.*@/, '');
      const target = HOSTS.find((h) => h === host || h.startsWith(host));
      if (!target) { print(`ssh: Could not resolve hostname ${host}: Name or service not known`, 't-err'); return; }
      stream([
        { text: `Connecting via bastion.atlas.internal ...`, cls: 't-dim', wait: 350 },
        { text: `Warning: Permanently added '${target}' (ED25519) to the list of known hosts.`, cls: 't-dim', wait: 250 },
        `Last login: Mon Jul  6 08:12:44 2026 from bastion`,
        { text: `※ このサーバーは15年運用の \"手作業世代\" です。ログの一部はCloudWatchに送られず、ローカルにのみ存在します。`, cls: 't-warn' },
      ], () => {
        ctx = { mode: 'ssh', host: target };
        updatePrompt();
        if (target === 'api-production-03') st.mark('ssh03', 'api-production-03 へSSHで入って調査');
      });
      return;
    }

    if (low === 'mysql' || low.startsWith('mysql ')) {
      stream([
        { text: 'Welcome to the MySQL monitor.  Commands end with ;', cls: 't-dim', wait: 300 },
        { text: `Server version: 8.0.36 MySQL Community Server  (atlas-mysql-prd)`, cls: 't-dim' },
        { text: `※ 本番DBです。更新系のクエリ・DDLは影響を十分に確認してから実行してください。`, cls: 't-warn' },
      ], () => { ctx = { mode: 'mysql', host: null }; updatePrompt(); });
      return;
    }

    if (low === 'deployctl' || low === 'deployctl list') {
      const jobs = IS.ops.deployJobs();
      const lines = [{ text: 'deployctl ― Atlas デプロイパイプライン', cls: 't-dim' }];
      if (!jobs.length) lines.push('  実行可能なジョブはありません（調査で得た情報に応じてジョブが増えます）');
      for (const j of jobs) {
        lines.push(`  ${j.id.padEnd(14)} ${j.desc}${j.done ? '  [デプロイ済み]' : ''}`);
      }
      lines.push({ text: '  使い方: deployctl run <job>', cls: 't-dim' });
      stream(lines);
      return;
    }
    m = cmd.match(/^deployctl\s+run\s+(\S+)/i);
    if (m) {
      const job = IS.ops.deployJobs().find((j) => j.id === m[1]);
      if (!job) { print(`deployctl: ジョブ '${m[1]}' が見つかりません。deployctl list で確認してください。`, 't-err'); return; }
      if (job.done) { print(`deployctl: '${job.id}' はすでにデプロイ済みです。`, 't-warn'); return; }
      runDeploy(job);
      return;
    }

    m = cmd.match(/^repo\s+grep\s+(.+)/i);
    if (m) return repoGrep(m[1].trim());
    m = cmd.match(/^repo\s+show\s+(.+)/i);
    if (m) return repoShow(m[1].trim());
    if (low.startsWith('repo')) { print('使い方: repo grep <keyword> / repo show <path>', 't-dim'); return; }

    if (low.startsWith('curl')) {
      if (cmd.includes('api.internal') || cmd.includes('/shops')) {
        stream([
          { text: '$ GET https://api.internal/shops?area_id=13&category_id=4', cls: 't-dim', wait: 500 },
          '{ "total": 8, "shops": [',
          '  {"id": 3021, "name": "和食処 やまびこ 銀座本店", "area_id": 13},',
          '  {"id": 2988, "name": "Trattoria Lupo 恵比寿",   "area_id": 13},',
          '  ... (すべて area_id: 13)',
          '] }',
          { text: '→ APIは東京都(area_id=13)の店舗だけを正しく返している。問題はAPIではなく www 側の表示か？', cls: 't-ok' },
        ], () => IS.state.mark('apiChecked', 'curlでAPIレスポンスが正しいことを確認（問題はwww側と切り分け）'));
        return;
      }
      print(`curl: (6) Could not resolve host。ヒント: curl "https://api.internal/shops?area_id=13&category_id=4"`, 't-err');
      return;
    }

    if (low === 'exit') { print('logout'); return; }
    print(`zsh: command not found: ${cmd.split(/\s+/)[0]}（help でコマンド一覧）`, 't-err');
  }

  /* ----- ssh先 ----- */
  function execSsh(cmd, low) {
    const st = IS.state;
    const is03 = ctx.host === 'api-production-03';
    const disk = is03 ? Math.round(IS.metrics.now.disk03) : 44 + (ctx.host.charCodeAt(15) % 20);

    if (low === 'exit' || low === 'logout') {
      print('logout'); print(`Connection to ${ctx.host} closed.`, 't-dim');
      ctx = { mode: 'local', host: null }; updatePrompt(); return;
    }
    if (low === 'help') {
      stream(['df -h / du -sh /var/log/atlas / ls /var/log/atlas / tail /var/log/atlas/api.log / top / sudo logrotate-atlas / exit']);
      return;
    }
    if (low.startsWith('df')) {
      stream([
        'Filesystem      Size  Used Avail Use% Mounted on',
        `/dev/xvda1       50G   ${Math.round(disk / 2)}G  ${Math.round((100 - disk) / 2)}G  ${disk}% /`,
        'tmpfs           7.8G     0  7.8G   0% /dev/shm',
      ], () => { if (is03 && disk >= 85) st.mark('sawDisk', 'df -h でディスク逼迫を確認'); });
      return;
    }
    if (low.includes('ls') && low.includes('/var/log/atlas')) {
      stream(is03 ? [
        '-rw-r--r-- 1 atlas atlas  38G Jul  6 ' + IS.clock.fmt(IS.clock.gm) + ' api.log',
        '-rw-r--r-- 1 atlas atlas 1.2G Jul  5 23:59 api.log-20260705.gz',
        '-rw-r--r-- 1 atlas atlas 890M Jul  4 23:59 api.log-20260704.gz',
      ] : [
        '-rw-r--r-- 1 atlas atlas 2.1G Jul  6 ' + IS.clock.fmt(IS.clock.gm) + ' api.log',
        '-rw-r--r-- 1 atlas atlas 940M Jul  5 23:59 api.log-20260705.gz',
      ]);
      return;
    }
    if (low.startsWith('du')) {
      stream([is03 ? '40G\t/var/log/atlas' : '3.1G\t/var/log/atlas']);
      return;
    }
    if (low.startsWith('tail')) {
      if (is03 && !st.has('logCleaned')) {
        stream([
          { text: '==> /var/log/atlas/api.log <==', cls: 't-dim' },
          'WARNING: Undefined index: campaign_type in /var/www/atlas-api/app/Controllers/ShopSearchController.php on line 1847',
          'WARNING: Undefined index: campaign_type in /var/www/atlas-api/app/Controllers/ShopSearchController.php on line 1847',
          'WARNING: Undefined index: campaign_type in /var/www/atlas-api/app/Controllers/ShopSearchController.php on line 1847',
          'WARNING: Undefined index: campaign_type in /var/www/atlas-api/app/Controllers/ShopSearchController.php on line 1847',
          { text: '（同じ警告が毎秒数百行のペースで書き込まれている）', cls: 't-warn' },
          { text: '→ 検索結果1件ごとに警告が出るコード。クローラーの大量アクセスが警告ログを数十GBまで肥大化させ、ディスクとI/Oを食い潰している。', cls: 't-ok' },
        ], () => st.mark('sawLogSpam', 'tailで警告ログの洪水を発見（ディスク肥大の根本を特定）'));
      } else {
        stream([
          { text: '==> /var/log/atlas/api.log <==', cls: 't-dim' },
          `[${IS.clock.fmt(IS.clock.gm)}] INFO request_id=af1c92 GET /shops 200 84ms`,
          `[${IS.clock.fmt(IS.clock.gm)}] INFO request_id=af1c93 GET /plans 200 41ms`,
        ]);
      }
      return;
    }
    if (low === 'top') {
      const stuck = is03 && st.has('stuckWorkers') && !st.has(`rebooted-${ctx.host}`);
      stream([
        'Tasks: 213 total,   2 running, 211 sleeping',
        `%Cpu(s): ${Math.round(IS.metrics.now.cpu)} us,  6 sy`,
        'MiB Mem :  15843 total,   ' + (stuck ? '412' : '9210') + ' free',
        '  PID USER   %CPU %MEM  COMMAND',
        stuck ? ' 2117 atlas   0.0 41.2  php-fpm: pool www (D state / 応答なし)' : ' 2117 atlas  12.4  8.1  php-fpm: pool www',
        stuck ? ' 2118 atlas   0.0 38.9  php-fpm: pool www (D state / 応答なし)' : ' 2118 atlas   9.8  7.7  php-fpm: pool www',
      ], () => { if (stuck) st.mark('sawStuck', 'topで応答不能のワーカープロセスを確認'); });
      return;
    }
    if (low.includes('logrotate') || low.includes('logclean')) {
      if (!is03) { print('sudo: logrotate-atlas: このホストのログは正常サイズです。', 't-warn'); return; }
      if (st.has('logCleaned')) { print('すでにローテーション済みです。', 't-dim'); return; }
      stream([
        { text: 'sudo logrotate-atlas: /var/log/atlas/api.log (38G) を圧縮・退避します…', cls: 't-dim', wait: 900 },
        { text: 'ログレベルを一時的に WARNING → ERROR に変更しました（Undefined index の出力を抑制）', wait: 900 },
        { text: '完了: ディスク使用率 94% → 71%', cls: 't-ok' },
        { text: '※ これは応急処置です。警告を出しているコード自体は残っています。', cls: 't-warn' },
      ], () => {
        st.flag('logCleaned');
        st.mark('logCleaned', 'api-03の肥大化したログを圧縮・抑制（ディスク解放）');
        st.addParams({ debt: 3 });
        IS.sound.ok();
      });
      return;
    }
    print(`bash: ${cmd.split(/\s+/)[0]}: command not found（help で一覧）`, 't-err');
  }

  /* ----- mysql ----- */
  function execMysql(cmd, low) {
    const st = IS.state;
    if (low === 'exit' || low === 'quit' || low === '\\q') {
      print('Bye'); ctx = { mode: 'local', host: null }; updatePrompt(); return;
    }
    if (low.startsWith('show processlist') || low.startsWith('show full processlist')) {
      const storm = st.has('incident') && !st.has('crawlerBlocked') && !IS.ops.featureFlag('search_maintenance');
      if (storm) {
        stream([
          '+------+-------+-----------+-------+---------+------+--------------+------------------------------------------+',
          '| Id   | User  | Host      | db    | Command | Time | State        | Info                                     |',
          '+------+-------+-----------+-------+---------+------+--------------+------------------------------------------+',
          '|  912 | atlas | api-01    | atlas | Query   |    6 | Sending data | SELECT shops.* FROM shops INNER JOIN ... |',
          '|  913 | atlas | api-02    | atlas | Query   |    4 | Sending data | SELECT shops.* FROM shops INNER JOIN ... |',
          '|  915 | atlas | api-04    | atlas | Query   |    8 | Sorting result | SELECT shops.* FROM shops INNER JOIN . |',
          { text: '   ...（同一形式のクエリが 388 件、実行時間 2〜8 秒）', cls: 't-warn' },
          '+------+-------+-----------+-------+---------+------+--------------+------------------------------------------+',
          '',
          { text: '典型的なクエリ:', cls: 't-dim' },
          '  SELECT shops.* FROM shops',
          '  INNER JOIN shop_plans ON shop_plans.shop_id = shops.id',
          "  WHERE shops.area_id = ? AND shop_plans.category_id = ? AND shops.status = 'published'",
          '  ORDER BY shops.popularity_score DESC LIMIT 30 OFFSET 29610;',
          { text: '→ OFFSETの値が異様に大きい。深いページまで機械的にめくられている。EXPLAINで実行計画を見る価値がある。', cls: 't-ok' },
        ], () => st.mark('processlist', 'SHOW PROCESSLISTで詰まっている検索クエリを特定'));
      } else {
        stream([
          '| Id | User  | Command | Time | Info             |',
          `|  12 | atlas | Sleep   |    2 | NULL             |`,
          `|  14 | atlas | Query   |    0 | SELECT ... (速い) |`,
          { text: `実行中クエリ: ${Math.round(IS.metrics.now.db / 14)} 件（落ち着いています）`, cls: 't-dim' },
        ]);
      }
      return;
    }
    if (low.startsWith('explain')) {
      stream([
        '+----+-------------+-------+------+---------------+------+---------+------+---------+----------------------------------------------+',
        '| id | select_type | table | type | possible_keys | key  | rows    | Extra                                        |',
        '+----+-------------+-------+------+---------------+------+---------+------+---------+----------------------------------------------+',
        '|  1 | SIMPLE      | shops | ALL  | idx_area      | NULL | 2941820 | Using where; Using temporary; Using filesort |',
        '+----+-------------+-------+------+---------------+------+---------+------+---------+----------------------------------------------+',
        { text: '→ area_id + status + popularity_score を効率的に処理できる複合インデックスが存在しない。', cls: 't-warn' },
        { text: '→ 約294万行をスキャンして毎回ソートしている。深いOFFSETと組み合わさると致命的。', cls: 't-warn' },
        { text: '→ アプリ側の対策ジョブが deployctl に追加されました（pagecap）。', cls: 't-ok' },
      ], () => {
        st.mark('explain', 'EXPLAINでインデックス不足と全行スキャンを特定');
        st.flag('knowExplain');
        IS.bus.emit('chips-changed');
      });
      return;
    }
    if (low.includes('max_connections')) {
      stream(["| max_connections | 500 |", { text: `現在の接続数: ${Math.round(IS.metrics.now.db)}`, cls: 't-dim' }]);
      return;
    }
    if (low.startsWith('select count')) {
      stream(['+----------+', '| count(*) |', '+----------+', '|  2941820 |', '+----------+', '1 row in set (3.42 sec)']);
      return;
    }
    if (low.startsWith('alter table')) {
      IS.ops.alterTable(print, stream);
      return;
    }
    if (low.startsWith('show')) { print('Empty set (0.00 sec)', 't-dim'); return; }
    print(`ERROR 1064 (42000): You have an error in your SQL syntax near '${cmd.slice(0, 30)}'`, 't-err');
  }

  /* ----- repo ----- */
  function repoGrep(kw) {
    const k = kw.toLowerCase().replace(/["']/g, '');
    if (k.includes('array_merge') || k.includes('merge')) {
      stream([
        { text: `atlas-www で "array_merge" を検索中…`, cls: 't-dim', wait: 500 },
        'app/views/search/index.php:214:  $shops = $searchResult->shops;',
        'app/views/search/index.php:262:  $shops = array_merge($shops, $recommendedNearbyShops); // 近隣おすすめ表示 (2019年デザイン変更)',
        'app/helpers/plan_helper.php:88:   $tags = array_merge($tags, $seasonTags);',
        { text: '→ search/index.php: 検索結果と「近隣エリアのおすすめ店舗」を同じ変数にマージしている。repo show app/views/search/index.php で確認。', cls: 't-ok' },
      ]);
      return;
    }
    if (k.includes('cache_key') || k.includes('cache')) {
      stream([
        { text: `atlas-api で "cache_key" を検索中…`, cls: 't-dim', wait: 500 },
        'app/Controllers/ShopSearchController.php:1203:  $cacheKey = $this->buildCacheKey($conditions);',
        'app/Controllers/ShopSearchController.php:1391:  $conditions["area_id"] = $sessionArea; // FIXME',
        '（ほか 34 ファイル・112 箇所）',
        { text: '→ ShopSearchController.php は 3,842行・searchAction() は611行・テストなし。キャッシュキー生成の後にも検索条件が書き換えられている。', cls: 't-warn' },
      ], () => IS.state.mark('sawFatController', 'ソースを読み611行のsearchAction()と設計の歪みを把握'));
      return;
    }
    if (k.includes('area')) {
      stream(['app/views/search/index.php:214（検索結果の描画）', 'app/Controllers/ShopSearchController.php（多数）', { text: 'ヒント: repo grep array_merge', cls: 't-dim' }]);
      return;
    }
    print(`repo grep: '${kw}' に一致するコードは見つかりませんでした（例: repo grep array_merge / repo grep cache_key）`, 't-dim');
  }

  function repoShow(path) {
    if (path.includes('search/index.php') || path.includes('search')) {
      stream([
        { text: '--- atlas-www/app/views/search/index.php（抜粋） ---', cls: 't-dim' },
        ' 210 | // 検索APIのレスポンスから店舗一覧を組み立てる',
        ' 214 | $shops = $searchResult->shops;',
        ' ... |',
        ' 258 | // 2019年デザイン変更: 検索結果の下に近隣おすすめを表示',
        ' 260 | $recommendedNearbyShops = $recommender->fetchNearby($area, 3);',
        ' 262 | $shops = array_merge($shops, $recommendedNearbyShops); // ★同じ変数に追加している',
        ' ... |',
        ' 301 | foreach ($shops as $shop): // ← 検索結果とおすすめが区別されずに描画される',
        { text: '→ 真因を特定: 「近隣おすすめ」取得の条件を満たしたユーザーだけ、検索結果一覧に別地域の店舗が混ざって見える。', cls: 't-ok' },
        { text: '→ deployctl に修正ジョブ fix-template が追加されました。', cls: 't-ok' },
      ], () => {
        IS.state.mark('foundTemplate', '表示不具合の真因（テンプレートのarray_merge混入）を特定');
        IS.state.flag('foundTemplate');
        IS.bus.emit('chips-changed');
      });
      return;
    }
    print(`repo show: ファイルが見つかりません: ${path}`, 't-err');
  }

  /* ----- デプロイ ----- */
  function runDeploy(job) {
    const lines = [
      { text: `deployctl: ジョブ '${job.id}' を開始します（${job.desc}）`, cls: 't-dim', wait: 600 },
      { text: `[1/4] ブランチ ${job.branch} をビルド中…`, wait: 1400 },
      { text: `[2/4] テスト実行中… ${job.tests}`, wait: 1800 },
      { text: `[3/4] ステージングで検証中…`, wait: 1600 },
      { text: `[4/4] 本番へローリングデプロイ中… (6台を2台ずつ)`, wait: 2200 },
    ];
    stream(lines, () => {
      IS.clock.afterGm(job.gmCost || 1.5, () => {
        print(`✔ deploy 完了: ${job.id}`, 't-ok');
        IS.sound.ok();
        job.after();
        refreshHints();
      });
      print('   （デプロイ進行中… 完了までしばらくかかります）', 't-dim');
    });
  }

  /* ---------------- ヒントチップ ---------------- */
  function refreshHints() {
    if (!hintsEl) return;
    const st = IS.state;
    let hints = [];
    if (ctx.mode === 'local') {
      hints = ['help', 'mysql', 'ssh api-production-03', 'deployctl list'];
      if (st.has('apiChecked') && !st.has('foundTemplate')) hints.push('repo grep array_merge');
      if (st.marked('bug2Reported') && !st.has('apiChecked')) hints.push('curl "https://api.internal/shops?area_id=13&category_id=4"');
    } else if (ctx.mode === 'ssh') {
      hints = ['df -h', 'ls /var/log/atlas', 'tail /var/log/atlas/api.log', 'top', 'exit'];
      if (ctx.host === 'api-production-03' && st.has('sawLogSpam') && !st.has('logCleaned')) hints.push('sudo logrotate-atlas');
    } else if (ctx.mode === 'mysql') {
      hints = ['SHOW PROCESSLIST;', 'EXPLAIN SELECT shops.* FROM shops INNER JOIN shop_plans ...;', "SHOW VARIABLES LIKE 'max_connections';", 'exit'];
    }
    hintsEl.innerHTML = '';
    for (const h of hints) {
      const b = el('button', 'term-hint', esc(h));
      b.onclick = () => { inputEl.value = h; inputEl.focus(); };
      hintsEl.appendChild(b);
    }
  }

  function updatePrompt() {
    ps1El.textContent = ps1();
    ps1El.className = `term-ps1 ${ps1Cls()}`;
    refreshHints();
  }

  /* ---------------- アプリ登録 ---------------- */
  IS.wm.register('term', {
    title: 'ターミナル — ops',
    icon: '⬛',
    mount(body) {
      body.innerHTML = '';
      const app = el('div', 'term-app');
      scrollEl = el('div', 'term-scroll');
      const inputRow = el('div', 'term-inputrow');
      ps1El = el('span', 'term-ps1', ps1());
      inputEl = el('input', 'term-input');
      inputEl.autocomplete = 'off';
      inputEl.spellcheck = false;
      inputRow.append(ps1El, inputEl);
      hintsEl = el('div', 'term-hints');
      app.append(scrollEl, inputRow, hintsEl);
      body.appendChild(app);

      print('Atlas Ops Terminal ― 本番環境に接続しています。help でコマンド一覧。', 't-dim');
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { // IME変換確定のEnterは無視
          const v = inputEl.value;
          inputEl.value = '';
          if (busy) { if (v.trim()) typeahead.push(v); } // 先行入力（実ターミナル同様、前の出力後に実行される）
          else exec(v);
        } else if (e.key === 'ArrowUp') {
          if (histIdx > 0) { histIdx--; inputEl.value = history[histIdx] || ''; }
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          if (histIdx < history.length) { histIdx++; inputEl.value = history[histIdx] || ''; }
          e.preventDefault();
        } else if (e.key.length === 1) {
          IS.sound.key();
        }
      });
      app.addEventListener('click', (e) => { if (!e.target.closest('.term-hint')) inputEl.focus(); });
      refreshHints();
      IS.state.mark('termUsed', 'ターミナルを使用');
    },
  });

  IS.termApp = { print, refreshHints };
})();
