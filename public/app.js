/**
 * public/app.js
 * ---------------------------------------------------------------------------
 * CollabBoard - logika sisi-client (browser).
 *
 *  - WebSocket bridge ke TCP server (lewat src/client/web-server.js)
 *  - Sidebar Rooms & Users (join/leave/create room, DM thread terpisah)
 *  - Composer: kirim pesan terenkripsi + file (ciphertext di-relay server)
 *  - TTL countdown per message bubble (self-destruct visual)
 *  - Tema gelap/terang (toggle body.dark)
 *  - Whiteboard/Board kolaboratif: stroke dikirim real-time per-room,
 *    snapshot board dikirim ke user yang baru pindah/join room.
 *  - Semua pesan & file dienkripsi lokal dengan AES-256-GCM via
 *    window.SCCrypto (lihat public/crypto.js). Server tidak pernah
 *    melihat plaintext.
 * ---------------------------------------------------------------------------
 */

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    me: '',
    ws: null,
    connected: false,
    activeKind: 'room',   // 'room' | 'dm'
    activeRoom: 'general',
    activePeer: null,     // username (untuk DM)
    users: [],
    rooms: [],
    messages: { room: { /* roomName -> [...] */ }, dm: { /* peerName -> [...] */ } },
    pendingTtl: 0,
    typingTimers: new Map(), // bubbleId -> interval
    typingDots: null,
  };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const dom = {
    login:        $('#login'),
    loginName:    $('#login-name'),
    loginGo:      $('#login-go'),
    app:          $('#app'),
    meName:       $('#me-name'),
    meAvatar:     $('#me-avatar'),
    themeToggle:  $('#theme-toggle'),
    tabBtns:      $$('.tab-btn'),
    panels:       $$('.tab-panel'),
    roomList:     $('#room-list'),
    userList:     $('#user-list'),
    roomCreate:   $('#room-create'),
    chatIcon:     $('#chat-icon'),
    chatTitle:    $('#chat-title'),
    chatSub:      $('#chat-sub'),
    ttlPick:      $('#ttl-pick'),
    messages:     $('#messages'),
    typing:       $('#typing'),
    composer:     $('#composer-input'),
    fileBtn:      $('#file-btn'),
    fileInput:    $('#file-input'),
    sendBtn:      $('#send-btn'),
    modal:        $('#modal'),
    modalInput:   $('#modal-input'),
    modalOk:      $('#modal-ok'),
    modalCancel:  $('#modal-cancel'),
  };

  // ---------- WebSocket ----------
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}`;
  }

  function connect(name) {
    const ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.onopen = () => {
      state.connected = true;
      ws.send(JSON.stringify({ type: 'join', name }));
    };
    ws.onclose = () => {
      state.connected = false;
      addSystemBubble('Koneksi terputus. Reconnect dalam 2 detik...');
      setTimeout(() => connect(state.me), 2000);
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
  }

  function send(obj) {
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  // ---------- Routing incoming ----------
  function onMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        state.me = msg.name;
        dom.meName.textContent = msg.name;
        dom.meAvatar.textContent = msg.name[0].toUpperCase();
        state.users = msg.users || [];
        state.rooms = msg.rooms || [];
        renderUsers();
        renderRooms();
        switchToRoom(msg.room || 'general');
        break;
      case 'system':
        addSystemBubble(msg.text);
        break;
      case 'users':
        state.users = msg.users || [];
        renderUsers();
        break;
      case 'rooms':
        state.rooms = msg.rooms || [];
        renderRooms();
        break;
      case 'history':
        state.messages.room[msg.room] = msg.items.map(normalizeRoomMsg);
        if (state.activeKind === 'room' && state.activeRoom === msg.room) {
          renderActiveThread();
        }
        break;
      case 'roomMessage':
        if (!state.messages.room[msg.room]) state.messages.room[msg.room] = [];
        state.messages.room[msg.room].push(msg);
        if (state.activeKind === 'room' && state.activeRoom === msg.room) {
          renderActiveThread(true);
        }
        bumpRoom(msg.room);
        break;
      case 'message': {
        // bisa room msg (bukan direct) atau DM
        if (msg.direct) {
          const peer = msg.echo ? msg.to : msg.from;
          if (!state.messages.dm[peer]) state.messages.dm[peer] = [];
          state.messages.dm[peer].push({ ...msg, _mine: !!msg.echo });
          if (state.activeKind === 'dm' && state.activePeer === peer) {
            renderActiveThread(true);
          }
          bumpUser(peer, msg.text || (msg.encrypted ? '<encrypted>' : ''));
        } else {
          // treat as room message of active room
          const room = msg.room || state.activeRoom;
          if (!state.messages.room[room]) state.messages.room[room] = [];
          state.messages.room[room].push({ ...msg, _mine: msg.from === state.me });
          if (state.activeKind === 'room' && state.activeRoom === room) {
            renderActiveThread(true);
          }
          bumpRoom(room);
        }
        break;
      }
      case 'file': {
        const peer = msg.direct ? (msg.echo ? msg.to : msg.from) : null;
        const room = msg.direct ? null : (msg.room || state.activeRoom);
        const entry = { ...msg, _mine: msg.from === state.me };
        if (msg.direct) {
          if (!state.messages.dm[peer]) state.messages.dm[peer] = [];
          state.messages.dm[peer].push(entry);
          if (state.activeKind === 'dm' && state.activePeer === peer) renderActiveThread(true);
          bumpUser(peer, `📎 ${msg.fileName}`);
        } else {
          if (!state.messages.room[room]) state.messages.room[room] = [];
          state.messages.room[room].push(entry);
          if (state.activeKind === 'room' && state.activeRoom === room) renderActiveThread(true);
          bumpRoom(room);
        }
        break;
      }
      case 'destroy':
        removeBubbleById(msg.id);
        // juga hapus dari cache
        for (const k of Object.keys(state.messages.room)) {
          state.messages.room[k] = state.messages.room[k].filter(m => m.id !== msg.id);
        }
        for (const k of Object.keys(state.messages.dm)) {
          state.messages.dm[k] = state.messages.dm[k].filter(m => m.id !== msg.id);
        }
        break;
      case 'typing':
        if (msg.direct) showTyping(`DM dari @${msg.from}`);
        else showTyping(`@${msg.from} di #${msg.room || state.activeRoom}`);
        break;
      case 'error':
        addSystemBubble('⚠️ ' + msg.text);
        break;

      // ---- Whiteboard events ----
      case 'boardBegin':
        if (state.activeKind === 'room' && state.activeRoom === msg.room) {
          boardRemoteBegin(msg);
        }
        break;
      case 'boardDraw':
        if (state.activeKind === 'room' && state.activeRoom === msg.room) {
          boardRemoteDraw(msg);
        }
        break;
      case 'boardEnd':
        if (state.activeKind === 'room' && state.activeRoom === msg.room) {
          boardRemoteEnd(msg);
        }
        break;
      case 'boardClear':
        boardClearAll(msg);
        break;
      case 'boardTool':
        boardRemoteTool(msg);
        break;
      case 'boardSnap':
        boardApplySnapshot(msg);
        break;
    }
  }

  function normalizeRoomMsg(m) { return { ...m, _mine: m.from === state.me }; }

  // ---------- Rendering ----------
  function renderUsers() {
    dom.userList.innerHTML = '';
    for (const u of state.users) {
      const li = document.createElement('li');
      if (state.activeKind === 'dm' && state.activePeer === u) li.classList.add('active');
      const initials = u[0].toUpperCase();
      li.innerHTML = `<span class="me-avatar" style="width:28px;height:28px;font-size:13px">${initials}</span>
        <span class="item-name">@${u}</span>
        <span class="badge" data-badge="${u}" hidden></span>`;
      li.addEventListener('click', () => switchToDm(u));
      dom.userList.appendChild(li);
    }
  }

  function renderRooms() {
    dom.roomList.innerHTML = '';
    for (const r of state.rooms) {
      const li = document.createElement('li');
      if (state.activeKind === 'room' && state.activeRoom === r.name) li.classList.add('active');
      li.innerHTML = `<span class="item-name">#${r.name}</span>
        <span class="item-meta">${r.members}</span>
        <span class="badge" data-badge="${r.name}" hidden></span>`;
      li.addEventListener('click', () => switchToRoom(r.name));
      dom.roomList.appendChild(li);
    }
  }

  function switchToRoom(name) {
    state.activeKind = 'room';
    state.activeRoom = name;
    send({ type: 'setRoom', room: name });
    dom.chatIcon.textContent = '#';
    dom.chatTitle.textContent = name;
    dom.chatSub.textContent = '';
    if (!state.messages.room[name]) state.messages.room[name] = [];
    renderRooms();
    renderActiveThread();
    // Redraw board for the new room & minta snapshot
    if (board.visible) {
      requestAnimationFrame(() => {
        boardResize();
        send({ type: 'boardState', room: name, on: true });
        // Minta snapshot state board untuk room ini
        send({ type: 'boardSnap', room: name });
      });
    } else {
      // Tetap minta snapshot agar strokes siap saat user buka board
      send({ type: 'boardSnap', room: name });
    }
    // Bersihkan cursor labels dari room sebelumnya
    document.querySelectorAll('.board-cursor-label').forEach(l => l.remove());
    board.cursors = {};
    // jika server punya roomMessages, minta history via joinRoom (idempotent)
    send({ type: 'joinRoom', room: name });
  }

  function switchToDm(peer) {
    state.activeKind = 'dm';
    state.activePeer = peer;
    dom.chatIcon.textContent = '@';
    dom.chatTitle.textContent = peer;
    dom.chatSub.textContent = 'Direct Message';
    if (!state.messages.dm[peer]) state.messages.dm[peer] = [];
    renderUsers();
    renderActiveThread();
  }

  function renderActiveThread(appendOnly = false) {
    const items = state.activeKind === 'room'
      ? (state.messages.room[state.activeRoom] || [])
      : (state.messages.dm[state.activePeer] || []);

    if (!appendOnly) {
      dom.messages.innerHTML = '';
    }

    // append only items yang belum dirender (yang belum punya DOM node)
    const rendered = new Set(Array.from(dom.messages.children).map(c => c.dataset.id));
    for (const m of items) {
      if (rendered.has(m.id)) continue;
      const node = makeBubble(m);
      dom.messages.appendChild(node);
    }
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function makeBubble(m) {
    const div = document.createElement('div');
    div.className = 'bubble';
    div.dataset.id = m.id || '';
    if (m._mine) div.classList.add('me');
    if (m.type === 'file') div.classList.add('file');
    if (m.direct && !m._mine) div.classList.add('dm');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `<b>${escapeHtml(m.from || 'system')}</b> <span class="muted">${time}</span>`;
    if (m.ttl) {
      const t = document.createElement('span');
      t.className = 'ttl-badge';
      t.textContent = `⏱ ${m.ttl}s`;
      meta.appendChild(t);
      startTtlCountdown(div, m.ttl, m.id);
    }
    div.appendChild(meta);

    if (m.type === 'file') {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.innerHTML = `
        <div class="file-icon">📄</div>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(m.fileName)}</div>
          <div class="file-size">${formatSize(m.size)} · terenkripsi</div>
        </div>`;
      div.appendChild(card);
      if (m.storedName) {
        const a = document.createElement('a');
        a.className = 'dl-btn';
        a.href = '/download/' + m.storedName;
        a.textContent = 'Download';
        a.target = '_blank';
        div.appendChild(a);
      }
    } else if (m.from === undefined || m.text) {
      // System bubble style
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = m.text || '';
      div.appendChild(body);
    } else if (m.encrypted) {
      // Encrypted chat message — decrypt and display
      const body = document.createElement('div');
      body.className = 'body';
      try {
        window.SCCrypto.decryptText(m.encrypted).then(pt => {
          body.textContent = pt;
        }).catch(() => {
          body.textContent = '[Pesan terenkripsi — tidak dapat didekripsi]';
        });
      } catch (_) {
        body.textContent = '[Pesan terenkripsi]';
      }
      div.appendChild(body);
    }
    return div;
  }

  function addSystemBubble(text) {
    const div = document.createElement('div');
    div.className = 'bubble system';
    div.textContent = text;
    dom.messages.appendChild(div);
    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function removeBubbleById(id) {
    const el = dom.messages.querySelector(`[data-id="${id}"]`);
    const timer = state.typingTimers.get(id);
    if (timer) { clearInterval(timer); state.typingTimers.delete(id); }
    if (!el) return;
    el.classList.add('fading');
    setTimeout(() => el.remove(), 600);
  }

  function startTtlCountdown(el, sec, id) {
    if (!sec || sec <= 0) return;
    const badge = el.querySelector('.ttl-badge');
    if (!badge) return;
    const destroyAt = Date.now() + sec * 1000;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((destroyAt - Date.now()) / 1000));
      badge.textContent = `⏱ ${remain}s`;
      if (remain <= 0) clearInterval(interval);
    };
    const interval = setInterval(tick, 1000);
    tick();
    state.typingTimers.set(id, interval);
  }

  function bumpRoom(name) {
    if (state.activeKind === 'room' && state.activeRoom === name) return;
    const b = dom.roomList.querySelector(`[data-badge="${name}"]`);
    if (b) { b.hidden = false; b.textContent = '•'; }
  }
  function bumpUser(name, _hint) {
    if (state.activeKind === 'dm' && state.activePeer === name) return;
    const b = dom.userList.querySelector(`[data-badge="${name}"]`);
    if (b) { b.hidden = false; b.textContent = '•'; }
  }

  function showTyping(text) {
    dom.typing.textContent = `✎ ${text}...`;
    dom.typing.classList.remove('hidden');
    clearTimeout(state.typingDots);
    state.typingDots = setTimeout(() => dom.typing.classList.add('hidden'), 1500);
  }

  // ---------- Composer ----------
  async function sendMessage() {
    const txt = dom.composer.value.trim();
    if (!txt) return;
    dom.composer.value = '';
    autoSize();
    const id = crypto.randomUUID ? crypto.randomUUID() : 'm' + Math.random().toString(36).slice(2);
    const ttl = state.pendingTtl || 0;
    state.pendingTtl = 0;
    dom.ttlPick.value = '0';
    const enc = await window.SCCrypto.encryptText(txt);
    const wire = {
      id,
      type: state.activeKind === 'dm' ? 'dm' : 'message',
      encrypted: enc,
      ttl: ttl || null,
    };
    if (state.activeKind === 'dm') wire.to = state.activePeer;
    else wire.room = state.activeRoom;
    send({ type: '__encrypted__', payload: wire });
  }

  async function sendFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { alert('File terlalu besar (max 8MB)'); return; }
    const buf = await file.arrayBuffer();
    const enc = await window.SCCrypto.encryptBuffer(buf);
    const id = crypto.randomUUID ? crypto.randomUUID() : 'f' + Math.random().toString(36).slice(2);
    const ttl = state.pendingTtl || 0;
    state.pendingTtl = 0;
    dom.ttlPick.value = '0';
    const wire = {
      id,
      type: 'file',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      encrypted: { iv: enc.iv, authTag: enc.authTag, ciphertext: enc.ciphertext },
      encrypted_ciphertext: enc.ciphertext,
      direct: state.activeKind === 'dm',
      to: state.activeKind === 'dm' ? state.activePeer : null,
      room: state.activeKind === 'room' ? state.activeRoom : null,
      ttl: ttl || null,
    };
    send({ type: '__encrypted__', payload: wire });
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function formatSize(n) {
    if (!n) return '0 B';
    const u = ['B','KB','MB','GB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + u[i];
  }
  function autoSize() {
    dom.composer.style.height = 'auto';
    dom.composer.style.height = Math.min(140, dom.composer.scrollHeight) + 'px';
  }

  // ---------- Wire UI ----------
  dom.loginGo.addEventListener('click', () => {
    const name = dom.loginName.value.trim();
    if (!name) { dom.loginName.focus(); return; }
    if (!/^[A-Za-z0-9_\-]{1,24}$/.test(name)) { alert('Username 1-24 char, A-Z 0-9 _ -'); return; }
    dom.login.classList.add('hidden');
    dom.app.classList.remove('hidden');
    connect(name);
  });
  dom.loginName.addEventListener('keydown', e => { if (e.key === 'Enter') dom.loginGo.click(); });

  dom.tabBtns.forEach(b => b.addEventListener('click', () => {
    dom.tabBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const tab = b.dataset.tab;
    dom.panels.forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
  }));

  dom.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('sc-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
  if (localStorage.getItem('sc-theme') === 'dark') document.body.classList.add('dark');

  dom.composer.addEventListener('input', autoSize);
  dom.composer.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.fileBtn.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', e => { sendFile(e.target.files[0]); e.target.value = ''; });
  dom.ttlPick.addEventListener('change', e => { state.pendingTtl = parseInt(e.target.value, 10) || 0; });

  dom.roomCreate.addEventListener('click', () => openModal());
  dom.modalCancel.addEventListener('click', closeModal);
  dom.modalOk.addEventListener('click', () => {
    const v = dom.modalInput.value.trim();
    if (!v) return;
    if (!/^[A-Za-z0-9_\-]{1,32}$/.test(v)) { alert('Nama room 1-32 char, A-Z 0-9 _ -'); return; }
    send({ type: 'joinRoom', room: v });
    closeModal();
    switchToRoom(v);
  });
  dom.modalInput.addEventListener('keydown', e => { if (e.key === 'Enter') dom.modalOk.click(); });

  function openModal() { dom.modal.classList.remove('hidden'); dom.modalInput.value = ''; dom.modalInput.focus(); }
  function closeModal() { dom.modal.classList.add('hidden'); }

  // ============================================================
  // WHITEBOARD — Collaborative Drawing (Real-time)
  // ============================================================
  const board = {
    canvas: $('#board-canvas'),
    ctx: null,
    drawing: false,
    currentStroke: null,
    strokesByRoom: {},     // roomName -> [{user, color, width, points, closed}]
    lastSentAt: 0,
    throttleMs: 8,         // tighter throttle for smoother real-time
    color: '#ffffff',
    width: 3,
    visible: false,
    cursors: {},           // userName -> {x, y}
  };
  board.ctx = board.canvas.getContext('2d');

  // ---------- Resize ----------
  function boardResize() {
    const c = board.canvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    // Save current image
    let imageData = null;
    if (c.width > 0 && c.height > 0) {
      try { imageData = board.ctx.getImageData(0, 0, c.width, c.height); } catch (_) {}
    }
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    board.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Restore image
    if (imageData) {
      board.ctx.putImageData(imageData, 0, 0);
    } else {
      boardRedraw();
    }
    // Redraw cursor labels
    for (const uid of Object.keys(board.cursors)) {
      drawRemoteCursor(uid, board.cursors[uid]);
    }
  }

  function boardEnsureSize() {
    if (board.visible && state.activeKind === 'room') {
      requestAnimationFrame(boardResize);
    }
  }
  window.addEventListener('resize', boardEnsureSize);

  // ---------- Strokes ----------
  function getRoomStrokes(room) {
    const r = room || state.activeRoom || 'general';
    if (!board.strokesByRoom[r]) board.strokesByRoom[r] = [];
    return board.strokesByRoom[r];
  }

  function boardRedraw() {
    const ctx = board.ctx;
    const rect = board.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    // Draw subtle grid background
    drawGrid(ctx, rect);
    // Draw all strokes of the active room
    const strokes = getRoomStrokes(state.activeRoom);
    for (const s of strokes) drawStrokeOnCtx(ctx, s);
  }

  function drawGrid(ctx, rect) {
    ctx.save();
    ctx.strokeStyle = 'rgba(128,128,128,0.08)';
    ctx.lineWidth = 1;
    const spacing = 20;
    for (let x = spacing; x < rect.width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
    }
    for (let y = spacing; y < rect.height; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  // Live draw: applies to canvas immediately
  function drawLiveSegment(ctx, s) {
    if (!s.points || s.points.length < 1) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.color;
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, (s.width || 2) / 2, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length - 1; i++) {
        const mx = (s.points[i].x + s.points[i + 1].x) / 2;
        const my = (s.points[i].y + s.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, mx, my);
      }
      const last = s.points[s.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Stored draw: identical to live (no special-casing)
  function drawStrokeOnCtx(ctx, s) {
    if (!s.points || s.points.length < 1) return;
    drawLiveSegment(ctx, s);
  }

  // ---------- Cursor tracking ----------
  function drawRemoteCursor(user, pos) {
    // Simple overlay label
    const existing = document.querySelector(`.board-cursor-label[data-user="${user}"]`);
    if (existing) {
      existing.style.left = pos.x + 'px';
      existing.style.top = pos.y + 'px';
    } else {
      const lbl = document.createElement('div');
      lbl.className = 'board-cursor-label';
      lbl.dataset.user = user;
      lbl.textContent = user;
      lbl.style.left = pos.x + 'px';
      lbl.style.top = pos.y + 'px';
      board.canvas.parentElement.appendChild(lbl);
    }
  }

  function boardGetPos(e) {
    const rect = board.canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  // ---------- Drawing ----------
  function sendLocalTool() {
    send({ type: 'boardTool', room: state.activeRoom, user: state.me, color: board.color, size: board.width });
  }

  function boardPointerDown(e) {
    if (state.activeKind !== 'room' || !board.visible) return;
    e.preventDefault();
    board.drawing = true;
    const p = boardGetPos(e);
    board.currentStroke = {
      user: state.me,
      color: board.color,
      width: board.width,
      points: [p],
    };
    send({ type: 'boardBegin', room: state.activeRoom, color: board.color, size: board.width, x: p.x, y: p.y, user: state.me });
  }

  function boardPointerMove(e) {
    if (!board.drawing || !board.currentStroke) return;
    e.preventDefault();
    const p = boardGetPos(e);
    const last = board.currentStroke.points[board.currentStroke.points.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
    board.currentStroke.points.push(p);

    // Draw last segment locally
    drawLiveSegment(board.ctx, {
      color: board.currentStroke.color,
      width: board.currentStroke.width,
      points: [last, p],
    });

    // Throttled send
    const now = performance.now();
    if (now - board.lastSentAt > board.throttleMs) {
      board.lastSentAt = now;
      send({
        type: 'boardDraw', room: state.activeRoom, user: state.me,
        x: p.x, y: p.y,
      });
    }
  }

  function boardPointerUp(e) {
    if (!board.drawing) return;
    e.preventDefault();
    board.drawing = false;
    if (board.currentStroke && board.currentStroke.points.length > 0) {
      // Flush titik terakhir yang mungkin ke-throttle — pastikan server & peer
      // menerima titik akhir ini agar stroke tersambung dengan benar.
      const last = board.currentStroke.points[board.currentStroke.points.length - 1];
      send({
        type: 'boardDraw', room: state.activeRoom, user: state.me,
        x: last.x, y: last.y,
      });
      board.lastSentAt = 0;
      board.currentStroke.closed = true;
      getRoomStrokes(state.activeRoom).push(board.currentStroke);
    }
    board.currentStroke = null;
    send({ type: 'boardEnd', room: state.activeRoom, user: state.me });
  }

  // ---------- Remote events ----------
  function _remoteUser(msg) {
    return msg.user || msg.from;
  }

  function boardRemoteBegin(msg) {
    if (state.activeKind !== 'room' || state.activeRoom !== msg.room) return;
    const strokes = getRoomStrokes(msg.room);
    const user = _remoteUser(msg);
    // Selalu buat stroke BARU — jangan lanjut stroke lama.
    const newStroke = { user, color: msg.color || '#fff', width: msg.size || 3, points: [] };
    strokes.push(newStroke);
    const p = { x: msg.x, y: msg.y };
    newStroke.points.push(p);
    drawLiveSegment(board.ctx, {
      color: msg.color || '#fff',
      width: msg.size || 3,
      points: [p],
    });
    board.cursors[user] = p;
    drawRemoteCursor(user, p);
  }

  function boardRemoteDraw(msg) {
    if (state.activeKind !== 'room' || state.activeRoom !== msg.room) return;
    const strokes = getRoomStrokes(msg.room);
    const user = _remoteUser(msg);
    const p = { x: msg.x, y: msg.y };
    // Cari stroke TERAKHIR user yang masih open (loop dari belakang)
    let stroke = null;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].user === user && !strokes[i].closed) {
        stroke = strokes[i];
        break;
      }
    }
    if (!stroke) {
      // boardDraw tiba sebelum boardBegin (race/throttle). Buat stroke baru
      // dengan asumsi style default — boardBegin berikutnya akan memulai lagi
      // dengan style benar, tapi kita gambar titik ini dulu agar tidak hilang.
      stroke = { user, color: msg.color || '#fff', width: msg.size || 3, points: [p] };
      strokes.push(stroke);
      drawLiveSegment(board.ctx, {
        color: stroke.color,
        width: stroke.width,
        points: [p],
      });
    } else {
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
      drawLiveSegment(board.ctx, {
        color: stroke.color,
        width: stroke.width,
        points: [last, p],
      });
      stroke.points.push(p);
    }
    board.cursors[user] = p;
    drawRemoteCursor(user, p);
  }

  function boardRemoteEnd(msg) {
    if (state.activeKind !== 'room' || state.activeRoom !== msg.room) return;
    const user = _remoteUser(msg);
    // Tandai stroke user terakhir yang masih open sebagai closed
    const strokes = getRoomStrokes(msg.room);
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].user === user && !strokes[i].closed) {
        strokes[i].closed = true;
        break;
      }
    }
    delete board.cursors[user];
    const lbl = document.querySelector(`.board-cursor-label[data-user="${user}"]`);
    if (lbl) lbl.remove();
  }

  // Tool/color/size change broadcast — HANYA untuk info, TIDAK mengubah
  // strokes yang sudah ada (style retroaktif akan membuat board kacau).
  function boardRemoteTool(msg) {
    // no-op visual
  }

  function boardClearAll(msg) {
    if (msg && msg.room) {
      // Clear hanya room yang dimaksud
      board.strokesByRoom[msg.room] = [];
      if (state.activeRoom === msg.room) {
        document.querySelectorAll('.board-cursor-label').forEach(l => l.remove());
        board.cursors = {};
        boardRedraw();
      }
    } else {
      // Backward compat: clear all
      board.strokesByRoom = {};
      document.querySelectorAll('.board-cursor-label').forEach(l => l.remove());
      board.cursors = {};
      boardRedraw();
    }
  }

  // Snapshot: server mengirim state board ke user yang baru join/switch room
  function boardApplySnapshot(msg) {
    if (state.activeKind !== 'room' || state.activeRoom !== msg.room) return;
    board.strokesByRoom[msg.room] = Array.isArray(msg.strokes) ? msg.strokes : [];
    document.querySelectorAll('.board-cursor-label').forEach(l => l.remove());
    board.cursors = {};
    boardRedraw();
  }

  // ---------- Event listeners ----------
  const cv = board.canvas;
  cv.addEventListener('mousedown', boardPointerDown);
  window.addEventListener('mousemove', boardPointerMove);
  window.addEventListener('mouseup', boardPointerUp);
  cv.addEventListener('touchstart', boardPointerDown, { passive: false });
  cv.addEventListener('touchmove', boardPointerMove, { passive: false });
  cv.addEventListener('touchend', boardPointerUp, { passive: false });

  // ---------- Tool buttons ----------
  const domBoard = {
    toggle:  $('#board-toggle'),
    clear:   $('#board-clear'),
    penBtn:  $('#board-pen'),
    color:   $('#board-color'),
    size:    $('#board-size'),
    sizeVal: $('#board-size-val'),
  };

  domBoard.toggle.addEventListener('click', () => {
    board.visible = !board.visible;
    $('#board-wrap').classList.toggle('open', board.visible);
    domBoard.toggle.classList.toggle('active', board.visible);
    if (board.visible) {
      requestAnimationFrame(() => {
        boardResize();
        send({ type: 'boardState', room: state.activeRoom, on: true });
        send({ type: 'boardSnap', room: state.activeRoom });
      });
    } else {
      send({ type: 'boardState', room: state.activeRoom, on: false });
    }
  });

  domBoard.clear.addEventListener('click', () => {
    if (!confirm('Bersihkan whiteboard di room ini (semua user)?')) return;
    board.strokesByRoom[state.activeRoom] = [];
    document.querySelectorAll('.board-cursor-label').forEach(l => l.remove());
    board.cursors = {};
    boardRedraw();
    send({ type: 'boardClear', room: state.activeRoom });
  });

  domBoard.penBtn.addEventListener('click', () => {
    domBoard.penBtn.classList.add('active');
    sendLocalTool();
  });

  domBoard.color.addEventListener('input', e => {
    board.color = e.target.value;
    sendLocalTool();
  });
  domBoard.size.addEventListener('input', e => {
    board.width = parseInt(e.target.value, 10);
    domBoard.sizeVal.textContent = board.width + 'px';
    sendLocalTool();
  });

  // ---------- Init ----------
  domBoard.penBtn.classList.add('active');
  domBoard.sizeVal.textContent = board.width + 'px';
})();
