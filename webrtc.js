/* ANDRADE — sinalização WebSocket/aba local + WebRTC mesh.
 * A sinalização é separada da mídia. Nunca envie áudio/vídeo pelo WebSocket.
 * O servidor incluído implementa exatamente o protocolo usado aqui.
 */
(function () {
  'use strict';
  const A = window.Andrade;
  const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }));
  async function digest(text) { if (!crypto.subtle) throw new Error('Use HTTPS ou localhost para proteger a sala.'); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (n) => n.toString(16).padStart(2, '0')).join(''); }
  const safeName = (value) => String(value || '').trim().slice(0, 24);

  class RoomSignal extends EventTarget {
    constructor() { super(); this.pending = new Map(); this.connected = false; this.closed = false; this.local = !window.ANDRADE_CONFIG.websocketUrl; }
    async connect(session) {
      this.session = session;
      if (this.local) {
        this.transport = new LocalRoom(session);
        this.transport.addEventListener('data', (event) => this.receive(event.detail));
        await this.transport.start();
      } else {
        this.socket = new WebSocket(window.ANDRADE_CONFIG.websocketUrl);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { this.socket.close(); reject(new Error('O servidor não respondeu. Tente entrar novamente.')); }, 8000);
          this.socket.onopen = () => { clearTimeout(timeout); resolve(); };
          this.socket.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível conectar ao servidor ANDRADE.')); };
        });
        this.socket.onmessage = (event) => { try { this.receive(JSON.parse(event.data)); } catch (_) { /* Ignore mensagens inválidas. */ } };
        this.socket.onclose = () => { if (!this.closed) { this.connected = false; emit(this, 'disconnected', { message: 'Conexão interrompida. Entre novamente para continuar.' }); } this.rejectPending(); };
        this.socket.send(JSON.stringify({ type: 'join', code: session.code, name: session.name, password: session.password || '', hostToken: session.hostToken || '', create: !!session.create }));
      }
    }
    receive(message) {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'welcome') { this.id = message.selfId; this.connected = true; }
      if (message.type === 'ack' && message.requestId) {
        const req = this.pending.get(message.requestId); if (!req) return;
        clearTimeout(req.timer); this.pending.delete(message.requestId);
        if (message.ok) req.resolve(message); else { const error = new Error(message.message || 'Ação não autorizada.'); error.code = message.code; req.reject(error); } return;
      }
      emit(this, message.type, message);
    }
    send(type, payload = {}) {
      if (this.closed) return;
      const message = { ...payload, type };
      if (this.local) this.transport?.send(message);
      else if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }
    request(type, payload = {}) {
      if (!this.connected) return Promise.reject(new Error('Entre na sala antes de continuar.'));
      return new Promise((resolve, reject) => {
        const requestId = A.randomToken(8);
        const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('A sala não respondeu. Tente novamente.')); }, 6000);
        this.pending.set(requestId, { resolve, reject, timer }); this.send(type, { ...payload, requestId });
      });
    }
    rejectPending() { for (const req of this.pending.values()) { clearTimeout(req.timer); req.reject(new Error('Conexão encerrada.')); } this.pending.clear(); }
    close() { if (this.closed) return; this.closed = true; this.connected = false; this.transport?.close(); this.socket?.close(); this.rejectPending(); }
  }

  // Modo de testes: somente este navegador/origem. Não substitui o servidor.
  class LocalRoom extends EventTarget {
    constructor(session) { super(); this.session = session; this.code = session.code; this.id = A.randomToken(10); this.members = new Map(); this.lastRoom = Date.now(); this.key = 'andrade-room:' + this.code; }
    deliver(data) { emit(this, 'data', data); }
    broadcast(data, target = '') { if (!target || target === this.id) this.deliver(data); if (this.channel) this.channel.postMessage({ kind: 'server', data, target, sender: this.id }); }
    snapshot() { return { hostId: this.id, private: !!this.record.private, locked: !!this.record.locked, screenOwner: this.screenOwner || null, participants: Array.from(this.members.values(), (m) => ({ id: m.id, name: m.name, host: m.id === this.id, mic: !!m.mic, camera: !!m.camera, screen: this.screenOwner === m.id })) }; }
    save() { this.record.updatedAt = Date.now(); A.store.set(this.key, this.record); }
    publish() { this.save(); this.broadcast({ type: 'room', ...this.snapshot() }); }
    async start() {
      const stored = A.store.get(this.key); const tokenHash = this.session.hostToken ? await digest(this.session.hostToken) : '';
      this.isHost = !!this.session.create || !!(tokenHash && stored?.hostTokenHash === tokenHash);
      if (this.session.create && stored && stored.hostTokenHash !== tokenHash && Date.now() - stored.updatedAt < 120000) { this.deliver({ type: 'error', code: 'ROOM_EXISTS', message: 'Este código já está em uso. Crie outra sala.' }); return; }
      if ('BroadcastChannel' in window) { this.channel = new BroadcastChannel('andrade-live:' + this.code); this.channel.onmessage = (event) => this.receive(event.data); }
      if (this.isHost) {
        this.record = stored?.hostTokenHash === tokenHash ? stored : { private: !!this.session.password, locked: false, passSalt: A.randomToken(12), hostTokenHash: tokenHash };
        if (!this.record.passHash && this.record.private) this.record.passHash = await digest(this.record.passSalt + this.session.password);
        this.record.hostId = this.id; this.members.set(this.id, { id: this.id, name: this.session.name, seen: Date.now() }); this.save();
        this.deliver({ type: 'welcome', selfId: this.id, ...this.snapshot() });
        this.timer = setInterval(() => { for (const [id, m] of this.members) if (id !== this.id && Date.now() - m.seen > 10000) { this.members.delete(id); if (this.screenOwner === id) this.screenOwner = null; } this.publish(); }, 2500);
      } else {
        if (!stored || Date.now() - stored.updatedAt > 120000) { this.deliver({ type: 'error', code: 'NOT_FOUND', message: 'Sala local indisponível. Abra a sala no mesmo navegador ou use o servidor ANDRADE.' }); return; }
        this.hostId = stored.hostId; const proof = stored.private ? await digest(stored.passSalt + (this.session.password || '')) : '';
        this.channel?.postMessage({ kind: 'join', sender: this.id, name: this.session.name, proof });
        this.joinTimer = setTimeout(() => this.deliver({ type: 'error', code: 'NOT_FOUND', message: 'O host local não respondeu. Mantenha a aba dele aberta ou use o servidor ANDRADE.' }), 6000);
      }
    }
    async receive(envelope) {
      if (!envelope || typeof envelope !== 'object') return;
      if (this.isHost && envelope.kind === 'join') {
        const reject = (code, message) => this.broadcast({ type: 'error', code, message }, envelope.sender);
        if (this.record.locked) return reject('LOCKED', 'O host bloqueou novas entradas.');
        if (this.record.private && envelope.proof !== this.record.passHash) return reject('PASSWORD_REQUIRED', 'Digite a senha correta da sala.');
        if (this.members.size >= window.ANDRADE_CONFIG.maxParticipants) return reject('FULL', 'Esta sala está cheia.');
        if (safeName(envelope.name).length < 2) return reject('INVALID_NAME', 'Escolha um apelido com pelo menos 2 caracteres.');
        this.members.set(envelope.sender, { id: envelope.sender, name: safeName(envelope.name), seen: Date.now() });
        this.broadcast({ type: 'welcome', selfId: envelope.sender, ...this.snapshot() }, envelope.sender); this.publish(); return;
      }
      if (this.isHost && envelope.kind === 'client' && this.members.has(envelope.sender)) { await this.handle(envelope.sender, envelope.data); return; }
      if (!this.isHost && envelope.kind === 'server' && envelope.sender === this.hostId && (!envelope.target || envelope.target === this.id)) {
        const data = envelope.data;
        if (data.type === 'welcome') { clearTimeout(this.joinTimer); this.lastRoom = Date.now(); this.timer = setInterval(() => { this.send({ type: 'heartbeat' }); if (Date.now() - this.lastRoom > 12000) { clearInterval(this.timer); this.deliver({ type: 'disconnected', message: 'O host saiu ou perdeu a conexão.' }); } }, 3000); }
        if (data.type === 'room') this.lastRoom = Date.now();
        if (data.type === 'error') clearTimeout(this.joinTimer);
        this.deliver(data);
      }
    }
    send(data) { if (this.isHost) this.handle(this.id, data).catch((err) => this.deliver({ type: 'error', message: A.errorMessage(err) })); else this.channel?.postMessage({ kind: 'client', sender: this.id, data }); }
    async handle(id, message) {
      const member = this.members.get(id); if (!member) return;
      const ack = (ok, text) => { if (message.requestId) this.broadcast({ type: 'ack', requestId: message.requestId, ok, message: text }, id); };
      const hostActions = ['lock', 'password', 'kick', 'mute', 'end'];
      if (hostActions.includes(message.type) && id !== this.id) return ack(false, 'Somente o host pode fazer isso.');
      member.seen = Date.now();
      switch (message.type) {
        case 'heartbeat': return;
        case 'signal': if (this.members.has(message.to)) this.broadcast({ type: 'signal', from: id, data: message.data }, message.to); return;
        case 'chat': { const text = String(message.text || '').trim().slice(0, 1000); if (!text) return ack(false, 'Escreva uma mensagem.'); this.broadcast({ type: 'chat', id: A.randomToken(8), sender: id, name: member.name, text, timestamp: Date.now() }); break; }
        case 'media': member.mic = !!message.mic; member.camera = !!message.camera; this.publish(); break;
        case 'share-start': if (this.screenOwner && this.screenOwner !== id) return ack(false, 'Alguém já está compartilhando. Aguarde a transmissão terminar.'); this.screenOwner = id; this.publish(); break;
        case 'share-stop': if (this.screenOwner === id) { this.screenOwner = null; this.publish(); } break;
        case 'lock': this.record.locked = !!message.locked; this.publish(); break;
        case 'password': { const password = String(message.password || ''); if (password && password.length < 4) return ack(false, 'A senha deve ter pelo menos 4 caracteres.'); this.record.private = !!password; this.record.passSalt = A.randomToken(12); this.record.passHash = password ? await digest(this.record.passSalt + password) : ''; this.publish(); break; }
        case 'kick': if (message.target === this.id || !this.members.has(message.target)) return ack(false, 'Participante inválido.'); this.broadcast({ type: 'removed', message: 'O host removeu você da sala.' }, message.target); this.members.delete(message.target); if (this.screenOwner === message.target) this.screenOwner = null; this.publish(); break;
        case 'mute': if (message.target === this.id || !this.members.has(message.target)) return ack(false, 'Participante inválido.'); this.broadcast({ type: 'mute', message: 'Seu microfone foi silenciado pelo host.' }, message.target); this.members.get(message.target).mic = false; this.publish(); break;
        case 'end': ack(true); this.broadcast({ type: 'ended', message: 'O host encerrou a sala.' }); A.store.remove(this.key); clearInterval(this.timer); return;
        case 'leave': this.members.delete(id); if (this.screenOwner === id) this.screenOwner = null; this.publish(); break;
        default: return ack(false, 'Ação desconhecida.');
      }
      ack(true);
    }
    close() { clearInterval(this.timer); clearTimeout(this.joinTimer); if (this.isHost) this.broadcast({ type: 'disconnected', message: 'O host local desconectou.' }); else this.send({ type: 'leave' }); this.channel?.close(); }
  }

  class RTCMesh extends EventTarget {
    constructor(signal) {
      super(); this.signal = signal; this.id = signal.id; this.peers = new Map(); this.streams = new Map();
      signal.addEventListener('signal', (event) => { this.handleSignal(event.detail.from, event.detail.data).catch((err) => emit(this, 'error', { message: A.errorMessage(err) })); });
    }
    ensurePeer(id) {
      if (id === this.id || !id) return null;
      if (this.peers.has(id)) return this.peers.get(id);
      const pc = new RTCPeerConnection({ iceServers: window.ANDRADE_CONFIG.iceServers });
      const peer = { pc, id, polite: this.id.localeCompare(id) > 0, makingOffer: false, ignoreOffer: false, settingAnswer: false, candidates: [], senders: new Map(), kinds: {}, incoming: new Map(), chain: Promise.resolve(), retries: 0 };
      this.peers.set(id, peer);
      pc.onicecandidate = (event) => { if (event.candidate) this.signal.send('signal', { to: id, data: { candidate: event.candidate.toJSON() } }); };
      // Perfect negotiation: rollback automático do peer polite resolve ofertas simultâneas.
      pc.onnegotiationneeded = async () => {
        try { peer.makingOffer = true; await pc.setLocalDescription(); this.signal.send('signal', { to: id, data: { description: pc.localDescription, kinds: this.streamKinds() } }); }
        catch (err) { if (pc.signalingState !== 'closed') emit(this, 'error', { message: A.errorMessage(err) }); }
        finally { peer.makingOffer = false; }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0]; if (!stream) return;
        peer.incoming.set(stream.id, stream);
        const publish = () => { const kind = peer.kinds[stream.id]; if (kind) emit(this, 'stream', { peerId: id, kind, stream }); };
        publish(); event.track.onunmute = publish;
        event.track.onended = () => emit(this, 'trackended', { peerId: id, streamId: stream.id });
      };
      pc.onconnectionstatechange = () => {
        emit(this, 'connection', { peerId: id, state: pc.connectionState });
        if (pc.connectionState === 'failed' && peer.retries++ < 2) pc.restartIce();
      };
      for (const [kind, stream] of this.streams) this.attach(peer, kind, stream);
      return peer;
    }
    streamKinds() { const kinds = {}; for (const [kind, stream] of this.streams) kinds[stream.id] = kind; return kinds; }
    attach(peer, kind, stream) { const list = stream.getTracks().filter((track) => track.readyState === 'live').map((track) => peer.pc.addTrack(track, stream)); peer.senders.set(kind, list); }
    async handleSignal(id, data) {
      if (!data || typeof data !== 'object') return;
      const peer = this.ensurePeer(id); if (!peer) return;
      peer.chain = peer.chain.then(async () => {
        const pc = peer.pc;
        if (pc.signalingState === 'closed') return;
        if (data.kinds) { peer.kinds = data.kinds; for (const [streamId, stream] of peer.incoming) if (peer.kinds[streamId]) emit(this, 'stream', { peerId: id, kind: peer.kinds[streamId], stream }); }
        if (data.description) {
          const ready = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingAnswer);
          const collision = data.description.type === 'offer' && !ready;
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;
          peer.settingAnswer = data.description.type === 'answer';
          try { await pc.setRemoteDescription(data.description); } finally { peer.settingAnswer = false; }
          for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate);
          if (data.description.type === 'offer') { await pc.setLocalDescription(); this.signal.send('signal', { to: id, data: { description: pc.localDescription, kinds: this.streamKinds() } }); }
        } else if (data.candidate && !peer.ignoreOffer) { if (!pc.remoteDescription) peer.candidates.push(data.candidate); else await pc.addIceCandidate(data.candidate); }
        else if (data.stopped) { for (const [streamId, kind] of Object.entries(peer.kinds)) if (kind === data.stopped) { delete peer.kinds[streamId]; peer.incoming.delete(streamId); } emit(this, 'streamstopped', { peerId: id, kind: data.stopped }); }
      }).catch((err) => { if (!peer.ignoreOffer && peer.pc.signalingState !== 'closed') emit(this, 'error', { message: A.errorMessage(err) }); });
      return peer.chain;
    }
    syncParticipants(participants) {
      const ids = new Set(participants.map((p) => p.id));
      for (const id of this.peers.keys()) if (!ids.has(id)) this.removePeer(id);
      for (const id of ids) if (id !== this.id) this.ensurePeer(id);
    }
    setStream(kind, stream) {
      this.removeStream(kind); this.streams.set(kind, stream);
      for (const peer of this.peers.values()) { this.attach(peer, kind, stream); this.signal.send('signal', { to: peer.id, data: { kinds: this.streamKinds() } }); }
    }
    removeStream(kind) {
      if (!this.streams.has(kind)) return;
      this.streams.delete(kind);
      for (const peer of this.peers.values()) { for (const sender of peer.senders.get(kind) || []) if (peer.pc.signalingState !== 'closed') peer.pc.removeTrack(sender); peer.senders.delete(kind); this.signal.send('signal', { to: peer.id, data: { stopped: kind } }); }
    }
    removePeer(id) { const peer = this.peers.get(id); if (!peer) return; peer.pc.onnegotiationneeded = null; peer.pc.close(); this.peers.delete(id); emit(this, 'peerleft', { peerId: id }); }
    close() { for (const id of Array.from(this.peers.keys())) this.removePeer(id); this.streams.clear(); }
  }
  window.AndradeSignal = RoomSignal;
  window.AndradeRTC = RTCMesh;
})();
