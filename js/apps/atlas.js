/* ============================================================
   INCIDENT: 02:17 REAL ― Atlas本番サイト（ブラウザ内ブラウザ）
   実際のレイテンシ・エラー率に応じて描画が遅延・失敗する
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;

  let viewEl = null;
  let urlInput = null;
  let currentUrl = 'https://atlas.example.com/';
  let loadSeq = 0;
  let findUi = null; // {bar, input, count} ページ内検索
  let findHits = [];
  let findIdx = 0;

  const AREAS = { 11: '埼玉県', 13: '東京都', 14: '神奈川県' };
  const SHOPS = {
    13: ['和食処 やまびこ 銀座本店', 'Trattoria Lupo 恵比寿', '炭火焼鳥 とり政 神田', 'Cafe Bleu 吉祥寺', '鮨 はやせ 日本橋', '中華飯店 龍鳳 池袋', 'ビストロ小町 神楽坂', '天ぷら 花むら 浅草'],
    11: ['浦和 うなぎ処 かわせ', '大宮 麺屋 剛', '川越 蔵カフェ 豆音'],
    14: ['横浜 中華街 福来軒', '鎌倉 しらす亭'],
  };

  /* ---------------- ページ描画 ---------------- */
  function siteFrame(inner, opts = {}) {
    const site = el('div', 'at-site');
    const header = el('div', 'at-header');
    header.appendChild(el('div', 'at-logo', 'Atlas<small>検索・予約</small>'));
    header.appendChild(el('div', 'at-nav', '<span>店舗検索</span><span>予約確認</span><span>ログイン</span>'));
    site.appendChild(header);
    site.appendChild(inner);
    site.appendChild(el('div', 'at-footer', '© Atlas, Inc. ― 全国の店舗検索・予約サービス（15年目）'));
    return site;
  }

  function pageTop() {
    const inner = el('div');
    const hero = el('div', 'at-hero');
    hero.appendChild(el('h2', '', '行きたいお店が、きっと見つかる。'));
    hero.appendChild(searchBox());
    inner.appendChild(hero);
    const c = el('div', 'at-content');
    c.appendChild(el('p', '', '<b>人気の特集:</b> 夏のビアガーデン ／ 個室で女子会 ／ ランチ1000円以下'));
    inner.appendChild(c);
    return siteFrame(inner);
  }

  function searchBox(area = '13') {
    const box = el('div', 'at-searchbox');
    const selArea = el('select');
    for (const [code, name] of Object.entries(AREAS)) {
      const o = el('option', '', esc(name));
      o.value = code;
      if (code === area) o.selected = true;
      selArea.appendChild(o);
    }
    const selCat = el('select');
    for (const c of ['すべてのジャンル', '和食', 'イタリアン', 'カフェ']) selCat.appendChild(el('option', '', esc(c)));
    const btn = el('button', '', '検索する');
    btn.onclick = () => navigate(`https://atlas.example.com/search?area=${selArea.value}`);
    box.append(selArea, selCat, btn);
    return box;
  }

  function pageSearch(area) {
    const areaName = AREAS[area] || '東京都';
    const inner = el('div');
    const hero = el('div', 'at-hero');
    hero.appendChild(el('h2', '', `${esc(areaName)}の店舗検索`));
    hero.appendChild(searchBox(area));
    inner.appendChild(hero);
    const c = el('div', 'at-content');

    const st = IS.state;
    if (IS.ops && IS.ops.featureFlag('search_maintenance')) {
      c.appendChild(el('div', 'at-error',
        `<h3>🛠 検索機能はただいまメンテナンス中です</h3><p>ご不便をおかけして申し訳ありません。復旧までしばらくお待ちください。</p>`));
      inner.appendChild(c);
      return siteFrame(inner);
    }

    const degraded = IS.ops && IS.ops.featureFlag('search_degraded');
    let list = [...(SHOPS[area] || SHOPS[13])];
    let mixed = [];
    /* 表示不具合（テンプレートのarray_merge）: おすすめ店舗が検索結果に混入する */
    if (!st.has('templateFixed') && area === '13' && Math.random() < 0.45) {
      mixed = [...SHOPS[11].slice(0, 2)];
      st.mark('sawMixedResults', 'Atlasの検索結果に別地域の店舗が混ざるのを自分の目で確認');
    }
    c.appendChild(el('p', '', `<b>${esc(areaName)}</b> の検索結果 ${list.length + mixed.length}件` +
      (degraded ? ' <span style="color:#c0392b;font-size:11px">（現在、並び替え・詳細絞り込みは一時的にご利用いただけません）</span>' : '（人気順）')));

    const rows = [];
    list.forEach((name, i) => rows.push({ name, area: areaName, mismatch: false, star: (4.6 - i * 0.15).toFixed(1) }));
    /* 混入店舗は3件目・6件目あたりに挟む（リアルさのため） */
    mixed.forEach((name, i) => rows.splice(2 + i * 3, 0, { name, area: AREAS[11], mismatch: true, star: (4.2 - i * 0.2).toFixed(1) }));

    for (const r of rows) {
      const shop = el('div', 'at-shop');
      shop.appendChild(el('div', 'at-shop-thumb', '🍽'));
      const info = el('div');
      info.appendChild(el('div', 'at-shop-name', esc(r.name)));
      info.appendChild(el('div', 'at-shop-meta',
        `<span class="at-area${r.mismatch ? ' mismatch' : ''}">${esc(r.area)}</span>` +
        `<span class="at-badge-star">★ ${r.star}</span> ・ 予約可 ・ ネット予約ポイント2%`));
      shop.appendChild(info);
      c.appendChild(shop);
    }
    inner.appendChild(c);
    IS.state.counters.searches++;
    return siteFrame(inner);
  }

  function pageAdmin() {
    const inner = el('div');
    inner.appendChild(el('div', 'at-admin-header', 'Atlas 社内管理コンソール<small>feature flags</small>'));
    const c = el('div', 'at-content');
    c.appendChild(el('p', '', '機能フラグの変更は<b>本番環境に即時反映</b>されます。'));
    const flags = [
      { key: 'search_maintenance', name: 'search_maintenance', desc: '検索機能をメンテナンス表示に切り替える（負荷源への流入を止める・主要機能停止）' },
      { key: 'search_degraded', name: 'search_degraded', desc: '検索を縮退運転にする（並び替え・詳細絞り込みを無効化し、軽いクエリのみ許可）' },
    ];
    for (const f of flags) {
      const row = el('div', 'at-flag');
      const info = el('div');
      info.appendChild(el('div', 'at-flag-name', esc(f.name)));
      info.appendChild(el('div', 'at-flag-desc', esc(f.desc)));
      row.appendChild(info);
      const on = IS.ops && IS.ops.featureFlag(f.key);
      const tg = el('button', `at-toggle${on ? ' on' : ''}`);
      tg.onclick = () => {
        const next = !(IS.ops && IS.ops.featureFlag(f.key));
        IS.modal({
          title: `フラグの変更: ${f.name}`,
          bodyHtml: `<p><code>${esc(f.name)}</code> を <b>${next ? 'ON' : 'OFF'}</b> にします。</p><p>${esc(f.desc)}</p>` +
            (next && f.key === 'search_maintenance' ? '<p class="modal-warn">⚠ Atlasの主要機能（検索）が全ユーザーに対して停止します。事業影響が発生します。</p>' : ''),
          actions: [
            { label: 'キャンセル' },
            { label: '変更を反映', kind: next ? 'danger' : 'primary', onClick: () => { IS.ops.setFeatureFlag(f.key, next); navigate(currentUrl, true); } },
          ],
        });
      };
      row.appendChild(tg);
      c.appendChild(row);
    }
    inner.appendChild(c);
    return inner;
  }

  /* ---------------- ページ内検索（Cmd/Ctrl+F） ---------------- */
  function clearFind() {
    for (const m of findHits) {
      const parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
    findHits = [];
    findIdx = 0;
    if (findUi) findUi.count.textContent = '';
  }

  function runFind(query) {
    clearFind();
    if (!query || !viewEl) { return; }
    const lq = query.toLowerCase();
    const walker = document.createTreeWalker(viewEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !n.parentNode.closest('mark')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const text = n.nodeValue;
      const lt = text.toLowerCase();
      if (!lt.includes(lq)) continue;
      const frag = document.createDocumentFragment();
      let i = 0, idx;
      while ((idx = lt.indexOf(lq, i)) >= 0) {
        frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement('mark');
        mark.className = 'at-find-hit';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        findHits.push(mark);
        i = idx + query.length;
      }
      frag.appendChild(document.createTextNode(text.slice(i)));
      n.parentNode.replaceChild(frag, n);
    }
    findIdx = 0;
    focusHit();
  }

  function focusHit() {
    if (!findUi) return;
    findHits.forEach((m, i) => m.classList.toggle('active', i === findIdx));
    findUi.count.textContent = findHits.length ? `${findIdx + 1} / ${findHits.length}` : '0件';
    const cur = findHits[findIdx];
    if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function stepFind(dir) {
    if (!findHits.length) return;
    findIdx = (findIdx + dir + findHits.length) % findHits.length;
    focusHit();
  }

  function openFind() {
    if (!findUi) return;
    findUi.bar.classList.remove('hidden');
    findUi.input.focus();
    findUi.input.select();
    if (findUi.input.value) runFind(findUi.input.value);
  }

  function closeFind() {
    if (!findUi) return;
    clearFind();
    findUi.bar.classList.add('hidden');
  }

  /* ---------------- ナビゲーション（読み込みシミュレーション） ---------------- */
  function navigate(url, instant = false) {
    if (!viewEl) return;
    clearFind();
    currentUrl = url;
    if (urlInput) urlInput.value = url;
    const seq = ++loadSeq;

    const isAdmin = url.includes('admin.atlas');
    const m = IS.metrics.now;

    /* 管理画面は別系統（軽い） */
    if (isAdmin || instant) {
      renderPage(url);
      return;
    }

    viewEl.innerHTML = '';
    const prog = el('div', 'at-progressbar');
    const loading = el('div', 'at-loading');
    loading.appendChild(el('div', 'at-spinner'));
    const note = el('div', 'at-loading-note', 'atlas.example.com に接続しています…');
    loading.appendChild(note);
    viewEl.append(prog, loading);

    /* 実レイテンシに応じた読み込み時間（p90付近の体験を再現） */
    const lat = m.lat * IS.rand(0.8, 1.4);
    const healthy = m.healthy;
    const waitMs = healthy === 0 ? IS.rand(2500, 4000) : IS.clamp(lat * 1.1, 350, 11000);
    let p = 6;
    prog.style.width = p + '%';
    const iv = setInterval(() => {
      p = Math.min(92, p + IS.rand(2, 14) * (400 / Math.max(waitMs, 400)) * 10);
      prog.style.width = p + '%';
      if (waitMs > 2500) note.textContent = `atlas.example.com からの応答を待っています… (${((performance.now() - t0) / 1000).toFixed(1)}s)`;
    }, 400);
    const t0 = performance.now();

    setTimeout(() => {
      clearInterval(iv);
      if (seq !== loadSeq) return;
      prog.style.width = '100%';
      setTimeout(() => { if (seq === loadSeq) prog.remove(); }, 300);

      const mNow = IS.metrics.now;
      if (mNow.healthy === 0) {
        renderError('503', 'Service Unavailable', 'サーバーが応答していません。すべてのバックエンドがヘルスチェックに失敗しています。');
        return;
      }
      if (waitMs >= 10500) {
        renderError('TIMEOUT', 'ERR_TIMED_OUT', 'atlas.example.com への接続がタイムアウトしました。ページの読み込みに時間がかかりすぎています。');
        return;
      }
      if (Math.random() * 100 < mNow.err) {
        renderError('502', 'Bad Gateway', 'アップストリームサーバーから不正な応答を受信しました。時間をおいて再度お試しください。');
        return;
      }
      renderPage(url);
    }, waitMs);

    if (IS.state.has('incident')) IS.state.mark('siteChecked', 'ユーザー目線でAtlas本番サイトの状態を確認');
  }

  function renderError(code, title, desc) {
    viewEl.innerHTML = '';
    const e = el('div', 'at-error');
    e.appendChild(el('h2', '', esc(code)));
    e.appendChild(el('h3', '', esc(title)));
    e.appendChild(el('p', '', esc(desc)));
    const retry = el('button', 'aws-btn', '再読み込み');
    retry.style.marginTop = '16px';
    retry.onclick = () => navigate(currentUrl);
    e.appendChild(retry);
    viewEl.appendChild(e);
    IS.state.mark('sawSiteError', 'Atlas本番サイトのエラー画面を確認');
    IS.bus.emit('atlas-error-seen');
  }

  function renderPage(url) {
    viewEl.innerHTML = '';
    if (url.includes('admin.atlas')) { viewEl.appendChild(pageAdmin()); }
    else if (url.includes('/search')) {
      const mArea = url.match(/area=(\d+)/);
      viewEl.appendChild(pageSearch(mArea ? mArea[1] : '13'));
    } else {
      viewEl.appendChild(pageTop());
    }
    /* 検索バーが開いたままなら、新しいページ内容に対して再検索する */
    if (findUi && !findUi.bar.classList.contains('hidden') && findUi.input.value) {
      runFind(findUi.input.value.trim());
    }
  }

  /* ---------------- アプリ登録 ---------------- */
  IS.wm.register('atlas', {
    title: 'Atlas — 本番サイト（ユーザーが見ている画面）',
    icon: '🌐',
    mount(body) {
      body.innerHTML = '';
      const app = el('div', 'atlas-app');
      const chrome = el('div', 'atlas-chrome');
      const back = el('button', 'atlas-navbtn', '←');
      const reload = el('button', 'atlas-navbtn', '⟳');
      const urlbar = el('div', 'atlas-urlbar');
      urlbar.appendChild(el('span', 'atlas-lock', '🔒'));
      urlInput = el('input', 'atlas-url');
      urlInput.value = currentUrl;
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          let u = urlInput.value.trim();
          if (!/^https?:/.test(u)) u = 'https://' + u;
          navigate(u);
        }
      });
      urlbar.appendChild(urlInput);
      const findBtn = el('button', 'atlas-navbtn', '🔍');
      findBtn.title = 'ページ内検索（⌘F / Ctrl+F）';
      findBtn.onclick = () => openFind();
      chrome.append(back, reload, urlbar, findBtn);

      /* ページ内検索バー */
      const findBar = el('div', 'atlas-findbar hidden');
      const findInput = el('input', 'atlas-find-input');
      findInput.placeholder = 'ページ内を検索（例: 埼玉）';
      const findCount = el('span', 'atlas-find-count', '');
      const prevB = el('button', 'atlas-navbtn', '∧');
      prevB.title = '前へ（Shift+Enter）';
      const nextB = el('button', 'atlas-navbtn', '∨');
      nextB.title = '次へ（Enter）';
      const closeB = el('button', 'atlas-navbtn', '✕');
      findBar.append(findInput, findCount, prevB, nextB, closeB);
      findUi = { bar: findBar, input: findInput, count: findCount };
      prevB.onclick = () => stepFind(-1);
      nextB.onclick = () => stepFind(1);
      closeB.onclick = () => closeFind();
      findInput.addEventListener('input', () => runFind(findInput.value.trim()));
      findInput.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') closeFind();
      });
      const bms = el('div', 'atlas-bookmarks');
      const bmDefs = [
        ['🏠 Atlas トップ', 'https://atlas.example.com/'],
        ['🔍 店舗検索（東京都）', 'https://atlas.example.com/search?area=13'],
        ['⚙️ 社内管理（feature flags）', 'https://admin.atlas.example.com/flags'],
      ];
      for (const [label, url] of bmDefs) {
        const b = el('button', 'atlas-bm', esc(label));
        b.onclick = () => navigate(url);
        bms.appendChild(b);
      }
      viewEl = el('div', 'atlas-view');
      app.append(chrome, bms, findBar, viewEl);
      body.appendChild(app);

      back.onclick = () => navigate('https://atlas.example.com/');
      reload.onclick = () => navigate(currentUrl);
      navigate(currentUrl);
    },
  });

  /* Atlasウィンドウが前面にあるときは ⌘F/Ctrl+F をページ内検索として扱う */
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      if (IS.wm.isVisible('atlas')) {
        e.preventDefault();
        openFind();
      }
    }
  });

  IS.atlasApp = { navigate, openFind };
})();
