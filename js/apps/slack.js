/* ============================================================
   INCIDENT: 02:17 REAL ― Slackアプリ
   ============================================================ */
(() => {
  'use strict';
  const IS = window.IS;
  const { el, esc } = IS;

  const channels = new Map(); // id -> {id,name,kind,topic,msgs,unread,mentions}
  let activeId = null;
  let ui = null; // {side, feed, typing, chips, input, header}
  const typingState = new Map(); // chId -> Set(personName)

  function person(id) {
    return (IS.PEOPLE && IS.PEOPLE[id]) || { name: id, color: '#888', role: '' };
  }

  /* ---- 本文フォーマット ---- */
  function fmt(body) {
    let s = esc(body);
    s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/@([^\s@、。：:,．]+)/g, '<span class="sl-at">@$1</span>');
    return s;
  }

  /* ---- チャンネル ---- */
  function addChannel(id, { name, kind = 'channel', topic = '' }, opts = {}) {
    if (channels.has(id)) return channels.get(id);
    const ch = { id, name, kind, topic, msgs: [], unread: 0, mentions: 0 };
    channels.set(id, ch);
    if (ui) renderSide();
    if (opts.activate) switchTo(id);
    return ch;
  }

  function switchTo(id) {
    activeId = id;
    const ch = channels.get(id);
    ch.unread = 0;
    ch.mentions = 0;
    updateDockBadge();
    if (!ui) return;
    renderSide();
    renderHeader();
    renderFeed();
    renderChips();
  }

  /* ---- メッセージ投稿 ---- */
  function post(chId, msg) {
    const ch = channels.get(chId);
    if (!ch) return;
    msg.gm = IS.clock.gm;
    ch.msgs.push(msg);

    const isActiveVisible = activeId === chId && IS.wm.isVisible('slack');
    if (!isActiveVisible && msg.kind !== 'system') {
      ch.unread++;
      if (msg.mentionMe || msg.kind === 'alert') ch.mentions++;
    }
    if (activeId === chId && ui) appendMsg(msg);
    renderSide();
    updateDockBadge();

    /* 通知トースト（自分の発言・システム行以外） */
    if (msg.from !== 'me' && msg.kind !== 'system' && !isActiveVisible && !msg.quiet) {
      const p = person(msg.from);
      const sev = msg.attach ? (msg.attach.sev === 'crit' ? 'crit' : msg.attach.sev === 'warn' ? 'warn' : '') : '';
      IS.notify('slack', {
        title: `${p.name} — ${ch.kind === 'dm' ? 'ダイレクトメッセージ' : '#' + ch.name}`,
        body: msg.attach ? `${msg.attach.title}` : msg.body,
        icon: msg.attach ? '🚨' : '💬',
        sev,
      });
    } else if (msg.from !== 'me' && msg.kind !== 'system' && isActiveVisible && !msg.quiet) {
      IS.sound.knock();
    }
    if (msg.from !== 'me') IS.bus.emit('slack-received', { chId, msg });
  }

  function system(chId, text) {
    post(chId, { from: 'system', kind: 'system', body: text, quiet: true });
  }

  /* NPCの「入力中…」→投稿。gmDelay: ゲーム内分 */
  function npcPost(chId, fromId, body, gmDelay = 0.8, opts = {}) {
    IS.clock.afterGm(Math.max(0.1, gmDelay - 0.5), () => {
      if (IS.state.over) return;
      setTyping(chId, fromId, true);
      IS.clock.afterGm(0.5, () => {
        setTyping(chId, fromId, false);
        if (IS.state.over) return;
        post(chId, { from: fromId, body, ...opts });
      });
    });
  }

  function setTyping(chId, personId, on) {
    if (!typingState.has(chId)) typingState.set(chId, new Set());
    const set = typingState.get(chId);
    if (on) set.add(person(personId).name); else set.delete(person(personId).name);
    renderTyping();
  }

  /* ---- 描画 ----
     サイドバーは「差分更新」にする。クリック中(pointerdown〜click間)に
     ボタンをDOMから作り直すと click が発火しなくなるため、全再構築は
     チャンネル構成が変わったときだけ行う */
  const chanBtns = new Map(); // chId -> button
  function renderSide() {
    if (!ui) return;
    if (chanBtns.size !== channels.size || ![...chanBtns.values()].every((b) => b.isConnected)) {
      rebuildSide();
    }
    for (const c of channels.values()) patchChanBtn(c);
  }

  function rebuildSide() {
    chanBtns.clear();
    ui.side.innerHTML = '';
    ui.side.appendChild(el('div', 'sl-ws', 'AtlasWorks'));
    const chs = [...channels.values()].filter((c) => c.kind === 'channel');
    const dms = [...channels.values()].filter((c) => c.kind === 'dm');
    ui.side.appendChild(el('div', 'sl-side-section', 'チャンネル'));
    for (const c of chs) ui.side.appendChild(chanBtn(c));
    if (dms.length) {
      ui.side.appendChild(el('div', 'sl-side-section', 'ダイレクトメッセージ'));
      for (const c of dms) ui.side.appendChild(chanBtn(c, true));
    }
  }

  function chanBtn(c, dm) {
    const b = el('button', 'sl-chan');
    b.innerHTML = (dm
      ? `<span class="sl-presence"></span>${esc(c.name)}`
      : `<span class="sl-hash">#</span>${esc(c.name)}`) +
      `<span class="sl-badge hidden"></span>`;
    b.onclick = () => switchTo(c.id);
    chanBtns.set(c.id, b);
    patchChanBtn(c);
    return b;
  }

  function patchChanBtn(c) {
    const b = chanBtns.get(c.id);
    if (!b) return;
    b.className = `sl-chan${c.id === activeId ? ' active' : ''}${c.unread ? ' unread' : ''}`;
    const badge = b.querySelector('.sl-badge');
    badge.textContent = c.unread ? String(c.unread) : '';
    badge.classList.toggle('hidden', !c.unread);
  }

  function renderHeader() {
    const ch = channels.get(activeId);
    ui.header.innerHTML = `${ch.kind === 'dm' ? '@' : '#'}${esc(ch.name)} <span class="sl-topic">${esc(ch.topic || '')}</span>`;
  }

  function msgNode(m) {
    if (m.kind === 'system') return el('div', 'sl-sysmsg', fmt(m.body));
    const p = m.from === 'me' ? { name: 'あなた', color: '#4a90d9', role: 'エンジニア' } : person(m.from);
    const node = el('div', `sl-msg${m.mentionMe ? ' sl-mention-me' : ''}`);
    const av = el('div', 'sl-avatar', esc(p.name[0]));
    av.style.background = p.color;
    const body = el('div', 'sl-body');
    body.appendChild(el('div', 'sl-head',
      `<span class="sl-name">${esc(p.name)}</span>` +
      (p.role ? `<span class="sl-role">${esc(p.role)}</span>` : '') +
      `<span class="sl-time">${IS.clock.fmt(m.gm)}</span>`));
    if (m.body) body.appendChild(el('div', 'sl-text', fmt(m.body)));
    if (m.attach) {
      const at = el('div', `sl-attach ${m.attach.sev || ''}`);
      at.appendChild(el('div', 'sl-attach-title', esc(m.attach.title)));
      if (m.attach.body) at.appendChild(el('div', 'sl-attach-body', esc(m.attach.body)));
      body.appendChild(at);
    }
    if (m.shot) {
      const shot = el('div', 'sl-shot');
      shot.appendChild(el('div', 'sl-shot-bar', '🔒 atlas.example.com/search?area=13（スクリーンショット）'));
      for (const r of m.shot) {
        shot.appendChild(el('div', 'sl-shot-row',
          `<span>${esc(r.name)}</span><span class="${r.bad ? 'bad' : ''}">${esc(r.area)}</span>`));
      }
      body.appendChild(shot);
    }
    node.append(av, body);
    return node;
  }

  function appendMsg(m) {
    const nearBottom = ui.feed.scrollHeight - ui.feed.scrollTop - ui.feed.clientHeight < 80;
    ui.feed.appendChild(msgNode(m));
    if (nearBottom || m.from === 'me') ui.feed.scrollTop = ui.feed.scrollHeight;
  }

  function renderFeed() {
    const ch = channels.get(activeId);
    ui.feed.innerHTML = '';
    ui.feed.appendChild(el('div', 'sl-daybreak', '7月6日（月）'));
    for (const m of ch.msgs) ui.feed.appendChild(msgNode(m));
    ui.feed.scrollTop = ui.feed.scrollHeight;
    renderTyping();
  }

  function renderTyping() {
    if (!ui) return;
    const set = typingState.get(activeId);
    const names = set ? [...set] : [];
    ui.typing.innerHTML = names.length
      ? `${esc(names.join('、'))} が入力中<span class="dots"></span>` : '';
  }

  /* ---- チップ（行動候補） ---- */
  let chipsProvider = null; // (chId) => [{label, primary, run}]
  function renderChips() {
    if (!ui) return;
    ui.chips.innerHTML = '';
    if (!chipsProvider) return;
    const chips = chipsProvider(activeId) || [];
    for (const c of chips) {
      const b = el('button', `sl-chip${c.primary ? ' primary' : ''}`, esc(c.label));
      b.onclick = () => { c.run(activeId); renderChips(); };
      ui.chips.appendChild(b);
    }
  }

  function updateDockBadge() {
    let total = 0;
    channels.forEach((c) => { total += c.unread; });
    IS.wm.badge('slack', total);
  }

  /* ---- 送信 ---- */
  function sendFree() {
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    post(activeId, { from: 'me', body: text });
    IS.bus.emit('slack-send', { chId: activeId, text });
  }

  /* ---------------- アプリ登録 ---------------- */
  IS.wm.register('slack', {
    title: 'Slack — AtlasWorks',
    icon: '💬',
    mount(body) {
      body.innerHTML = '';
      const app = el('div', 'slack-app');
      const side = el('div', 'sl-side');
      const main = el('div', 'sl-main');
      const header = el('div', 'sl-header');
      const feed = el('div', 'sl-feed');
      const typing = el('div', 'sl-typing');
      const composer = el('div', 'sl-composer');
      const chips = el('div', 'sl-chips');
      const inputrow = el('div', 'sl-inputrow');
      const atBtn = el('button', 'sl-at-btn', '@');
      atBtn.title = 'メンバーにメンションして状況を聞く';
      const input = el('input', 'sl-input');
      input.placeholder = 'メッセージを送信（下の候補からも選べます）';
      const send = el('button', 'sl-send', '➤');
      inputrow.append(atBtn, input, send);
      composer.append(chips, inputrow);
      main.append(header, feed, typing, composer);
      app.append(side, main);
      body.appendChild(app);
      ui = { side, feed, typing, chips, input, header };

      send.onclick = sendFree;
      /* 日本語入力の変換確定Enterでは送信しない（isComposing / keyCode 229 はIME処理中） */
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) sendFree();
      });
      atBtn.onclick = () => IS.bus.emit('slack-mention-picker', { chId: activeId });

      if (!activeId && channels.size) activeId = channels.keys().next().value;
      if (activeId) switchTo(activeId);
    },
  });

  /* フォーカスしたら既読化 */
  IS.bus.on('app-focus', ({ id }) => {
    if (id === 'slack' && activeId && channels.has(activeId)) {
      const ch = channels.get(activeId);
      ch.unread = 0; ch.mentions = 0;
      renderSide(); updateDockBadge();
    }
  });

  IS.slackApp = {
    addChannel,
    switchTo,
    post,
    system,
    npcPost,
    setTyping,
    setChipsProvider(fn) { chipsProvider = fn; },
    refreshChips: () => renderChips(),
    get activeId() { return activeId; },
    channel: (id) => channels.get(id),

    /* ---- セーブ/ロード ---- */
    serialize() {
      return {
        activeId,
        channels: [...channels.values()].map((c) => ({
          id: c.id, name: c.name, kind: c.kind, topic: c.topic,
          unread: c.unread, mentions: c.mentions,
          msgs: c.msgs.map((m) => ({ ...m })),
        })),
      };
    },
    restore(data) {
      channels.clear();
      typingState.clear();
      for (const c of data.channels || []) {
        channels.set(c.id, { ...c, msgs: c.msgs || [] });
      }
      activeId = data.activeId && channels.has(data.activeId) ? data.activeId : (channels.keys().next().value || null);
      updateDockBadge();
      if (ui && activeId) switchTo(activeId);
    },
  };

  /* シナリオ側から再描画を促すイベント */
  IS.bus.on('chips-changed', () => renderChips());

  /* 時間経過で出現するチップのため、定期的に再評価する（入力中は邪魔しない） */
  IS.bus.on('metrics-sample', () => {
    if (!ui || !IS.wm.isOpen('slack')) return;
    if (document.activeElement === ui.input && ui.input.value) return;
    renderChips();
  });
})();
