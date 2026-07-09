/* ============================================================
   INCIDENT: 02:17 REAL ― AWSコンソールアプリ
   （CloudWatch / EC2 / RDS / WAF）
   実際の操作は IS.ops（scenario.js）へ委譲する
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;

  let view = 'home';
  let mainEl = null;
  let charts = []; // {canvas, key, color, max, fmt, thresholds}

  const VIEWS = [
    { id: 'home', label: 'コンソールホーム' },
    { id: 'cw', label: 'CloudWatch', section: 'モニタリング' },
    { id: 'alarms', label: '└ アラーム' },
    { id: 'logs', label: '└ Logs Insights' },
    { id: 'ec2', label: 'EC2', section: 'コンピューティング' },
    { id: 'rds', label: 'RDS', section: 'データベース' },
    { id: 'waf', label: 'WAF & Shield', section: 'セキュリティ' },
  ];

  /* ---------------- チャート描画 ---------------- */
  function drawChart(c) {
    const canvas = c.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.clearRect(0, 0, w, h);

    const windowGm = 75; // 直近75ゲーム分
    const gmNow = IS.clock.gm;
    const data = IS.metrics.hist.filter((p) => p.gm >= gmNow - windowGm);
    if (data.length < 2) return;

    const max = c.max || Math.max(...data.map((p) => p[c.key])) * 1.25 || 1;
    const x = (gm) => ((gm - (gmNow - windowGm)) / windowGm) * w;
    const y = (v) => h - 8 - (Math.min(v, max) / max) * (h - 24);

    // グリッド
    ctx.strokeStyle = 'rgba(0,0,0,.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
    }
    // しきい値
    if (c.threshold) {
      ctx.strokeStyle = 'rgba(209, 50, 18, .5)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(0, y(c.threshold)); ctx.lineTo(w, y(c.threshold)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 塗り
    ctx.beginPath();
    ctx.moveTo(x(data[0].gm), y(data[0][c.key]));
    for (const p of data) ctx.lineTo(x(p.gm), y(p[c.key]));
    ctx.lineTo(x(data[data.length - 1].gm), h); ctx.lineTo(x(data[0].gm), h);
    ctx.closePath();
    ctx.fillStyle = c.color + '22';
    ctx.fill();
    // 線
    ctx.beginPath();
    ctx.moveTo(x(data[0].gm), y(data[0][c.key]));
    for (const p of data) ctx.lineTo(x(p.gm), y(p[c.key]));
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 現在値
    const nowV = data[data.length - 1][c.key];
    if (c.nowEl) {
      c.nowEl.textContent = c.fmt(nowV);
      c.nowEl.className = `aws-chart-now ${c.sev(nowV)}`;
    }
  }

  function chartCard(title, cfg) {
    const card = el('div', 'aws-chart');
    const head = el('div', 'aws-chart-title');
    head.appendChild(el('span', '', esc(title)));
    const now = el('span', 'aws-chart-now', '–');
    head.appendChild(now);
    const canvas = el('canvas');
    card.append(head, canvas);
    charts.push({ canvas, nowEl: now, ...cfg });
    return card;
  }

  /* ---------------- ビュー ---------------- */
  function vHome() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'コンソールのホーム'));
    box.appendChild(el('div', 'aws-crumb', 'AWS マネジメントコンソール'));
    const card = el('div', 'aws-card');
    card.appendChild(el('h4', '', '⭐ 最近アクセスしたサービス'));
    const list = el('div', 'opt-list');
    const items = [
      ['cw', '📈 CloudWatch', 'メトリクス・ダッシュボード・アラーム'],
      ['ec2', '🖥 EC2', 'インスタンス 9 台が実行中'],
      ['rds', '🛢 RDS', 'atlas-mysql-prd（MySQL 8.0）'],
      ['logs', '🔎 CloudWatch Logs Insights', 'ログの分析クエリ'],
      ['waf', '🛡 WAF & Shield', 'Web ACL: atlas-prod-acl'],
    ];
    for (const [id, label, desc] of items) {
      const b = el('button', 'opt-item');
      b.style.background = '#fff'; b.style.borderColor = '#d5dbdb'; b.style.color = '#16191f';
      b.innerHTML = `<span class="opt-label">${esc(label)}</span><span class="opt-desc" style="color:#687078">${esc(desc)}</span>`;
      b.onclick = () => nav(id);
      list.appendChild(b);
    }
    card.appendChild(list);
    box.appendChild(card);
    const note = el('div', 'aws-card');
    note.appendChild(el('h4', '', 'ℹ️ Atlas 本番アカウント'));
    note.appendChild(el('div', 'aws-note',
      'アカウント: atlas-production (4721-xxxx-xxxx) ／ リージョン: ap-northeast-1<br>' +
      '本番環境です。変更操作（再起動・スケール・WAFルール等）はサービスに即時反映されます。'));
    box.appendChild(note);
    return box;
  }

  function vCloudWatch() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'CloudWatch ダッシュボード'));
    box.appendChild(el('div', 'aws-crumb', 'CloudWatch > ダッシュボード > atlas-prod-overview（自動更新: 10秒）'));
    const grid = el('div', 'aws-chartgrid');
    grid.appendChild(chartCard('API CPUUtilization (%)', {
      key: 'cpu', color: '#e07941', max: 100, threshold: 85,
      fmt: (v) => `${v.toFixed(0)}%`, sev: (v) => v >= 80 ? 'crit' : v >= 60 ? 'warn' : 'ok',
    }));
    grid.appendChild(chartCard('RDS DatabaseConnections (max 500)', {
      key: 'db', color: '#3b48cc', max: 520, threshold: 450,
      fmt: (v) => `${v.toFixed(0)}`, sev: (v) => v >= 450 ? 'crit' : v >= 300 ? 'warn' : 'ok',
    }));
    grid.appendChild(chartCard('ALB HTTPCode_5XX (%)', {
      key: 'err', color: '#d13212', max: 40, threshold: 5,
      fmt: (v) => `${v.toFixed(1)}%`, sev: (v) => v >= 5 ? 'crit' : v >= 2 ? 'warn' : 'ok',
    }));
    grid.appendChild(chartCard('API p90 レイテンシ', {
      key: 'lat', color: '#1d8102', max: 10000, threshold: 3000,
      fmt: (v) => IS.metrics.fmtLat(v), sev: (v) => v >= 3000 ? 'crit' : v >= 1000 ? 'warn' : 'ok',
    }));
    grid.appendChild(chartCard('ALB RequestCount (req/min)', {
      key: 'reqs', color: '#687078', max: 1400,
      fmt: (v) => `${v.toFixed(0)}`, sev: () => 'ok',
    }));
    box.appendChild(grid);
    IS.state.mark('sawDashboard', 'CloudWatchダッシュボードを確認');
    return box;
  }

  function alarmDefs() {
    const m = IS.metrics.now;
    return [
      { name: 'api-prod-HighCPU', cond: 'CPUUtilization > 85% (5分)', on: m.cpu >= 85 },
      { name: 'rds-atlas-HighConnections', cond: 'DatabaseConnections > 450', on: m.db >= 450 },
      { name: 'alb-atlas-5xx-rate', cond: 'HTTPCode_ELB_5XX > 5%', on: m.err >= 5 },
      { name: 'api-prod-HighLatency-p90', cond: 'TargetResponseTime p90 > 3s', on: m.lat >= 3000 },
      { name: 'api-production-03-DiskUsage', cond: 'disk_used_percent > 90%', on: m.disk03 >= 90 },
      { name: 'alb-atlas-UnHealthyHostCount', cond: 'HealthyHostCount < 4', on: m.healthy < 4 },
    ];
  }

  function vAlarms() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'CloudWatch アラーム'));
    box.appendChild(el('div', 'aws-crumb', 'CloudWatch > アラーム'));
    const card = el('div', 'aws-card');
    card.id = 'aws-alarm-list';
    renderAlarms(card);
    box.appendChild(card);
    IS.state.mark('sawAlarms', 'CloudWatchアラームを確認');
    return box;
  }

  function renderAlarms(card) {
    card.innerHTML = '';
    const defs = alarmDefs();
    const active = defs.filter((d) => d.on).length;
    card.appendChild(el('h4', '', `🔔 アラーム（${active} 件がアラーム状態）`));
    for (const d of defs.sort((a, b) => Number(b.on) - Number(a.on))) {
      const row = el('div', 'aws-alarm');
      row.appendChild(el('span', `aws-alarm-state ${d.on ? 'alarm' : 'ok'}`, d.on ? 'ALARM' : 'OK'));
      row.appendChild(el('span', '', `<b>${esc(d.name)}</b> &nbsp; <span style="color:#687078">${esc(d.cond)}</span>`));
      card.appendChild(row);
    }
  }

  function vLogs() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'CloudWatch Logs Insights'));
    box.appendChild(el('div', 'aws-crumb', 'CloudWatch > Logs Insights ／ ロググループ: /atlas/alb-access, /atlas/api'));
    const card = el('div', 'aws-card');
    card.appendChild(el('h4', '', '🔎 クエリ'));
    const sel = el('select', 'aws-select');
    const queries = (IS.ops && IS.ops.logQueries) || [];
    for (const q of queries) {
      const o = el('option', '', esc(q.label));
      o.value = q.id;
      sel.appendChild(o);
    }
    const btn = el('button', 'aws-btn primary', 'クエリを実行');
    btn.style.marginLeft = '10px';
    const prog = el('div', 'aws-progress'); prog.style.display = 'none';
    const bar = el('div'); prog.appendChild(bar);
    const out = el('div', 'aws-logbox', 'クエリを選択して実行してください。');
    btn.onclick = () => {
      const q = queries.find((x) => x.id === sel.value);
      if (!q) return;
      btn.disabled = true;
      prog.style.display = 'block';
      out.textContent = `クエリ実行中… （スキャン対象: 直近1時間 / ${q.label}）`;
      let p = 0;
      const iv = setInterval(() => { p = Math.min(96, p + 12); bar.style.width = p + '%'; }, 300);
      IS.clock.afterGm(q.gmCost || 1, () => {
        clearInterval(iv);
        bar.style.width = '100%';
        setTimeout(() => { prog.style.display = 'none'; bar.style.width = '0%'; }, 400);
        btn.disabled = false;
        out.textContent = q.run(IS.state);
        IS.sound.ok();
      });
    };
    const row = el('div');
    row.append(sel, btn);
    card.append(row, prog, out);
    box.appendChild(card);
    return box;
  }

  function vEc2() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'EC2 インスタンス'));
    box.appendChild(el('div', 'aws-crumb', 'EC2 > インスタンス'));
    const card = el('div', 'aws-card');
    card.id = 'aws-ec2-card';
    renderEc2(card);
    box.appendChild(card);

    /* Auto Scaling */
    const asg = el('div', 'aws-card');
    asg.appendChild(el('h4', '', '📈 Auto Scaling グループ: asg-atlas-api'));
    const ops = IS.ops;
    const desired = ops ? ops.getDesired() : 6;
    asg.appendChild(el('div', 'aws-note', `希望するキャパシティ: <b>${desired}</b> ／ 最小 4 ・ 最大 12<br>対象: api-production-*`));
    const scaleBtn = el('button', 'aws-btn', '＋2 台スケールアウトする');
    scaleBtn.style.marginTop = '10px';
    scaleBtn.disabled = !ops || ops.scaling() || desired >= 10;
    scaleBtn.onclick = () => {
      IS.modal({
        title: 'キャパシティの変更',
        bodyHtml: `<p>希望するキャパシティを <b>${desired} → ${desired + 2}</b> に変更します。新しいインスタンスの起動には数分かかります。</p>
        <p class="modal-warn">⚠ 各APIインスタンスはMySQLへのコネクションプールを保持します。DB接続数の上限（500）に注意してください。</p>`,
        actions: [
          { label: 'キャンセル' },
          { label: '変更を適用', kind: 'primary', onClick: () => { IS.ops.scaleOut(); } },
        ],
      });
    };
    asg.appendChild(scaleBtn);
    box.appendChild(asg);

    /* 危険操作 */
    const danger = el('div', 'aws-card');
    danger.appendChild(el('h4', '', '⚠️ 一括操作'));
    danger.appendChild(el('div', 'aws-note', 'apiインスタンス全台を同時に再起動します。<b>再起動が完了するまで、サービスは完全に停止します。</b>'));
    const allBtn = el('button', 'aws-btn danger', 'api 全台を一斉再起動…');
    allBtn.style.marginTop = '10px';
    allBtn.onclick = () => {
      const input = el('input');
      input.type = 'text';
      input.placeholder = '「reboot all」と入力';
      IS.modal({
        title: '全台一斉再起動の確認',
        bodyEl: (() => {
          const d = el('div');
          d.appendChild(el('p', '', 'api-production-01〜06 を<b>同時に</b>再起動します。'));
          d.appendChild(el('p', 'modal-warn', '🚨 実行中、ALBの健全なホストは 0 台になり、Atlasの全機能が数分間 503 を返します。本当に実行しますか？'));
          d.appendChild(input);
          return d;
        })(),
        actions: [
          { label: 'キャンセル' },
          {
            label: '一斉再起動を実行', kind: 'danger', keepOpen: true,
            onClick: (_, close) => {
              if (input.value.trim().toLowerCase() !== 'reboot all') {
                input.style.borderColor = '#f25f5c';
                input.placeholder = '確認のため「reboot all」と入力してください';
                input.value = '';
                return false;
              }
              close();
              IS.ops.rebootAll();
            },
          },
        ],
      });
    };
    danger.appendChild(allBtn);
    box.appendChild(danger);
    return box;
  }

  function renderEc2(card) {
    card.innerHTML = '';
    card.appendChild(el('h4', '', '🖥 インスタンス一覧'));
    const t = el('table', 'aws-table');
    t.innerHTML = `<thead><tr>
      <th>Name</th><th>インスタンスID</th><th>状態</th><th>ステータスチェック</th><th>CPU</th><th>操作</th>
    </tr></thead>`;
    const tb = el('tbody');
    const list = IS.ops ? IS.ops.getInstances() : [];
    for (const i of list) {
      const tr = el('tr');
      const stateCls = i.state === 'running' ? (i.impaired ? 'warn' : '') : i.state === 'rebooting' || i.state === 'pending' ? 'warn' : 'bad';
      const stateLabel = { running: 'running', rebooting: 'rebooting', pending: 'pending', stopped: 'stopped' }[i.state];
      tr.innerHTML = `
        <td><b>${esc(i.name)}</b></td>
        <td style="font-family:var(--mono);font-size:11px">${esc(i.id)}</td>
        <td><span class="aws-state ${stateCls}">${stateLabel}</span></td>
        <td>${i.state !== 'running' ? '–' : i.impaired ? '<span style="color:#d13212;font-weight:700">1/2 チェックに失敗</span>' : '2/2 チェックに合格'}</td>
        <td style="font-family:var(--mono)">${i.state === 'running' ? Math.round(i.cpu) + '%' : '–'}</td>`;
      const td = el('td');
      if (i.canReboot) {
        const b = el('button', 'aws-btn', '再起動');
        b.disabled = i.state !== 'running';
        b.onclick = () => {
          IS.modal({
            title: `インスタンスの再起動: ${i.name}`,
            bodyHtml: `<p><code>${esc(i.id)}</code> を再起動します。</p>
              <p>ロードバランサーから切り離され、ヘルスチェック通過後に自動で復帰します（数分）。他のインスタンスがリクエストを引き受けます。</p>`,
            actions: [
              { label: 'キャンセル' },
              { label: '再起動', kind: 'primary', onClick: () => IS.ops.rebootInstance(i.name) },
            ],
          });
        };
        td.appendChild(b);
      }
      tr.appendChild(td);
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    card.appendChild(t);
  }

  function vRds() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'RDS データベース'));
    box.appendChild(el('div', 'aws-crumb', 'RDS > データベース > atlas-mysql-prd'));
    const card = el('div', 'aws-card');
    card.id = 'aws-rds-card';
    renderRds(card);
    box.appendChild(card);

    const grid = el('div', 'aws-chartgrid');
    grid.appendChild(chartCard('DatabaseConnections (max 500)', {
      key: 'db', color: '#3b48cc', max: 520, threshold: 450,
      fmt: (v) => `${v.toFixed(0)}`, sev: (v) => v >= 450 ? 'crit' : v >= 300 ? 'warn' : 'ok',
    }));
    box.appendChild(grid);

    const danger = el('div', 'aws-card');
    danger.appendChild(el('h4', '', '⚠️ 操作'));
    danger.appendChild(el('div', 'aws-note', 'DBインスタンスの再起動。<b>再起動中（2〜5分）はすべての書き込み・読み込みが失敗します。</b>接続数の問題は再起動では解決せず、クライアント側の接続が残っていれば再発します。'));
    const b = el('button', 'aws-btn danger', 'DBインスタンスを再起動…');
    b.style.marginTop = '10px';
    b.onclick = () => {
      IS.modal({
        title: 'DBインスタンスの再起動',
        bodyHtml: `<p class="modal-warn">🚨 atlas-mysql-prd はこのサービス唯一のプライマリDBです。再起動中はAtlasの全機能が停止し、実行中のトランザクションは失われます。接続数超過の対処としては<b>推奨されません</b>。</p>`,
        actions: [
          { label: 'キャンセル' },
          { label: '理解した上で再起動する', kind: 'danger', onClick: () => IS.ops.rdsReboot() },
        ],
      });
    };
    danger.appendChild(b);
    box.appendChild(danger);
    IS.state.mark('sawRds', 'RDSコンソールを確認');
    return box;
  }

  function renderRds(card) {
    const m = IS.metrics.now;
    card.innerHTML = '';
    card.appendChild(el('h4', '', '🛢 atlas-mysql-prd'));
    card.appendChild(el('div', 'aws-note',
      `エンジン: MySQL 8.0.36 ／ クラス: db.r6g.2xlarge ／ Multi-AZ: あり<br>` +
      `ステータス: <b style="color:${m.db >= 490 ? '#d13212' : '#1d8102'}">${m.db >= 490 ? '利用可能（接続数上限に到達）' : '利用可能'}</b><br>` +
      `現在の接続数: <b style="font-family:var(--mono)">${Math.round(m.db)} / 500</b>（パラメータ max_connections = 500）<br>` +
      `スロークエリ（直近5分）: <b style="font-family:var(--mono)">${Math.round(Math.max(0, (m.lat - 500) / 18))}</b> 件`));
  }

  function vWaf() {
    const box = el('div');
    box.appendChild(el('h1', 'aws-h1', 'WAF & Shield'));
    box.appendChild(el('div', 'aws-crumb', 'WAF > Web ACLs > atlas-prod-acl（ALBに関連付け済み）'));
    const card = el('div', 'aws-card');
    card.appendChild(el('h4', '', '🛡 ルール一覧'));
    const t = el('table', 'aws-table');
    t.innerHTML = `<thead><tr><th>優先度</th><th>ルール名</th><th>アクション</th><th>状態</th></tr></thead>`;
    const tb = el('tbody');
    const rules = IS.ops ? IS.ops.getWafRules() : [];
    let pr = 0;
    for (const r of rules) {
      const tr = el('tr');
      tr.innerHTML = `<td>${pr++}</td><td><b>${esc(r.name)}</b><br><span style="color:#687078;font-size:11px">${esc(r.desc)}</span></td>
        <td>${esc(r.action)}</td><td><span class="aws-state ${r.pending ? 'warn' : ''}">${r.pending ? '反映中…' : '有効'}</span></td>`;
      tb.appendChild(tr);
    }
    if (!rules.length) {
      const tr = el('tr');
      tr.innerHTML = `<td colspan="4" style="color:#687078">カスタムルールはありません（デフォルト: すべて許可）</td>`;
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    card.appendChild(t);
    const addBtn = el('button', 'aws-btn primary', 'ルールを追加');
    addBtn.style.marginTop = '12px';
    addBtn.onclick = () => IS.ops && IS.ops.wafRuleWizard();
    card.appendChild(addBtn);
    box.appendChild(card);

    const note = el('div', 'aws-card');
    note.appendChild(el('h4', '', 'ℹ️ ヒント'));
    note.appendChild(el('div', 'aws-note',
      'レートベースルールは特定の条件（User-Agent、IP範囲など）に一致するリクエストを制限します。<br>' +
      '<b>条件を特定できていない状態で広く遮断すると、正規のユーザーや検索エンジンのクローラーまで巻き込む</b>ことがあります。'));
    box.appendChild(note);
    return box;
  }

  /* ---------------- ナビゲーション ---------------- */
  function nav(id) {
    view = id;
    render();
  }

  function render() {
    if (!mainEl) return;
    charts = [];
    mainEl.innerHTML = '';
    const flash = IS.ops && IS.ops.awsFlash && IS.ops.awsFlash();
    if (flash) {
      const f = el('div', `aws-flash ${flash.sev || ''}`, flash.html);
      mainEl.appendChild(f);
    }
    const fn = { home: vHome, cw: vCloudWatch, alarms: vAlarms, logs: vLogs, ec2: vEc2, rds: vRds, waf: vWaf }[view];
    mainEl.appendChild(fn());
    IS.$$('.aws-side-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    charts.forEach(drawChart);
    if (view !== 'home') IS.state.mark('awsUsed', 'AWSコンソールを開いた');
  }

  /* ---------------- アプリ登録 ---------------- */
  IS.wm.register('aws', {
    title: 'AWS マネジメントコンソール — atlas-production',
    icon: '🟧',
    mount(body) {
      body.innerHTML = '';
      const app = el('div', 'aws-app');
      const navbar = el('div', 'aws-nav');
      navbar.appendChild(el('span', 'aws-logo', 'aws'));
      const search = el('input', 'aws-search');
      search.placeholder = 'サービス、機能、リソースなどを検索';
      navbar.appendChild(search);
      const right = el('div', 'aws-nav-right');
      right.innerHTML = `<span>ops-engineer @ atlas-production</span><span class="aws-region">東京 ap-northeast-1</span>`;
      navbar.appendChild(right);

      const bodyRow = el('div', 'aws-body');
      const side = el('div', 'aws-side');
      let lastSection = null;
      for (const v of VIEWS) {
        if (v.section && v.section !== lastSection) {
          side.appendChild(el('div', 'aws-side-title', esc(v.section)));
          lastSection = v.section;
        }
        const b = el('button', 'aws-side-item', esc(v.label));
        b.dataset.view = v.id;
        b.onclick = () => nav(v.id);
        side.appendChild(b);
      }
      mainEl = el('div', 'aws-main');
      bodyRow.append(side, mainEl);
      app.append(navbar, bodyRow);
      body.appendChild(app);
      render();
    },
  });

  /* 定期更新 */
  let sampleCount = 0;
  IS.bus.on('metrics-sample', () => {
    if (!IS.wm.isOpen('aws')) return;
    charts.forEach(drawChart);
    sampleCount++;
    const alarmCard = document.getElementById('aws-alarm-list');
    if (alarmCard) renderAlarms(alarmCard);
    const rdsCard = document.getElementById('aws-rds-card');
    if (rdsCard) renderRds(rdsCard);
    if (sampleCount % 4 === 0) {
      const ec2Card = document.getElementById('aws-ec2-card');
      if (ec2Card) renderEc2(ec2Card);
    }
  });
  IS.bus.on('ops-changed', () => { if (IS.wm.isOpen('aws')) render(); });
  IS.bus.on('win-resized', ({ id }) => { if (id === 'aws') charts.forEach(drawChart); });

  IS.awsApp = { nav };
})();
