'use strict';
/** Minimal Telegram Bot API client (fetch only). */
class Tg {
  constructor(token, base = 'https://api.telegram.org') { this.token = token; this.base = base.replace(/\/$/, ''); this.me = null; }
  async call(method, payload = {}, { timeoutMs = 35000 } = {}) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.base}/bot${this.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) { const e = new Error(j.description || `Telegram ${method} failed (${r.status})`); e.code = j.error_code || r.status; e.retryAfter = j.parameters && j.parameters.retry_after; throw e; }
      return j.result;
    } finally { clearTimeout(t); }
  }
  async getMe() { return (this.me = await this.call('getMe')); }
  sendMessage(chat_id, text, extra = {}) { return this.call('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  editMessageText(chat_id, message_id, text, extra = {}) { return this.call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  answerCallbackQuery(id, text, show_alert = false) { return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert }); }
  copyMessage(chat_id, from_chat_id, message_id, extra = {}) { return this.call('copyMessage', { chat_id, from_chat_id, message_id, parse_mode: 'HTML', ...extra }); }
  getChatMember(chat_id, user_id) { return this.call('getChatMember', { chat_id, user_id }); }
  setWebhook(url, secret) { return this.call('setWebhook', { url, secret_token: secret || undefined, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }); }
  deleteWebhook() { return this.call('deleteWebhook', { drop_pending_updates: false }); }
  getUpdates(offset, timeout = 25) { return this.call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: (timeout + 10) * 1000 }); }
  setChatMenuButton(url, text) { return this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } }); }
  setMyCommands(commands, scope) { return this.call('setMyCommands', { commands, scope }); }
  async sendDocumentBuffer(chat_id, buf, filename, caption, mime = 'application/pdf') {
    const fd = new FormData(); fd.append('chat_id', String(chat_id)); if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); } fd.append('document', new Blob([buf], { type: mime }), filename);
    const r = await fetch(`${this.base}/bot${this.token}/sendDocument`, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({})); if (!j.ok) throw new Error(j.description || 'sendDocument failed'); return j.result;
  }
}
module.exports = { Tg };
