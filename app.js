/* ANDRADE — utilitários compartilhados e fluxo da página inicial.
 * Scripts clássicos permitem abrir index.html diretamente com file://.
 */
(function () {
  'use strict';

  // Ícones vetoriais de interface, desenhados para esta implementação.
  const paths = {
    screen: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5M8 9l4-3 4 3m-4-3v7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    login: '<path d="M13 4h6v16h-6M3 12h12m-4-4 4 4-4 4"/>',
    logout: '<path d="M10 4H4v16h6m-2-8h13m-4-4 4 4-4 4"/>',
    link: '<path d="m10 13 4-4m-5 6-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 1 2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    'mic-off': '<path d="m3 3 18 18M9 9v2a3 3 0 0 0 5 2m1-4V5a3 3 0 0 0-5.5-1.6M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-4 0h8"/>',
    camera: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>',
    volume: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    'volume-off': '<path d="M11 4 6 8H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/>',
    maximize: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/><path d="M7 10h8m-8 4h5"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',
    settings: '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M7 16h10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  const $ = (id) => document.getElementById(id);
  const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.info) + '</svg>';
  function icons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); }); }
  const store = {
    get(key, fallback = null, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)) ?? fallback; } catch (_) { return fallback; } },
    set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } },
    remove(key, session = false) { try { (session ? sessionStorage : localStorage).removeItem(key); } catch (_) { /* Navegação privada pode bloquear storage. */ } }
  };
  function randomToken(bytes = 24) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return Array.from(a, (v) => v.toString(16).padStart(2, '0')).join(''); }
  function roomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint8Array(4); crypto.getRandomValues(a); return 'AND-' + Array.from(a, (n) => chars[n % chars.length]).join(''); }
  function normalizeCode(value) { return String(value || '').trim().toUpperCase(); }
  function validCode(value) { return /^AND-[A-Z0-9]{4}$/.test(value); }
  function toast(message, error = false) { const box = document.createElement('div'); box.className = 'toast' + (error ? ' error' : ''); box.textContent = message; $('toastStack')?.append(box); setTimeout(() => box.remove(), error ? 6500 : 4000); }
  function openDialog(dialog) { if (dialog && !dialog.open) dialog.showModal(); }
  function errorMessage(error) {
    const map = {
      NotAllowedError: 'Permissão não concedida. Tente novamente e autorize no navegador.',
      NotFoundError: 'Não encontramos o dispositivo solicitado.',
      NotReadableError: 'O dispositivo está ocupado ou bloqueado pelo sistema.',
      AbortError: 'A captura foi cancelada. Você pode tentar novamente.',
      InvalidStateError: 'Clique no botão para escolher o que deseja compartilhar.',
      OverconstrainedError: 'Seu dispositivo não suporta esta configuração.',
      SecurityError: 'O navegador bloqueou este recurso. Use HTTPS ou localhost.'
    };
    return map[error?.name] || error?.message || 'Não foi possível concluir. Tente novamente.';
  }
  function setBusy(button, busy, text) { if (!button) return; if (busy) { button.dataset.oldText = button.textContent; button.disabled = true; if (text) button.textContent = text; } else { button.disabled = false; if (button.dataset.oldText) button.textContent = button.dataset.oldText; } }
  async function copyInvite() {
    const url = new URL('room.html', location.href); url.searchParams.set('id', new URLSearchParams(location.search).get('id') || '');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url.href);
      else { const input = document.createElement('textarea'); input.value = url.href; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('Copie o endereço na barra do navegador.'); }
      toast('✓ LINK COPIADO'); return url.href;
    } catch (err) { toast(errorMessage(err), true); throw err; }
  }
  // Consulta só metadados públicos; senhas e credenciais nunca vão na URL.
  async function inspectRoom(code) {
    if (!window.ANDRADE_CONFIG.websocketUrl) {
      const info = store.get('andrade-room:' + code);
      return info && Date.now() - info.updatedAt < 120000 ? info : null;
    }
    return new Promise((resolve, reject) => {
      let socket;
      const timer = setTimeout(() => { socket?.close(); reject(new Error('Servidor indisponível. Tente novamente.')); }, 7000);
      const end = () => { clearTimeout(timer); socket?.close(); };
      try { socket = new WebSocket(window.ANDRADE_CONFIG.websocketUrl); } catch (e) { end(); reject(e); return; }
      socket.onopen = () => socket.send(JSON.stringify({ type: 'inspect', code }));
      socket.onmessage = (event) => { try { const data = JSON.parse(event.data); if (data.type === 'info') { end(); resolve(data.exists ? data : null); } else if (data.type === 'error') { end(); reject(new Error(data.message)); } } catch (_) { end(); reject(new Error('Resposta de conexão inválida.')); } };
      socket.onerror = () => { end(); reject(new Error('Não foi possível conectar ao servidor.')); };
    });
  }
  function registerTools(toolList) {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    for (const tool of toolList) { try { Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(() => {}); } catch (_) { /* Padrão experimental: a interface continua funcionando. */ } }
    window.addEventListener('pagehide', () => life.abort(), { once: true });
  }
  window.Andrade = { $, icon, icons, store, randomToken, roomCode, normalizeCode, validCode, toast, openDialog, errorMessage, setBusy, copyInvite, inspectRoom, registerTools };
  icons();
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); }));
  document.querySelectorAll('[data-open-terms]').forEach((button) => button.addEventListener('click', () => openDialog($('termsModal'))));
  if ($('bootScreen')) { setTimeout(() => { $('bootText').textContent = 'READY'; }, 850); setTimeout(() => $('bootScreen').remove(), 1450); }

  if (!$('createForm')) return;
  let selectedCode = '';
  let joiningPrivate = false;
  function updateOnline() { const isOnline = navigator.onLine; $('homeStatus').classList.toggle('is-offline', !isOnline); $('homeStatus').innerHTML = '<i class="status-dot"></i> ' + (isOnline ? 'ONLINE' : 'OFFLINE'); }
  updateOnline(); window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
  $('privateRoom').addEventListener('change', () => { const value = $('privateRoom').checked; $('privateFields').hidden = !value; $('createPassword').required = value; if (value) $('createPassword').focus(); });
  $('roomCode').addEventListener('input', () => { $('roomCode').value = $('roomCode').value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); $('homeError').textContent = ''; });

  $('createForm').addEventListener('submit', (event) => {
    event.preventDefault();
    let code = roomCode(); for (let i = 0; i < 10 && store.get('andrade-room:' + code); i++) code = roomCode();
    const data = { code, name: store.get('andrade-nickname', 'Andrade'), create: true, hostToken: randomToken(32), password: $('privateRoom').checked ? $('createPassword').value : '' };
    if (!store.set('andrade-session:' + code, data, true)) { $('homeError').textContent = 'Permita o armazenamento desta página para criar a sala.'; return; }
    $('createButton').disabled = true;
    location.href = 'room.html?id=' + encodeURIComponent(code);
  });
  async function startJoin(code) {
    if (!validCode(code)) throw new Error('Digite um código válido, como AND-7K92.');
    selectedCode = code; joiningPrivate = false;
    $('accessCode').textContent = code; $('accessError').textContent = ''; $('accessPasswordFields').hidden = true; $('accessPassword').required = false; $('accessPassword').value = '';
    $('nickname').value = store.get('andrade-nickname', '');
    openDialog($('accessModal')); setBusy($('accessSubmit'), true, 'VERIFICANDO SALA...');
    try {
      const info = await inspectRoom(code);
      if (selectedCode !== code) return;
      if (info?.locked) throw new Error('O host bloqueou novas entradas nesta sala.');
      if (!info) throw new Error(window.ANDRADE_CONFIG.websocketUrl ? 'Sala não encontrada. Confira o código.' : 'Sala local não encontrada. Abra a sala no mesmo navegador ou use o servidor ANDRADE.');
      joiningPrivate = !!info.private; $('accessPasswordFields').hidden = !joiningPrivate; $('accessPassword').required = joiningPrivate;
    } catch (err) { $('accessError').textContent = errorMessage(err); }
    finally { setBusy($('accessSubmit'), false); }
    return { code, private: joiningPrivate, stage: 'access-dialog' };
  }
  $('joinForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await startJoin(normalizeCode($('roomCode').value)); } catch (err) { $('homeError').textContent = errorMessage(err); } });
  $('accessForm').addEventListener('submit', (event) => {
    event.preventDefault(); const name = $('nickname').value.trim(); if (name.length < 2) { $('accessError').textContent = 'Use pelo menos 2 caracteres no apelido.'; return; }
    const data = { code: selectedCode, name, password: $('accessPassword').value, create: false };
    store.set('andrade-nickname', name);
    if (!store.set('andrade-session:' + selectedCode, data, true)) { $('accessError').textContent = 'Permita o armazenamento da página para continuar.'; return; }
    location.href = 'room.html?id=' + encodeURIComponent(selectedCode);
  });
  registerTools([{ name: 'start_andrade_room_access', title: 'Abrir entrada de uma sala ANDRADE', description: 'Valida o código e abre o formulário de apelido. Não entra nem ativa mídia.', inputSchema: { type: 'object', properties: { code: { type: 'string', pattern: '^AND-[A-Z0-9]{4}$' } }, required: ['code'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input) => { if (!input || typeof input.code !== 'string') throw new Error('Código obrigatório.'); return startJoin(normalizeCode(input.code)); } }]);
})();
