/* ANDRADE — sala, mídia local, chat, participantes e permissões do host. */
(function () {
  'use strict';
  const A = window.Andrade, $ = A.$;
  const code = A.normalizeCode(new URLSearchParams(location.search).get('id'));
  const state = { connected: false, host: false, participants: [], screenOwner: null, locked: false, private: false, mic: false, camera: false, screen: false, audio: true, tab: 'chat', unread: 0, activities: [], remoteStreams: new Map(), busy: new Set(), startedAt: Date.now() };
  let signal, rtc, screenStream, cameraStream, micStream, session, joinTimeout, confirmCallback;
  let closing = false;
  const initials = (name) => (String(name || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('')).toUpperCase();
  const clock = (time) => new Date(time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function activity(text) {
    const entry = { text, time: Date.now() }; state.activities.push(entry); if (state.activities.length > 150) state.activities.shift();
    const li = document.createElement('li'), time = document.createElement('time'), body = document.createElement('span'); time.textContent = clock(entry.time); body.textContent = text; li.append(time, body); $('activityList').prepend(li); if ($('activityList').children.length > 150) $('activityList').lastChild.remove();
  }
  function status(text, mode = '') { $('roomConnection').className = 'connection-pill ' + mode; $('roomConnection').innerHTML = '<i class="status-dot"></i><span></span>'; $('roomConnection').lastChild.textContent = text; }
  function setIcon(button, name) { const target = button.querySelector('[data-icon]'); if (target) { target.dataset.icon = name; target.innerHTML = A.icon(name); } }
  function controls() {
    $('micButton').setAttribute('aria-pressed', state.mic); setIcon($('micButton'), state.mic ? 'mic' : 'mic-off');
    $('cameraButton').setAttribute('aria-pressed', state.camera);
    $('shareButton').setAttribute('aria-pressed', state.screen);
    $('audioButton').setAttribute('aria-pressed', state.audio); setIcon($('audioButton'), state.audio ? 'volume' : 'volume-off');
    $('stopButton').disabled = !state.screen;
    $('shareButton').querySelector('span:nth-child(2)').textContent = state.screen ? 'TRANSMITINDO' : 'COMPARTILHAR TELA';
    $('cameraPreview').hidden = !state.camera;
    $('manageButton').hidden = !state.host || !state.connected;
    $('lockRoom').checked = state.locked;
    $('privacyLabel').textContent = state.locked ? 'ENTRADAS BLOQUEADAS' : state.private ? 'SALA PRIVADA' : 'SALA ABERTA';
    const screenActive = state.screenOwner || state.screen;
    $('waitingScreen').hidden = !!screenActive && !!$('screenVideo').srcObject;
    $('screenVideo').hidden = !$('waitingScreen').hidden ? true : false;
    $('videoStage').classList.toggle('is-sharing', !!screenActive && !!$('screenVideo').srcObject);
    $('liveDot').classList.toggle('live', !!screenActive);
    $('stageDetail').textContent = screenActive ? 'LIVE / TRANSMISSÃO ATIVA' : 'PRONTO PARA TRANSMITIR';
  }
  function updateMedia() { if (state.connected) signal.send('media', { mic: state.mic, camera: state.camera }); controls(); }
  async function guarded(key, action) { if (state.busy.has(key)) return; if (!state.connected) { A.openDialog($('roomAccessModal')); return; } state.busy.add(key); try { await action(); } catch (error) { A.toast(A.errorMessage(error), true); } finally { state.busy.delete(key); controls(); } }
  function requireMedia(kind) {
    if (!rtc) throw new Error('WebRTC não está disponível neste navegador. Use outro navegador para transmitir.');
    if (!window.isSecureContext) throw new Error('Use HTTPS ou localhost para acessar tela, câmera e microfone.');
    if (!navigator.mediaDevices?.[kind]) throw new Error(kind === 'getDisplayMedia' ? 'Este navegador não permite compartilhar a tela. Você ainda pode assistir e conversar. No computador, use um navegador compatível.' : 'A captura de mídia não está disponível neste navegador.');
  }

  async function shareScreen() {
    return guarded('screen', async () => {
      if (state.screen) { A.toast('Sua tela já está sendo compartilhada. Use PARAR para encerrar.'); return; }
      if (state.screenOwner && state.screenOwner !== signal.id) throw new Error('Aguarde a transmissão atual terminar para compartilhar sua tela.');
      requireMedia('getDisplayMedia');
      // A permissão sempre nasce deste clique; não existe captura automática.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      try { await signal.request('share-start'); }
      catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
      if (!state.connected || stream.getVideoTracks()[0]?.readyState !== 'live') { stream.getTracks().forEach((track) => track.stop()); signal.send('share-stop'); return; }
      screenStream = stream; state.screen = true; state.screenOwner = signal.id;
      $('screenVideo').srcObject = stream; $('screenVideo').muted = true;
      rtc.setStream('screen', stream);
      stream.getVideoTracks()[0].addEventListener('ended', stopScreen, { once: true });
      $('stageLabel').textContent = 'VOCÊ ESTÁ COMPARTILHANDO';
      activity('Você iniciou o compartilhamento de tela.'); controls();
    });
  }
  function stopScreen(notify = true) {
    const stream = screenStream; screenStream = null; state.screen = false;
    if (stream) { stream.getTracks().forEach((track) => track.stop()); rtc?.removeStream('screen'); activity('Você parou o compartilhamento de tela.'); }
    if (state.screenOwner === signal?.id) { state.screenOwner = null; $('screenVideo').srcObject = null; }
    if (notify && state.connected && stream) signal.send('share-stop');
    $('stageLabel').textContent = code; controls();
  }
  function stopMic() { if (micStream) { micStream.getTracks().forEach((track) => track.stop()); micStream = null; } rtc?.removeStream('mic'); state.mic = false; updateMedia(); }
  async function toggleMic() {
    return guarded('mic', async () => {
      if (state.mic) { stopMic(); activity('Você desligou o microfone.'); return; }
      requireMedia('getUserMedia'); const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      if (!state.connected) { stream.getTracks().forEach((track) => track.stop()); return; }
      micStream = stream; state.mic = true; rtc.setStream('mic', stream);
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (micStream === stream) { stopMic(); A.toast('Seu microfone foi desconectado.'); } }, { once: true });
      updateMedia(); activity('Você ligou o microfone.');
    });
  }
  function stopCamera() { if (cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; } rtc?.removeStream('camera'); $('cameraVideo').srcObject = null; state.camera = false; updateMedia(); }
  async function toggleCamera() {
    return guarded('camera', async () => {
      if (state.camera) { stopCamera(); activity('Você desligou a câmera.'); return; }
      requireMedia('getUserMedia');
      // Áudio e vídeo são solicitados juntos; o áudio só é enviado se o usuário
      // ativar o microfone. Tracks não utilizados são imediatamente encerrados.
      const capture = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      capture.getAudioTracks().forEach((track) => track.stop());
      if (!state.connected) { capture.getTracks().forEach((track) => track.stop()); return; }
      cameraStream = new MediaStream(capture.getVideoTracks()); const stream = cameraStream;
      $('cameraVideo').srcObject = stream; state.camera = true; rtc.setStream('camera', stream);
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (cameraStream === stream) { stopCamera(); A.toast('Sua câmera foi desconectada.'); } }, { once: true });
      updateMedia(); activity('Você ligou a câmera.');
    });
  }
  async function playMedia(element) { try { await element.play(); } catch (_) { if (!element.muted) $('audioUnlock').hidden = false; } }
  function applyAudio() {
    $('screenVideo').muted = state.screenOwner === signal?.id || !state.audio;
    $('remoteAudio').querySelectorAll('audio').forEach((audio) => { audio.muted = !state.audio; if (state.audio) playMedia(audio); });
    if (state.audio && $('screenVideo').srcObject) playMedia($('screenVideo'));
    controls();
  }
  function toggleAudio() { state.audio = !state.audio; applyAudio(); A.toast(state.audio ? 'Áudio da sala ativado.' : 'Áudio da sala silenciado neste dispositivo.'); }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else throw new Error('Tela cheia não está disponível neste navegador.'); } catch (err) { A.toast(A.errorMessage(err), true); } }

  function syncRemoteMedia() {
    for (const [key, item] of state.remoteStreams) {
      const person = state.participants.find((p) => p.id === item.peerId);
      if (!person) { removeRemote(key); continue; }
      if (item.kind === 'screen' && item.peerId === state.screenOwner && item.peerId !== signal?.id) {
        if ($('screenVideo').srcObject !== item.stream) { $('screenVideo').srcObject = item.stream; $('screenVideo').muted = !state.audio; playMedia($('screenVideo')); }
        $('stageLabel').textContent = person.name + ' ESTÁ COMPARTILHANDO';
      }
      if (item.kind === 'camera' && person.camera) {
        if (!item.element) { const box = document.createElement('div'); box.className = 'remote-camera'; const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true; const label = document.createElement('span'); label.textContent = person.name; box.append(video, label); $('remoteCameras').append(box); item.element = box; video.srcObject = item.stream; playMedia(video); }
      } else if (item.kind === 'camera' && item.element) { item.element.remove(); item.element = null; }
      if (item.kind === 'mic') {
        if (!item.element) { const audio = document.createElement('audio'); audio.autoplay = true; audio.srcObject = item.stream; audio.muted = !state.audio; $('remoteAudio').append(audio); item.element = audio; playMedia(audio); }
        item.element.muted = !state.audio || !person.mic;
      }
    }
    if (!state.screenOwner && !state.screen) { $('screenVideo').srcObject = null; $('stageLabel').textContent = code; }
    controls();
  }
  function removeRemote(key) { const item = state.remoteStreams.get(key); if (!item) return; item.element?.remove(); if ($('screenVideo').srcObject === item.stream) $('screenVideo').srcObject = null; state.remoteStreams.delete(key); }
  function removePeerMedia(peerId) { for (const [key, item] of state.remoteStreams) if (item.peerId === peerId) removeRemote(key); }

  function renderPeople() {
    $('peopleList').replaceChildren(); const count = String(state.participants.length).padStart(2, '0'); $('peopleCount').textContent = count; $('peopleHeadingCount').textContent = count;
    for (const person of state.participants) {
      const li = document.createElement('li'); li.className = 'person';
      const main = document.createElement('div'); main.className = 'person-main';
      const avatar = document.createElement('span'); avatar.className = 'avatar' + (person.host ? ' avatar-blue' : ''); avatar.textContent = initials(person.name);
      const name = document.createElement('div'); name.className = 'person-name'; const strong = document.createElement('strong'); strong.textContent = person.name + (person.id === signal?.id ? ' (você)' : '');
      const label = document.createElement('span'); label.textContent = person.host ? 'HOST' : 'PARTICIPANTE'; name.append(strong, label); main.append(avatar, name); li.append(main);
      const media = document.createElement('div'); media.className = 'person-media';
      for (const [key, text, icon] of [['mic', 'MIC', 'mic'], ['camera', 'CAM', 'camera'], ['screen', 'SCREEN', 'screen']]) { const tag = document.createElement('span'); tag.className = person[key] ? 'on' : ''; tag.innerHTML = A.icon(icon); tag.append(document.createTextNode(text)); media.append(tag); } li.append(media);
      if (state.host && person.id !== signal.id) {
        const actions = document.createElement('div'); actions.className = 'person-actions';
        const mute = document.createElement('button'); mute.textContent = 'Silenciar'; mute.disabled = !person.mic; mute.addEventListener('click', () => hostAction('mute', { target: person.id }, person.name + ' foi silenciado.'));
        const kick = document.createElement('button'); kick.textContent = 'Remover'; kick.addEventListener('click', () => confirm('Remover participante?', person.name + ' será desconectado desta sala.', () => hostAction('kick', { target: person.id }, person.name + ' foi removido.')));
        actions.append(mute, kick); li.append(actions);
      }
      $('peopleList').append(li);
    }
  }
  function updateRoom(data, initial = false) {
    const old = new Map(state.participants.map((p) => [p.id, p]));
    if (!initial) {
      for (const p of data.participants || []) if (!old.has(p.id)) activity(p.name + ' entrou na sala.');
      for (const p of state.participants) if (!(data.participants || []).some((m) => m.id === p.id)) activity(p.name + ' saiu da sala.');
    }
    state.participants = data.participants || []; state.host = data.hostId === signal?.id; state.private = !!data.private; state.locked = !!data.locked; state.screenOwner = data.screenOwner || null;
    if (state.screen && state.screenOwner !== signal?.id) stopScreen(false);
    rtc?.syncParticipants(state.participants);
    renderPeople(); syncRemoteMedia(); controls();
  }
  function addMessage(data) {
    $('chatWelcome')?.remove();
    const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 100;
    const item = document.createElement('article'); item.className = 'message' + (data.sender === signal?.id ? ' self' : '');
    const avatar = document.createElement('span'); avatar.className = 'avatar' + (data.sender === signal?.id ? ' avatar-blue' : ''); avatar.textContent = initials(data.name);
    const body = document.createElement('div'); body.className = 'message-body'; const head = document.createElement('div'); head.className = 'message-head'; const author = document.createElement('strong'); author.textContent = data.name; const time = document.createElement('time'); time.textContent = clock(data.timestamp); time.dateTime = new Date(data.timestamp).toISOString(); head.append(author, time);
    const text = document.createElement('p'); text.textContent = data.text; body.append(head, text); item.append(avatar, body); $('messages').append(item);
    if ($('messages').children.length > 300) $('messages').firstChild.remove();
    if (nearBottom || data.sender === signal?.id) $('messages').scrollTop = $('messages').scrollHeight;
    if (data.sender !== signal?.id && (state.tab !== 'chat' || (matchMedia('(max-width: 768px)').matches && !$('chatPanel').classList.contains('drawer-open')))) { state.unread++; unread(); }
  }
  function unread() { for (const id of ['unreadBadge', 'mobileUnread']) { $(id).textContent = String(state.unread); $(id).hidden = !state.unread; } }
  async function sendChat() {
    const text = $('chatInput').value.trim(); if (!text) return;
    if (!state.connected) { A.toast('Você precisa estar conectado à sala.', true); return; }
    $('sendMessage').disabled = true;
    try { await signal.request('chat', { text }); $('chatInput').value = ''; $('chatInput').style.height = 'auto'; }
    catch (err) { A.toast(A.errorMessage(err), true); }
    finally { $('sendMessage').disabled = false; $('chatInput').focus(); }
  }
  function setTab(tab, open = false) {
    state.tab = tab; $('chatView').hidden = tab !== 'chat'; $('peopleView').hidden = tab !== 'people';
    for (const button of document.querySelectorAll('[data-tab]')) { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-selected', button.dataset.tab === tab); button.tabIndex = button.dataset.tab === tab ? 0 : -1; }
    if (tab === 'chat') { state.unread = 0; unread(); }
    if (open && matchMedia('(max-width: 768px)').matches) { $('chatPanel').classList.add('drawer-open'); $('drawerBackdrop').hidden = false; document.body.style.overflow = 'hidden'; }
  }
  function closeDrawer() { $('chatPanel').classList.remove('drawer-open'); $('drawerBackdrop').hidden = true; document.body.style.overflow = ''; $('mobileChatButton').focus(); }
  async function hostAction(type, payload, success) {
    if (!state.host) { A.toast('Somente o host pode gerenciar a sala.', true); return; }
    try { await signal.request(type, payload); if (success) { A.toast(success); activity(success); } return true; } catch (err) { A.toast(A.errorMessage(err), true); controls(); return false; }
  }
  function confirm(title, description, callback) { $('confirmTitle').textContent = title; $('confirmDescription').textContent = description; confirmCallback = callback; A.openDialog($('confirmModal')); }
  async function connect(data) {
    if (!A.validCode(code)) return;
    signal?.close(); rtc?.close(); rtc = null; clearTimeout(joinTimeout); state.connected = false; state.host = false;
    for (const key of state.remoteStreams.keys()) removeRemote(key);
    session = { ...data, code }; signal = new window.AndradeSignal();
    status('CONECTANDO', 'is-pending');
    A.setBusy($('roomAccessSubmit'), true, 'CONECTANDO...');
    signal.addEventListener('welcome', (event) => {
      clearTimeout(joinTimeout); state.connected = true; state.startedAt = Date.now();
      if (!window.RTCPeerConnection) { A.toast('WebRTC não está disponível neste navegador. O chat continua acessível.', true); }
      else {
        rtc = new window.AndradeRTC(signal);
        rtc.addEventListener('stream', (e) => { const info = e.detail, key = info.peerId + ':' + info.kind; const old = state.remoteStreams.get(key); if (old?.stream.id !== info.stream.id) { removeRemote(key); state.remoteStreams.set(key, info); } syncRemoteMedia(); });
        rtc.addEventListener('streamstopped', (e) => { removeRemote(e.detail.peerId + ':' + e.detail.kind); controls(); });
        rtc.addEventListener('peerleft', (e) => { removePeerMedia(e.detail.peerId); controls(); });
        rtc.addEventListener('connection', (e) => { if (e.detail.state === 'failed') A.toast('A mídia não conectou com um participante. A rede pode exigir um servidor TURN.', true); });
        rtc.addEventListener('error', (e) => { console.warn('ANDRADE WebRTC:', e.detail.message); });
      }
      updateRoom(event.detail, true); status(signal.local ? 'MODO LOCAL' : 'CONECTADO', signal.local ? 'is-pending' : '');
      $('modeNotice').hidden = !signal.local; $('transportLabel').textContent = signal.local ? 'ANDRADE / MODO LOCAL' : 'ANDRADE / LIVE ROOM';
      $('headerCode').textContent = code; $('stageLabel').textContent = code; $('selfName').textContent = session.name; $('selfAvatar').textContent = initials(session.name); $('selfRole').textContent = state.host ? 'HOST / VOCÊ' : 'PARTICIPANTE / VOCÊ';
      $('roomTitle').firstChild.textContent = state.host ? 'Sua sala está pronta' : 'Você está na sala';
      session.create = false; delete session.password; A.store.set('andrade-session:' + code, session, true); A.store.set('andrade-nickname', session.name);
      $('roomAccessModal').close(); A.setBusy($('roomAccessSubmit'), false); activity(state.host ? 'Você abriu a sala ' + code + '.' : 'Você entrou na sala ' + code + '.');
    });
    signal.addEventListener('room', (e) => { if (state.connected) updateRoom(e.detail); });
    signal.addEventListener('chat', (e) => addMessage(e.detail));
    signal.addEventListener('host-offline', (e) => { activity(e.detail.message); A.toast(e.detail.message); });
    signal.addEventListener('error', (e) => joinError(e.detail));
    signal.addEventListener('disconnected', (e) => disconnected(e.detail.message));
    signal.addEventListener('mute', () => { stopMic(); A.toast('Seu microfone foi silenciado pelo host.'); activity('O host silenciou seu microfone.'); });
    signal.addEventListener('removed', (e) => terminated(e.detail.message));
    signal.addEventListener('ended', (e) => terminated(e.detail.message));
    joinTimeout = setTimeout(() => { if (!state.connected) joinError({ message: 'A conexão demorou demais. Tente novamente.' }); }, 11000);
    try { await signal.connect(session); } catch (error) { joinError({ message: A.errorMessage(error) }); }
  }
  function joinError(error) {
    clearTimeout(joinTimeout); signal?.close(); state.connected = false; A.setBusy($('roomAccessSubmit'), false); status('DESCONECTADO', 'is-offline');
    $('roomAccessError').textContent = error.message || 'Não foi possível entrar.';
    if (error.code === 'PASSWORD_REQUIRED') { $('roomPasswordFields').hidden = false; $('roomPassword').required = true; }
    $('roomNickname').value = session?.name || A.store.get('andrade-nickname', ''); A.openDialog($('roomAccessModal'));
  }
  function cleanup() { state.connected = false; stopScreen(false); stopMic(); stopCamera(); rtc?.close(); signal?.close(); for (const key of state.remoteStreams.keys()) removeRemote(key); $('screenVideo').srcObject = null; state.screenOwner = null; controls(); }
  function disconnected(message) { if (closing) return; cleanup(); status('DESCONECTADO', 'is-offline'); activity(message); joinError({ message }); }
  function terminated(message) {
    if (closing) return; closing = true; cleanup(); A.store.remove('andrade-session:' + code, true);
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('noticeTitle').textContent = 'A sala foi encerrada.'; $('noticeModal').querySelector('.modal-description').textContent = message; $('noticeModal').querySelector('p:not(.modal-description)').textContent = 'Volte ao início para criar ou entrar em outra sala ANDRADE.';
    const b = $('noticeModal').querySelector('.full-width'); b.textContent = 'VOLTAR AO INÍCIO'; b.onclick = () => { location.href = 'index.html'; }; A.openDialog($('noticeModal')); $('noticeModal').addEventListener('close', () => { location.href = 'index.html'; }, { once: true }); status('ENCERRADA', 'is-offline');
  }

  $('stageShareButton').addEventListener('click', shareScreen); $('shareButton').addEventListener('click', shareScreen); $('stopButton').addEventListener('click', () => stopScreen());
  $('micButton').addEventListener('click', toggleMic); $('cameraButton').addEventListener('click', toggleCamera); $('audioButton').addEventListener('click', toggleAudio); $('fullscreenButton').addEventListener('click', fullscreen);
  $('audioUnlock').addEventListener('click', () => { state.audio = true; $('audioUnlock').hidden = true; applyAudio(); });
  document.addEventListener('fullscreenchange', () => $('fullscreenButton').setAttribute('aria-pressed', !!document.fullscreenElement));
  for (const id of ['copyInvite', 'manageCopy']) $(id).addEventListener('click', () => A.copyInvite().catch(() => {}));
  $('activitiesButton').addEventListener('click', () => A.openDialog($('activitiesModal'))); $('shortcutsButton').addEventListener('click', () => A.openDialog($('shortcutsModal'))); $('modeDetails').addEventListener('click', () => A.openDialog($('noticeModal')));
  $('manageButton').addEventListener('click', () => { if (state.host) A.openDialog($('manageModal')); });
  $('lockRoom').addEventListener('change', () => hostAction('lock', { locked: $('lockRoom').checked }, $('lockRoom').checked ? 'Novas entradas bloqueadas.' : 'Novas entradas liberadas.'));
  $('passwordForm').addEventListener('submit', async (e) => { e.preventDefault(); if (await hostAction('password', { password: $('newPassword').value }, $('newPassword').value ? 'Senha da sala atualizada.' : 'A sala agora está aberta.')) $('newPassword').value = ''; });
  $('managePeople').addEventListener('click', () => { $('manageModal').close(); setTab('people', true); });
  $('endRoom').addEventListener('click', () => confirm('Encerrar sala?', 'Todos serão desconectados e a transmissão será interrompida.', () => hostAction('end', {})));
  $('confirmAction').addEventListener('click', async () => { $('confirmModal').close(); if (confirmCallback) await confirmCallback(); });
  $('leaveButton').addEventListener('click', () => confirm(state.host ? 'Encerrar e sair?' : 'Sair da sala?', state.host ? 'Como host, ao sair você encerra esta sala para todos.' : 'Sua câmera, microfone e transmissão serão desligados.', async () => { if (state.host && state.connected) { const done = await hostAction('end', {}); if (!done) return; } else { closing = true; cleanup(); A.store.remove('andrade-session:' + code, true); location.href = 'index.html'; } }));
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  $('chatInput').addEventListener('input', () => { $('chatInput').style.height = 'auto'; $('chatInput').style.height = Math.min($('chatInput').scrollHeight, 100) + 'px'; });
  document.querySelectorAll('[data-tab]').forEach((button) => { button.addEventListener('click', () => setTab(button.dataset.tab)); button.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = state.tab === 'chat' ? 'people' : 'chat'; setTab(next); $(next + 'Tab').focus(); } }); });
  $('mobileChatButton').addEventListener('click', () => { setTab('chat', true); $('chatTab').focus(); }); $('closeDrawer').addEventListener('click', closeDrawer); $('drawerBackdrop').addEventListener('click', closeDrawer);
  matchMedia('(max-width: 768px)').addEventListener('change', (e) => { if (!e.matches) { $('drawerBackdrop').hidden = true; $('chatPanel').classList.remove('drawer-open'); document.body.style.overflow = ''; } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('chatPanel').classList.contains('drawer-open')) closeDrawer();
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]') || e.target.closest('input, textarea, select, [contenteditable=true]')) return;
    const action = { m: toggleMic, v: toggleCamera, s: shareScreen, c: () => { setTab('chat', true); $('chatInput').focus(); }, f: fullscreen }[e.key.toLowerCase()];
    if (action) { e.preventDefault(); action(); }
  });
  $('roomAccessForm').addEventListener('submit', (e) => { e.preventDefault(); const name = $('roomNickname').value.trim(); if (name.length < 2) { $('roomAccessError').textContent = 'Use pelo menos 2 caracteres no apelido.'; return; } $('roomAccessError').textContent = ''; connect({ ...session, name, password: $('roomPassword').value }); });
  window.addEventListener('pagehide', () => { closing = true; cleanup(); });
  setInterval(() => { if (!state.connected) return; const s = Math.floor((Date.now() - state.startedAt) / 1000); $('sessionTimer').textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':'); }, 1000);
  $('headerCode').textContent = code || '—'; $('roomAccessCode').textContent = code || 'CÓDIGO INVÁLIDO'; $('peopleLimit').textContent = 'MÁX. ' + String(window.ANDRADE_CONFIG.maxParticipants).padStart(2, '0');
  if (!A.validCode(code)) { $('roomAccessError').textContent = 'O link não contém um código válido. Volte ao início para criar ou entrar em uma sala.'; $('roomAccessSubmit').disabled = true; status('LINK INVÁLIDO', 'is-offline'); A.openDialog($('roomAccessModal')); }
  else {
    session = A.store.get('andrade-session:' + code, null, true);
    if (session?.name) connect(session);
    else { $('roomNickname').value = A.store.get('andrade-nickname', ''); const info = A.store.get('andrade-room:' + code); $('roomPasswordFields').hidden = !info?.private; $('roomPassword').required = !!info?.private; A.openDialog($('roomAccessModal')); }
  }
  A.registerTools([
    { name: 'read_andrade_room_state', title: 'Consultar sala ANDRADE', description: 'Lê código, estado da conexão e participantes visíveis. Não ativa mídia.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => ({ code, connected: state.connected, local: !!signal?.local, host: state.host, locked: state.locked, private: state.private, participants: state.participants.map((p) => ({ name: p.name, host: p.host, mic: p.mic, camera: p.camera, screen: p.screen })) }) },
    { name: 'show_andrade_room_panel', title: 'Abrir painel da sala', description: 'Alterna entre chat e participantes na interface. Não envia mensagens.', inputSchema: { type: 'object', properties: { panel: { type: 'string', enum: ['chat', 'people'] } }, required: ['panel'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: (input) => { if (!input || !['chat', 'people'].includes(input.panel)) throw new Error('Painel inválido.'); setTab(input.panel, true); return { panel: state.tab }; } }
  ]);
})();
