/**
 * ANDRADE — servidor de sinalização completo, sem banco de dados.
 * npm install && npm start. A mídia circula via WebRTC, não por este processo.
 * Em produção coloque este servidor atrás de HTTPS/WSS e configure TURN.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';

const scrypt = promisify(scryptCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A versão para download contém index.html na raiz /andrade.
let webRoot = path.join(root, 'dist');
try { await stat(webRoot); } catch { webRoot = root; }
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const MAX_PEOPLE = 8, ROOM_GRACE = 60000, ROOM_TTL = 6 * 60 * 60 * 1000;
const rooms = new Map(), limits = new Map(), ipConnections = new Map();
const publicOrigin = process.env.PUBLIC_ORIGIN || '';
const iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
if (process.env.TURN_URLS) {
  if (!process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) throw new Error('TURN_USERNAME e TURN_CREDENTIAL são obrigatórios quando TURN_URLS está definido.');
  iceServers.push({ urls: process.env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
}
const hash = (text) => createHash('sha256').update(text).digest();
function equal(a, b) { return !!a && !!b && a.length === b.length && timingSafeEqual(a, b); }
function rate(key, max, ms) { const now = Date.now(); const entry = limits.get(key); if (!entry || now > entry.until) { limits.set(key, { count: 1, until: now + ms }); return true; } return ++entry.count <= max; }
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function ack(ws, m, ok = true, message = '', code = '') { if (m.requestId) send(ws, { type: 'ack', requestId: m.requestId, ok, message, code }); }
function error(ws, code, message) { send(ws, { type: 'error', code, message }); }
function snapshot(room) { return { hostId: room.hostId, private: !!room.passwordHash, locked: room.locked, screenOwner: room.screenOwner, participants: Array.from(room.members.values(), (m) => ({ id: m.id, name: m.name, host: m.id === room.hostId, mic: m.mic, camera: m.camera, screen: room.screenOwner === m.id })) }; }
function broadcast(room, data) { for (const member of room.members.values()) send(member.ws, data); }
function publish(room) { broadcast(room, { type: 'room', ...snapshot(room) }); }
async function passwordData(password) { if (!password) return { passwordHash: null, salt: null }; const salt = randomBytes(16); return { passwordHash: await scrypt(password, salt, 32), salt }; }
function finishRoom(room, message = 'O host encerrou a sala.') { clearTimeout(room.hostTimer); rooms.delete(room.code); broadcast(room, { type: 'ended', message }); for (const member of room.members.values()) { member.ws.room = null; member.ws.close(1000, 'Sala encerrada'); } room.members.clear(); }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Método não permitido.'); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    // Configuração pública de conectividade, nunca credenciais de host/senha.
    // Credenciais TURN de produção devem ser temporárias (veja LEIA-ME).
    if (url.pathname === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('window.ANDRADE_CONFIG=' + JSON.stringify({ websocketUrl: '', iceServers, maxParticipants: MAX_PEOPLE }) + ';window.ANDRADE_CONFIG.websocketUrl=location.origin.replace(/^http/,"ws")+"/ws";'); return;
    }
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok","app":"ANDRADE"}'); return; }
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(webRoot, '.' + relative);
    // Somente os arquivos públicos: nunca .env, fontes do servidor ou node_modules.
    const allowed = /^\/(?:index\.html|room\.html|css\/style\.css|js\/(?:config|app|room|webrtc)\.js|assets\/(?:logo|icons|images)\/[A-Za-z0-9_.-]+)$/.test(relative);
    if (!allowed || !target.startsWith(webRoot + path.sep)) { res.writeHead(404); res.end('Arquivo não encontrado.'); return; }
    const bytes = await readFile(target); res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Arquivo não encontrado.'); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const ip = req.socket.remoteAddress || 'unknown';
  let valid = req.url === '/ws';
  try { const origin = new URL(req.headers.origin || ''); valid = valid && (publicOrigin ? origin.origin === new URL(publicOrigin).origin : origin.host === req.headers.host); } catch { valid = false; }
  if (!valid || !rate('upgrade:' + ip, 60, 60000) || (ipConnections.get(ip) || 0) >= 20) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.ip = ip; wss.emit('connection', ws); });
});

// Uma fila por código evita condições de corrida entre criação, senha e entradas.
const roomQueues = new Map();
function serialRoom(code, fn) { const prior = roomQueues.get(code) || Promise.resolve(); const next = prior.catch(() => {}).then(fn); roomQueues.set(code, next); next.finally(() => { if (roomQueues.get(code) === next) roomQueues.delete(code); }).catch(() => {}); return next; }
async function join(ws, m) {
  if (ws.room) return error(ws, 'ALREADY_JOINED', 'Você já está em uma sala.');
  if (!rate('join:' + ws.ip, 25, 60000)) return error(ws, 'RATE_LIMIT', 'Muitas tentativas. Aguarde um minuto.');
  const code = String(m.code || ''), name = String(m.name || '').trim(), password = String(m.password || ''), token = String(m.hostToken || '');
  if (!/^AND-[A-Z0-9]{4}$/.test(code) || name.length < 2 || name.length > 24 || password.length > 64 || token.length > 128) return error(ws, 'INVALID_INPUT', 'Código, apelido ou senha inválidos.');
  return serialRoom(code, async () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    let room = rooms.get(code); let isHost = false;
    if (m.create) {
      if (room) return error(ws, 'ROOM_EXISTS', 'Este código já está em uso. Crie outra sala.');
      if (!/^[a-f0-9]{64}$/.test(token)) return error(ws, 'INVALID_HOST', 'A credencial de criação é inválida.');
      if (password && password.length < 4) return error(ws, 'INVALID_PASSWORD', 'Use pelo menos 4 caracteres na senha.');
      if (rooms.size >= 1000 || !rate('create:' + ws.ip, 10, 60000)) return error(ws, 'RATE_LIMIT', 'Limite de salas atingido. Tente mais tarde.');
      const protection = await passwordData(password);
      if (ws.readyState !== WebSocket.OPEN) return;
      room = { code, members: new Map(), hostTokenHash: hash(token), hostId: ws.id, hostTimer: null, locked: false, screenOwner: null, createdAt: Date.now(), ...protection }; rooms.set(code, room); isHost = true;
    } else {
      if (!room) return error(ws, 'NOT_FOUND', 'Sala não encontrada ou encerrada. Confira o código.');
      isHost = token && equal(hash(token), room.hostTokenHash);
      if (!isHost) {
        if (room.locked) return error(ws, 'LOCKED', 'O host bloqueou novas entradas.');
        if (room.passwordHash && (!password || !equal(await scrypt(password, room.salt, 32), room.passwordHash))) return error(ws, 'PASSWORD_REQUIRED', 'Digite a senha correta da sala.');
      }
      if (ws.readyState !== WebSocket.OPEN || rooms.get(code) !== room) return;
      if (room.members.size >= MAX_PEOPLE && !isHost) return error(ws, 'FULL', 'Esta sala já está com 8 participantes.');
      if (isHost) {
        clearTimeout(room.hostTimer);
        const old = room.members.get(room.hostId);
        if (old) { room.members.delete(room.hostId); old.ws.room = null; send(old.ws, { type: 'removed', message: 'A sessão do host foi aberta em outra aba.' }); old.ws.close(1000, 'Sessão substituída'); }
        if (room.screenOwner === room.hostId) room.screenOwner = null;
        room.hostId = ws.id;
      }
    }
    room.members.set(ws.id, { id: ws.id, ws, name, mic: false, camera: false }); ws.room = room; clearTimeout(ws.joinTimer);
    send(ws, { type: 'welcome', selfId: ws.id, ...snapshot(room) }); publish(room);
  });
}
async function handle(ws, m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  if (m.type === 'inspect') { if (!rate('inspect:' + ws.ip, 80, 60000)) return error(ws, 'RATE_LIMIT', 'Muitas consultas. Aguarde.'); const room = rooms.get(String(m.code || '')); send(ws, { type: 'info', exists: !!room, private: !!room?.passwordHash, locked: !!room?.locked }); return; }
  if (m.type === 'join') return join(ws, m);
  const room = ws.room, member = room?.members.get(ws.id);
  if (!room || !member || rooms.get(room.code) !== room) return ack(ws, m, false, 'Entre em uma sala para continuar.');
  if (['lock', 'password', 'kick', 'mute', 'end'].includes(m.type) && ws.id !== room.hostId) return ack(ws, m, false, 'Somente o host pode fazer isso.', 'FORBIDDEN');
  switch (m.type) {
    case 'signal': {
      const other = room.members.get(m.to);
      if (other && m.to !== ws.id && m.data && typeof m.data === 'object') send(other.ws, { type: 'signal', from: ws.id, data: m.data });
      return;
    }
    case 'chat': {
      const text = typeof m.text === 'string' ? m.text.trim() : '';
      if (!text || text.length > 1000) return ack(ws, m, false, 'Envie de 1 a 1000 caracteres.');
      if (!rate('chat:' + ws.id, 12, 10000)) return ack(ws, m, false, 'Você está enviando mensagens muito rápido.');
      broadcast(room, { type: 'chat', id: randomUUID(), sender: ws.id, name: member.name, text, timestamp: Date.now() }); break;
    }
    case 'media': member.mic = !!m.mic; member.camera = !!m.camera; publish(room); break;
    case 'share-start': if (room.screenOwner && room.screenOwner !== ws.id) return ack(ws, m, false, 'Alguém já está compartilhando. Aguarde a transmissão terminar.'); room.screenOwner = ws.id; publish(room); break;
    case 'share-stop': if (room.screenOwner === ws.id) { room.screenOwner = null; publish(room); } break;
    case 'lock': room.locked = !!m.locked; publish(room); break;
    case 'password': {
      const password = typeof m.password === 'string' ? m.password : '';
      if (password && (password.length < 4 || password.length > 64)) return ack(ws, m, false, 'Use de 4 a 64 caracteres.');
      await serialRoom(room.code, async () => { const protection = await passwordData(password); Object.assign(room, protection); publish(room); }); break;
    }
    case 'kick': {
      const other = room.members.get(m.target); if (!other || m.target === room.hostId) return ack(ws, m, false, 'Participante inválido.');
      room.members.delete(m.target); if (room.screenOwner === m.target) room.screenOwner = null; other.ws.room = null;
      send(other.ws, { type: 'removed', message: 'O host removeu você da sala.' }); other.ws.close(1000, 'Removido pelo host'); publish(room); break;
    }
    case 'mute': { const other = room.members.get(m.target); if (!other || m.target === room.hostId) return ack(ws, m, false, 'Participante inválido.'); other.mic = false; send(other.ws, { type: 'mute', message: 'Seu microfone foi silenciado pelo host.' }); publish(room); break; }
    case 'end': ack(ws, m); finishRoom(room); return;
    default: return ack(ws, m, false, 'Ação desconhecida.');
  }
  ack(ws, m);
}
wss.on('connection', (ws) => {
  ws.id = randomUUID(); ws.alive = true; ipConnections.set(ws.ip, (ipConnections.get(ws.ip) || 0) + 1);
  ws.joinTimer = setTimeout(() => ws.close(1008, 'Tempo de entrada expirou'), 15000);
  ws.on('pong', () => { ws.alive = true; });
  let queue = Promise.resolve();
  ws.on('message', (bytes, isBinary) => {
    if (isBinary || !rate('messages:' + ws.id, 240, 10000)) { ws.close(1008, 'Limite de mensagens'); return; }
    let message; try { message = JSON.parse(bytes.toString()); } catch { ws.close(1003, 'JSON inválido'); return; }
    queue = queue.then(() => handle(ws, message)).catch((err) => { console.error('ANDRADE:', err.message); error(ws, 'INTERNAL', 'Não foi possível processar esta ação.'); });
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    clearTimeout(ws.joinTimer); ipConnections.set(ws.ip, Math.max(0, (ipConnections.get(ws.ip) || 1) - 1));
    const room = ws.room; if (!room) return;
    room.members.delete(ws.id); if (room.screenOwner === ws.id) room.screenOwner = null;
    if (rooms.get(room.code) !== room) return;
    if (room.hostId === ws.id) { clearTimeout(room.hostTimer); room.hostTimer = setTimeout(() => finishRoom(room, 'O host desconectou. A sala foi encerrada.'), ROOM_GRACE); broadcast(room, { type: 'host-offline', message: 'O host desconectou e tem 60 segundos para voltar.' }); }
    publish(room);
  });
});
const housekeeping = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  const now = Date.now(); for (const [key, entry] of limits) if (now > entry.until) limits.delete(key);
  for (const [ip, count] of ipConnections) if (!count) ipConnections.delete(ip);
  for (const room of rooms.values()) if (now - room.createdAt > ROOM_TTL) finishRoom(room, 'A sala atingiu o limite de 6 horas. Crie uma nova para continuar.');
}, 15000);
server.listen(port, host, () => console.log('ANDRADE disponível em http://' + host + ':' + port));
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { clearInterval(housekeeping); for (const room of rooms.values()) finishRoom(room, 'O servidor está sendo reiniciado.'); wss.close(); server.close(() => process.exit(0)); });
