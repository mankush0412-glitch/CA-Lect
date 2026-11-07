'use strict';
const http = require('http'); const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { EntityStore } = require('../core/entity-store');
const { createService } = require('../core/service');
const { createStudy } = require('../core/study');
const { createStudyHandler } = require('../core/study-router');
const { createAdminHandler, createCatalogHandler } = require('../core/router');
const TOKEN = '123456:TEST_TOKEN', OWNER = 1000;

function signInit(user, { age = 0 } = {}) {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'q' });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex')); return p.toString();
}
function fakeDbs() {
  const batches = new Map(), users = new Map(), bans = new Map(), access = new Map(), ann = [];
  return {
    batchDb: { getAll: () => [...batches.values()].map(x => JSON.parse(JSON.stringify(x))), getOne: id => batches.has(id) ? JSON.parse(JSON.stringify(batches.get(id))) : null, upsert: b => batches.set(String(b._id), JSON.parse(JSON.stringify(b))), delete: id => batches.delete(id) },
    userDb: { findOne: id => users.get(String(id)) || null, listAll: () => [...users.values()], count: () => users.size, upsert: u => users.set(String(u.userId), u) },
    banDb: { isBanned: id => bans.has(String(id)), ban: ({ userId, reason, bannedBy }) => bans.set(String(userId), { userId, reason, bannedBy }), unban: id => bans.delete(String(id)), findOne: id => bans.get(String(id)), listAll: () => [...bans.values()] },
    accessDb: { findOne: id => access.get(String(id)) || null, upsert: a => access.set(String(a.userId), a) },
    announcementDb: { insert: a => ann.push(a), delete: id => { const i = ann.findIndex(x => x.id === id); if (i >= 0) ann.splice(i, 1); }, all: ann },
  };
}
async function boot(extra = {}) {
  const sqlite = new DatabaseSync(':memory:'); const store = new EntityStore(sqlite, extra.hooks);
  const dbs = fakeDbs(); const sent = [];
  const clock = { t: extra.start || Date.now() }; const now = extra.start ? () => clock.t : () => Date.now(); const mirrored = [], unmirrored = [];
  const study = createStudy({ sqlite, store, userDb: dbs.userDb, banDb: dbs.banDb, now, subjectCatalog: (lv) => store.list('subject').filter((x) => x.level === lv).map((x) => x.name), mirror: (k, i, d) => mirrored.push([k, i, d]), mirrorDel: (k, i) => unmirrored.push([k, i]) });
  const service = createService({ store, now: extra.start ? now : undefined, ...dbs, ownerId: OWNER, sendMessage: async (u, t) => sent.push([u, t]), sendDelayMs: 0, awaitSend: true, ...extra.deps });
  const admin = createAdminHandler({ service, study, store, botToken: TOKEN, ownerId: OWNER });
  const cat = createCatalogHandler({ service, botToken: TOKEN });
  const stu = createStudyHandler({ study, botToken: TOKEN, banDb: dbs.banDb, sendMessage: async (u, t) => sent.push([u, t]) });
  const fs = require('fs'), pathm = require('path');
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p.startsWith('/api/catalog')) return cat(req, res);
    if (p.startsWith('/api/admin')) return admin(req, res);
    if (p.startsWith('/api/study')) return stu(req, res);
    const f = pathm.join(__dirname, '..', 'public', p === '/' ? 'index.html' : p);
    if (f.startsWith(pathm.join(__dirname, '..', 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream'); return res.end(fs.readFileSync(f)); }
    res.statusCode = 404; res.end('nf');
  });
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  async function call(user, method, path, body, headers = {}) {
    const h = { 'content-type': 'application/json', ...headers }; if (user) h['x-tg-init-data'] = typeof user === 'string' ? user : signInit(user);
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  }
  return { store, service, study, sqlite, clock, mirrored, unmirrored, dbs, sent, call, close: () => { server.closeAllConnections(); server.close(); }, port };
}
module.exports = { boot, signInit, TOKEN, OWNER };
