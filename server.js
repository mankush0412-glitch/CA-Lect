'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const persistLib = require('./src/persist'); const loadConfig = require('./src/config'); const { openDb } = require('./src/db'); const { Tg } = require('./src/tg');
const { EntityStore } = require('./src/entity-store'); const { createService } = require('./src/service'); const { createStudy } = require('./src/study');
const { createStudyHandler } = require('./src/study-router'); const { createAdminHandler, createCatalogHandler } = require('./src/router');
const { createPayments } = require('./src/payments'); const { createContent } = require('./src/content'); const { createAccess } = require('./src/access'); const { createPlanner } = require('./src/planner');
const { createBot } = require('./src/bot'); const { createApi } = require('./src/api'); const adminExt = require('./src/admin-ext');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
// The student app loads ad SDKs (Monetag / Adsgram) that pull scripts, frames and images from many ad domains, so it gets a wider policy; the admin panel keeps the strict one.
const APP_CSP = "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; frame-src https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors https://web.telegram.org https://*.telegram.org https://telegram.org; base-uri 'none'";
const CSP = "default-src 'self'; script-src 'self' https://telegram.org https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; frame-ancestors https://web.telegram.org https://*.telegram.org https://telegram.org; base-uri 'none'; form-action 'self'";

function createApp(over = {}) {
  const config = loadConfig(over.config); const now = over.now || (() => Date.now());
  const db = openDb(over.dbFile || path.join(config.dataDir, 'studymate.db'));
  const tg = over.tg || new Tg(config.botToken || 'x', config.tgApi); let username = over.botUsername || '';
  const store = new EntityStore(db.sqlite, {}); // single-node SQLite: durability comes from the DB file + nightly backups
  const ownerId = String(config.ownerId || '0');
  let bot = null; const sendHtml = (id, html, extra) => tg.sendMessage(parseInt(id, 10), html, extra || {});
  let payList = async () => [];
  const service = createService({ store, batchDb: db.batch, userDb: db.user, banDb: db.ban, accessDb: db.access, announcementDb: db.announcement, ownerId, now, sendMessage: sendHtml, mirrorBatch: null, getPayments: () => payList(), listAdsFree: () => [] });
  const content = createContent({ db });
  const dtg = over.dtg || (config.deliveryBotToken ? new Tg(config.deliveryBotToken, config.tgApi) : tg); let dUsername = over.deliveryUsername || '';
  const pay = createPayments({ store, service, db, keyId: config.razorpayKeyId, keySecret: config.razorpayKeySecret, now, fetchImpl: over.fetchImpl });
  payList = () => pay.list();
  const access = createAccess({ db, store, service, content, tg, dtg, pay, appUrl: config.publicUrl ? config.publicUrl + '/app/' : '', deliveryInfo: () => ({ username: dUsername }), ownerId, now, botUsername: () => username, storageChannelId: config.storageChannelId, sleep: over.sleep });
  const planner = createPlanner({ db, content, now });
  const study = createStudy({ sqlite: db.sqlite, store, userDb: db.user, banDb: db.ban, isStaff: (id) => access.isStaff(id), now, subjectCatalog: (lv) => store.list('subject').filter((x) => x.level === lv && x.status !== 'archived').sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => x.name) });
  bot = createBot({ tg, db, store, service, content, access, planner, config, now, botUsername: () => username });
  const admin = createAdminHandler({ service, study, store, botToken: config.botToken, ownerId, ext: adminExt({ content, access, db, botUsername: () => username }) });
  const studyApi = createStudyHandler({ study, botToken: config.botToken, banDb: db.ban, sendMessage: sendHtml, sendPhoto: (id, buf, caption) => tg.sendPhotoBuffer(parseInt(id, 10), buf, caption), brand: config.brand });
  const appApi = createApi({ botToken: config.botToken, db, store, service, content, access, planner, tg, pay, onPlan: (uid) => bot.sendPlanSummary(uid).catch(() => {}), brand: config.brand, botUsername: () => username });
  const catalog = createCatalogHandler({ service, botToken: config.botToken });

  const pub = path.join(__dirname, 'public');
  function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath); if (rel.endsWith('/')) rel += 'index.html'; const f = path.normalize(path.join(pub, rel)); if (!f.startsWith(pub + path.sep)) { res.statusCode = 403; return res.end('Forbidden'); }
    fs.stat(f, (err, st) => { if (err || !st.isFile()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
      const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`; if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
      res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); res.setHeader('ETag', etag); res.setHeader('Cache-Control', /\/shared\//.test(f) ? 'public, max-age=3600, must-revalidate' : 'no-cache'); fs.createReadStream(f).pipe(res); });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', /^\/app(\/|$)/.test(req.url || '') ? APP_CSP : CSP); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const p = req.url.split('?')[0];
    const rh = req.headers['x-forwarded-host'] || req.headers.host; if (!config.publicUrl && rh && !/^(localhost|127\.|\[::1\])/.test(rh)) { config.publicUrl = `${/^https?$/.test(String(req.headers['x-forwarded-proto'] || '')) ? req.headers['x-forwarded-proto'] : 'https'}://${rh}`; console.warn('[config] PUBLIC_URL was not set - using ' + config.publicUrl + ' (set PUBLIC_URL in your env to make this permanent)'); }
    try {
      if (p === '/healthz') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, users: db.user.count(), time: new Date(now()).toISOString() })); }
      if (p === '/tg/webhook' && req.method === 'POST') {
        if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) { res.statusCode = 401; return res.end(); }
        const chunks = []; let n = 0; req.on('data', (d) => { n += d.length; if (n < 1e6) chunks.push(d); }); req.on('end', () => { res.statusCode = 200; res.end('ok'); try { bot.handleUpdate(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { /* ignore malformed */ } }); return;
      }
      if (p === '/tg/delivery-webhook' && req.method === 'POST') {
        if (config.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.webhookSecret) { res.statusCode = 401; return res.end(); }
        const chunks = []; let n = 0; req.on('data', (d) => { n += d.length; if (n < 1e6) chunks.push(d); }); req.on('end', () => { res.statusCode = 200; res.end('ok'); try { deliveryUpdate(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { /* ignore */ } }); return;
      }
      if (p === '/api/adsgram/reward' && req.method === 'GET') { const u = new URL(req.url, 'http://x'); const sec = process.env.ADSGRAM_SECRET; res.setHeader('Content-Type', 'application/json'); const uid = String(u.searchParams.get('userid') || u.searchParams.get('userId') || ''); if (!sec || u.searchParams.get('secret') !== sec || !/^\d{3,15}$/.test(uid)) { res.statusCode = 401; return res.end('{"ok":false}'); } return res.end(JSON.stringify(access.adsgramReward(uid))); }
      if (p === '/api/postback' && req.method === 'GET') { const u = new URL(req.url, 'http://x'); const sec = process.env.POSTBACK_SECRET; res.setHeader('Content-Type', 'application/json'); if (!sec || u.searchParams.get('secret') !== sec) { res.statusCode = 401; return res.end('{"ok":false}'); } try { return res.end(JSON.stringify(access.postback(u.searchParams.get('token')))); } catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ ok: false, error: e.message })); } }
      if (p.startsWith('/api/admin')) return admin(req, res); if (p.startsWith('/api/study')) return studyApi(req, res); if (p.startsWith('/api/app')) return appApi(req, res); if (p.startsWith('/api/catalog')) return catalog(req, res);
      if (p === '/') { res.statusCode = 302; res.setHeader('Location', '/app/'); return res.end(); }
      if (p === '/app' || p === '/admin') { res.statusCode = 302; res.setHeader('Location', p + '/'); return res.end(); }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
      return serveStatic(req, res, p);
    } catch (e) { console.error('[server]', e); if (!res.headersSent) { res.statusCode = 500; res.end('Internal error'); } }
  });

  const timers = [];
  const persist = persistLib.createSnapshotter({ sqlite: db.sqlite, env: { ...process.env, STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID || config.storageChannelId }, tg: config.botToken && config.mode !== 'off' ? tg : null, deps: over.persistDeps || {} });
  async function backup(sendToOwner = true) {
    const dir = path.join(config.dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `studymate-${new Date(now()).toISOString().slice(0, 10)}.db`); if (fs.existsSync(f)) fs.rmSync(f);
    db.sqlite.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`); fs.readdirSync(dir).filter((x) => x.endsWith('.db')).sort().slice(0, -7).forEach((x) => fs.rmSync(path.join(dir, x)));
    if (sendToOwner && config.botToken && ownerId !== '0' && fs.statSync(f).size < 45e6) { try { await tg.sendDocumentBuffer(ownerId, fs.readFileSync(f), path.basename(f), '🗄 <b>Nightly database backup</b>', 'application/octet-stream'); } catch (e) { console.error('[backup] could not send to owner:', e.message); } }
    return f;
  }
  /** The optional delivery bot only needs /start (so Telegram lets it message the student); lectures & notes go out through it. */
  async function deliveryUpdate(u) {
    const m = u.message; if (!m || !m.from || m.chat.type !== 'private') return; const uid = String(m.from.id); db.user.touch(m.from, now());
    if (/^\/start/.test(m.text || '')) { db.kv.set('dstart:' + uid, '1'); const rows = username ? [[{ text: '🎓 Back to the main bot', url: 'https://t.me/' + username }]] : []; await dtg.sendMessage(m.chat.id, '✅ <b>Delivery bot is ready!</b>\n\nYour lectures and notes will arrive in this chat.\n\nGo back to the main bot, open the WebApp and tap a lecture to receive it here.', rows.length ? { reply_markup: { inline_keyboard: rows } } : {}).catch(() => {}); }
  }
  async function startDelivery() {
    if (dtg === tg || !config.deliveryBotToken || config.mode === 'off') return;
    try { dUsername = (await dtg.getMe()).username; } catch (e) { console.error('[delivery] getMe failed:', e.message); }
    try { await dtg.setMyCommands([{ command: 'start', description: 'Activate lecture delivery' }]); } catch (e) {}
    if (config.mode === 'webhook') { try { await dtg.setWebhook(config.publicUrl + '/tg/delivery-webhook', config.webhookSecret); } catch (e) { console.error('[delivery] setWebhook failed:', e.message); } }
    else { try { await dtg.deleteWebhook(); } catch (e) {} let offset = 0; let stop = false; timers.push({ stop: () => { stop = true; } }); (async function loop() { while (!stop) { try { const ups = await dtg.getUpdates(offset, 25); for (const u of ups) { offset = u.update_id + 1; deliveryUpdate(u); } } catch (e) { await new Promise((r) => setTimeout(r, 3000)); } } })(); }
  }
  async function start() {
    if (config.botToken && config.mode !== 'off') {
      try { const me = await tg.getMe(); username = me.username; } catch (e) { console.error('[telegram] getMe failed:', e.message); }
      const app = config.publicUrl ? config.publicUrl + '/app/' : '';
      if (app) { try { await tg.setChatMenuButton(app, '🚀 Open'); } catch (e) {} }
      try { await tg.call('setMyDescription', { description: `${config.brand}: free lectures, notes, study planner and a live study tracker for CA students.\n\nPress Start to choose your level.` }); } catch (e) {}
      try { await tg.setMyCommands([{ command: 'start', description: 'Start the bot' }, { command: 'help', description: 'How it works' }]); } catch (e) {}
      if (config.mode === 'webhook') { try { await tg.setWebhook(config.publicUrl + '/tg/webhook', config.webhookSecret); } catch (e) { console.error('[telegram] setWebhook failed:', e.message); } }
      else { try { await tg.deleteWebhook(); } catch (e) {} let offset = 0; let stop = false; timers.push({ stop: () => { stop = true; } }); (async function loop() { while (!stop) { try { const ups = await tg.getUpdates(offset, 25); for (const u of ups) { offset = u.update_id + 1; bot.handleUpdate(u); } } catch (e) { await new Promise((r) => setTimeout(r, 3000)); } } })(); }
    }
    try { access.ensureDefaults(); } catch (e) { console.error('[ads] defaults:', e.message); }
    startDelivery().catch(() => {});
    timers.push(setInterval(() => access.sweepDeletes().catch(() => {}), 60000));
    timers.push(setInterval(() => bot.tick().catch(() => {}), 30000), setInterval(() => service.notification.runScheduled().catch(() => {}), 60000));
    let lastBackupDay = ''; timers.push(setInterval(() => { const t = new Date(now() + 330 * 60000); const d = t.toISOString().slice(0, 10); if (t.getUTCHours() === 3 && lastBackupDay !== d && (process.env.NIGHTLY_BACKUP === '1' || service.config.get().nightlyBackup === true)) { lastBackupDay = d; backup().catch(() => {}); } }, 60000));
    await new Promise((r) => server.listen(config.port, r)); return server.address().port;
  }
  async function stop() { timers.forEach((t) => (t.stop ? t.stop() : clearInterval(t))); server.closeAllConnections && server.closeAllConnections(); await new Promise((r) => server.close(r)); db.close(); }
  return { config, db, store, service, content, access, planner, study, bot, tg, server, start, stop, backup, persist, setUsername: (u) => { username = u; } };
}
module.exports = { createApp };
if (require.main === module) {
  (async () => {
    const cfg = loadConfig(); // a replaced server starts with an empty disk: pull the newest snapshot (MongoDB / pinned Telegram backup) back before opening the database
    try { await persistLib.restore({ file: path.join(cfg.dataDir, 'studymate.db'), env: { ...process.env, STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID || cfg.storageChannelId }, tg: cfg.botToken && cfg.mode !== 'off' ? new Tg(cfg.botToken, cfg.tgApi) : null }); } catch (e) { console.error('[persist] restore skipped:', e.message); }
    const app = createApp(); if (!app.config.botToken) console.warn('BOT_TOKEN is not set: the web app runs, but the bot is disabled.'); if (!app.config.ownerId) console.warn('OWNER_ID is not set: nobody can open the admin panel.');
    app.start().then((port) => { console.log(`${app.config.brand} listening on :${port}`); app.persist.start(); if (app.config.botToken) { app.service.config.resolveJoin(app.tg).catch(() => {}); setInterval(() => app.service.config.resolveJoin(app.tg).catch(() => {}), 6 * 3600 * 1000).unref(); } }); const bye = () => app.persist.stop().catch(() => {}).then(() => app.stop()).then(() => process.exit(0)); process.on('SIGTERM', bye); process.on('SIGINT', bye);
  })();
}
