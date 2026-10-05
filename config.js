/* ANDRADE — deixe vazio para testar localmente, sem servidor.
 * O servidor incluído fornece /andrade-config.js com a URL correta.
 * Em outra hospedagem, use wss://seu-dominio/ws e configure TURN no servidor.
 */
window.ANDRADE_CONFIG = Object.assign({
  websocketUrl: '',
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  maxParticipants: 8
}, window.ANDRADE_CONFIG || {});
