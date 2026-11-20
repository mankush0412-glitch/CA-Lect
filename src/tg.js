'use strict';
const http = require('node:http'); const https = require('node:https');
/* Node's built-in fetch drops idle connections after ~4 s, so almost every button press paid a fresh TCP + TLS handshake to Telegram (hundreds of ms). Our own keep-alive agents keep the connection warm. */
const AGENTS = { 'https:': new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 64, maxFreeSockets: 16 }), 'http:': new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 64 }) };
/* a half emoji (cut by .slice) is an invalid UTF-8 string for Telegram — “text must be encoded in UTF-8” — so broken surrogate halves are dropped from every request */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function post(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === 'http:' ? http : https; const body = Buffer.from(JSON.stringify(payload, (k, v) => (typeof v === 'string' ? v.replace(LONE, '') : v)));
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'POST', agent: AGENTS[u.protocol], headers: { 'content-type': 'application/json', 'content-length': body.length } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json: j }); }); res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Telegram request timed out'))); req.on('error', reject); req.end(body);
  });
}
/** Minimal Telegram Bot API client. */
class Tg {
  constructor(token, base = 'https://api.telegram.org') { this.token = token; this.base = base.replace(/\/$/, ''); this.me = null; }
  async call(method, payload = {}, { timeoutMs = 35000 } = {}) {
    const r = await post(`${this.base}/bot${this.token}/${method}`, payload, timeoutMs); const j = r.json || {};
    if (!j.ok) { const e = new Error(j.description || `Telegram ${method} failed (${r.status})`); e.code = j.error_code || r.status; e.retryAfter = j.parameters && j.parameters.retry_after; throw e; }
    return j.result;
  }
  /** Keeps one connection to Telegram open (a tiny call every 20 s) so the next tap never waits for a new handshake. */
  keepWarm() { const t = setInterval(() => { this.call('getMe', {}, { timeoutMs: 8000 }).catch(() => {}); }, 20000); if (t.unref) t.unref(); return t; }
  async getMe() { return (this.me = await this.call('getMe')); }
  sendMessage(chat_id, text, extra = {}) { return this.call('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  editMessageText(chat_id, message_id, text, extra = {}) { return this.call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  answerCallbackQuery(id, text, show_alert = false) { return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert }); }
  copyMessage(chat_id, from_chat_id, message_id, extra = {}) { return this.call('copyMessage', { chat_id, from_chat_id, message_id, parse_mode: 'HTML', ...extra }); }
  getChatMember(chat_id, user_id) { return this.call('getChatMember', { chat_id, user_id }); }
  setWebhook(url, secret) { return this.call('setWebhook', { url, secret_token: secret || undefined, allowed_updates: ['message', 'callback_query', 'chat_member'], max_connections: 100, drop_pending_updates: false }); }
  deleteWebhook() { return this.call('deleteWebhook', { drop_pending_updates: false }); }
  getUpdates(offset, timeout = 25) { return this.call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query', 'chat_member'] }, { timeoutMs: (timeout + 10) * 1000 }); }
  setChatMenuButton(url, text) { return this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } }); }
  setMyCommands(commands, scope) { return this.call('setMyCommands', { commands, scope }); }
  async sendPhotoBuffer(chat_id, buf, caption, filename = 'recap.png') {
    const fd = new FormData(); fd.append('chat_id', String(chat_id)); if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); } fd.append('photo', new Blob([buf], { type: 'image/png' }), filename);
    const r = await fetch(`${this.base}/bot${this.token}/sendPhoto`, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); if (!j.ok) throw new Error(j.description || 'sendPhoto failed'); return j.result;
  }
  async sendDocumentBuffer(chat_id, buf, filename, caption, mime = 'application/pdf', markup) {
    const fd = new FormData(); fd.append('chat_id', String(chat_id)); if (markup) fd.append('reply_markup', JSON.stringify(markup)); if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); } fd.append('document', new Blob([buf], { type: mime }), filename);
    const r = await fetch(`${this.base}/bot${this.token}/sendDocument`, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); if (!j.ok) throw new Error(j.description || 'sendDocument failed'); return j.result;
  }
}
module.exports = { Tg };
