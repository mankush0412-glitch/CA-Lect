'use strict';
const http = require('http'); const crypto = require('crypto'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { createApp } = require('../server');
const TOKEN = '123456:TEST_TOKEN', OWNER = 1000;

/** In-process fake of the Telegram Bot API: records every call so tests can assert on what the bot did. */
async function fakeTelegram() {
  const calls = []; let mid = 5000; const members = {}; const failFor = new Set(); const state = { updates: [] };
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
      const m = /\/bot[^/]+\/(\w+)/.exec(req.url); const method = m && m[1]; const raw = Buffer.concat(chunks); let body = {}; const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) { try { body = JSON.parse(raw.toString() || '{}'); } catch (e) {} } else if (ct.includes('multipart')) body = { _multipart: true, size: raw.length, filename: (/filename="([^"]+)"/.exec(raw.toString('latin1')) || [])[1], head: raw.toString('latin1').slice(0, 2000), raw };
      calls.push({ method, body }); const ok = (r) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: r })); }; const err = (code, d, extra) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: code, description: d, parameters: extra })); };
      if (method === 'getMe') return ok({ id: 1, is_bot: true, username: 'testbot' });
      if (method === 'getChatMember') return ok({ status: (members[body.chat_id + ':' + body.user_id] || 'left') });
      if (method === 'copyMessage') { if (failFor.has(String(body.chat_id))) return err(403, 'Forbidden: bot was blocked by the user'); return ok({ message_id: ++mid }); }
      if (method === 'sendMessage' || method === 'sendDocument') { if (failFor.has(String(body.chat_id)) ) return err(403, 'Forbidden'); return ok({ message_id: ++mid, chat: { id: body.chat_id } }); }
      if (method === 'getUpdates') return ok(state.updates.splice(0));
      return ok(true);
    });
  });
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
  return { calls, base, members, failFor, state, of: (m) => calls.filter((c) => c.method === m).map((c) => c.body), last: (m) => { const l = calls.filter((c) => c.method === m); return l.length ? l[l.length - 1].body : null; }, clear: () => { calls.length = 0; }, close: () => { srv.closeAllConnections(); srv.close(); } };
}
function signInit(user, { age = 0 } = {}) {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'q' });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex')); return p.toString();
}
const owner = { id: OWNER, first_name: 'Owner' };
const OPEN = [];
async function closeAll() { while (OPEN.length) { const c = OPEN.pop(); try { await c(); } catch (e) {} } }
async function boot(extra = {}) {
  const tgf = await fakeTelegram(); const clock = { t: extra.start || Date.now() };
  const app = createApp({ dbFile: ':memory:', now: extra.realtime ? () => Date.now() : () => clock.t, sleep: async () => {}, config: { botToken: TOKEN, ownerId: String(OWNER), mode: 'off', port: 0, publicUrl: 'https://app.example.com', storageChannelId: '-100999', tgApi: tgf.base, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sm-')), ...(extra.config || {}) } });
  app.setUsername('testbot'); const port = await app.start();
  const call = async (user, method, p, body, headers = {}) => { const h = { 'content-type': 'application/json', ...headers }; if (user) h['x-tg-init-data'] = typeof user === 'string' ? user : signInit(user); const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, text: ct.includes('json') ? null : await r.text() }; };
  const upd = (() => { let id = 1; return () => id++; })();
  const mk = (u, extra2) => ({ message_id: Math.floor(Math.random() * 1e6), from: { id: u.id, first_name: u.first_name || 'U', last_name: u.last_name }, chat: { id: u.id, type: 'private' }, date: Math.floor(clock.t / 1000), ...extra2 });
  const say = async (u, text) => { await app.bot.handleUpdate({ update_id: upd(), message: mk(u, { text }) }); };
  const send = async (u, extra2) => { await app.bot.handleUpdate({ update_id: upd(), message: mk(u, extra2) }); };
  const press = async (u, data, messageId = 777) => { await app.bot.handleUpdate({ update_id: upd(), callback_query: { id: 'cb' + upd(), from: { id: u.id, first_name: u.first_name || 'U' }, data, message: { message_id: messageId, chat: { id: u.id } } } }); };
  const user = (n, name = 'Stu' + n) => ({ id: 700000 + n, first_name: name });
  const reg = async (u) => { await say(u, '/start'); return u; };
  const add = (name, level = 'foundation', subjects = ['Accounts']) => { const r = app.service.batch.create({ id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) }, { name, level, isPublic: true, status: 'active' }); subjects.forEach((s) => app.content.addSubject(r.id, { name: s })); return r.id; };
  let closed = false; const close = async () => { if (closed) return; closed = true; await app.stop(); tgf.close(); }; OPEN.push(close);
  return { app, tg: tgf, clock, call, say, send, press, user, reg, add, port, close };
}
module.exports = { closeAll, boot, signInit, owner, OWNER, TOKEN };
