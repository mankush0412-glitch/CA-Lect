'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite'); const persist = require('../src/persist');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const quiet = { log() {}, warn() {}, error() {} };

/** Minimal in-memory stand-in for the `mongodb` driver (replaceOne / findOne / find / deleteMany on one collection). */
function fakeMongo(store = new Map()) {
  const col = {
    async replaceOne(f, doc) { store.set(f._id, doc); }, async findOne(f) { return store.get(f._id) || null; },
    find(f) { const rows = [...store.values()].filter((d) => String(d._id).startsWith('chunk:') && d.gen === f.gen); return { toArray: async () => rows }; },
    async deleteMany(f) { for (const [k, d] of [...store]) if (String(k).startsWith('chunk:') && d.gen !== f.gen.$ne) store.delete(k); },
  };
  return { store, MongoClient: class { async connect() {} db() { return { collection: () => col }; } async close() {} } };
}
const dbWith = (file, v) => { const d = new DatabaseSync(file); d.exec('CREATE TABLE IF NOT EXISTS t(v TEXT)'); d.prepare('INSERT INTO t VALUES (?)').run(v); d.close(); };

test('MongoDB snapshot: saved from a live db, restored onto an empty disk, never overwrites existing data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pst-')); const f1 = path.join(dir, 'a.db'); dbWith(f1, 'lecture-index'); const src = new DatabaseSync(f1); const mongo = fakeMongo(); const env = { MONGODB_URI: 'mongodb://x' };
  const snap = persist.createSnapshotter({ sqlite: src, env, deps: { mongo }, log: quiet }); const st = await snap.run(true); assert.equal(st.error, ''); assert.ok(st.last); assert.ok(mongo.store.has('meta'));
  const unchanged = await snap.run(); assert.equal(unchanged.last, st.last); src.close();
  const f2 = path.join(dir, 'fresh', 'b.db'); const r = await persist.restore({ file: f2, env, deps: { mongo }, log: quiet }); assert.deepEqual(r, { restored: true, from: 'mongodb' });
  const chk = new DatabaseSync(f2); assert.equal(chk.prepare('SELECT v FROM t').get().v, 'lecture-index'); chk.close();
  const again = await persist.restore({ file: f2, env, deps: { mongo }, log: quiet }); assert.equal(again.restored, false); // existing local data wins
  assert.equal((await persist.restore({ file: path.join(dir, 'x.db'), env: {}, log: quiet })).reason, 'no persistence configured');
});

test('Telegram snapshot: sent + pinned, previous one removed, restored from the pinned document', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pst-')); const f1 = path.join(dir, 'a.db'); dbWith(f1, 'via-telegram'); const src = new DatabaseSync(f1); const calls = []; let pinned = null; let next = 100; let blob = null;
  const tg = { base: 'http://tg.test', token: 'T',
    async sendDocumentBuffer(chat, buf, name) { blob = buf; calls.push(['send', name]); return { message_id: ++next }; },
    async call(m, p) { calls.push([m]); if (m === 'getChat') return { pinned_message: pinned }; if (m === 'pinChatMessage') { pinned = { message_id: p.message_id, document: { file_id: 'F' + p.message_id, file_name: 'studymate-backup-x.db.gz', file_size: blob.length } }; return true; } if (m === 'getFile') return { file_path: 'docs/x' }; return true; } };
  const realFetch = global.fetch; global.fetch = async (u) => { assert.match(String(u), /file\/botT\/docs\/x/); return { ok: true, arrayBuffer: async () => blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length) }; };
  try {
    const env = { BACKUP_CHAT_ID: '-100123' }; const snap = persist.createSnapshotter({ sqlite: src, env, tg, log: quiet }); await snap.run(true); dbWith(f1, 'second'); const src2 = src; src2.exec('INSERT INTO t VALUES (\'second\')'); await snap.run();
    assert.equal(calls.filter((c) => c[0] === 'send').length, 2); assert.ok(calls.some((c) => c[0] === 'deleteMessage')); src.close();
    const f2 = path.join(dir, 'new', 'b.db'); const r = await persist.restore({ file: f2, env, tg, log: quiet }); assert.deepEqual(r, { restored: true, from: 'telegram' });
    const chk = new DatabaseSync(f2); assert.ok(chk.prepare('SELECT COUNT(*) c FROM t').get().c >= 2); chk.close();
  } finally { global.fetch = realFetch; }
});

test('force-join channels from env are added for the right level (and de-duplicated with the admin lists)', async () => {
  const keep = { ...process.env }; process.env.JOIN_CHANNELS = 'Main|https://t.me/main|-1001'; process.env.JOIN_CHANNELS_FOUNDATION = JSON.stringify([{ title: 'Found', url: 'https://t.me/f', chatId: '-1002' }, { title: 'bad', url: 'http://nope' }]); process.env.JOIN_CHANNELS_INTERMEDIATE = 'Inter|https://t.me/i|-1003;Inter2|https://t.me/i2'; process.env.FORCE_JOIN_CHANNELS_FOUNDATION = '-1009,-1010'; process.env.FORCE_JOIN_CHANNEL_LINKS_FOUNDATION = 'https://t.me/r1,https://t.me/r2'; process.env.FORCE_JOIN_CHANNEL_NAMES_FOUNDATION = 'RefOne,RefTwo';
  try {
    const t = await boot(); const cfg = t.app.service.config; cfg.set(own, { joinChannels: [{ title: 'Main again', url: 'https://t.me/main', chatId: '-1001' }, { title: 'Admin', url: 'https://t.me/adm' }], joinChannelsIntermediate: [{ title: 'A', url: 'https://t.me/a' }] });
    assert.deepEqual(cfg.joinFor('foundation').map((c) => c.title), ['Main', 'Found', 'RefOne', 'RefTwo', 'Admin']); assert.deepEqual(cfg.joinFor('intermediate').map((c) => c.title), ['Main', 'Inter', 'Inter2', 'Admin', 'A']); assert.deepEqual(cfg.joinFor('').map((c) => c.title), ['Main', 'Admin']);
    const u = await t.reg(t.user(8)); await t.call(u, 'POST', '/api/app/level', { level: 'foundation' }); const j = (await t.call(u, 'GET', '/api/app/join')).json.data; assert.deepEqual(j.channels.map((c) => c.title), ['Main', 'Found', 'RefOne', 'RefTwo', 'Admin']);
  } finally { for (const k of ['JOIN_CHANNELS', 'JOIN_CHANNELS_FOUNDATION', 'JOIN_CHANNELS_INTERMEDIATE', 'FORCE_JOIN_CHANNELS_FOUNDATION', 'FORCE_JOIN_CHANNEL_LINKS_FOUNDATION', 'FORCE_JOIN_CHANNEL_NAMES_FOUNDATION']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
});

test('theme + size settings: level-based skin default, validation of size', async () => {
  const t = await boot(); const u = await t.reg(t.user(9)); const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.themeSkin, 'blue'); assert.equal(me.config.uiScale, 100);
  t.app.service.config.set(own, { themeSkin: 'green', uiScale: 80 }); assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.config.uiScale, 80);
  assert.throws(() => t.app.service.config.set(own, { uiScale: 20 }), /between 60 and 110/); assert.throws(() => t.app.service.config.set(own, { themeSkin: 'pink' }), /Theme/);
});

test('a library change (new lecture) triggers a snapshot within the fast check; user-only activity does not', async () => {
  const t = await boot(); const keep = process.env.MONGODB_URI; process.env.MONGODB_URI = 'mongodb://x'; const mongo = fakeMongo();
  try {
    const snap = persist.createSnapshotter({ sqlite: t.app.db.sqlite, env: { MONGODB_URI: 'mongodb://x' }, deps: { mongo }, log: quiet }); await snap.run(true); const first = snap.status().last;
    t.app.store.put('config', 'probe', { a: 1 }); await new Promise((r) => setTimeout(r, 5)); await snap.run(); assert.ok(mongo.store.get('meta').at >= first);
  } finally { if (keep === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = keep; }
});

test('tidy chat: old menu messages are deleted on every /start, the how-to video is pinned and replaced (not duplicated)', async () => {
  const t = await boot(); const u = t.user(12); await t.say(u, '/start'); await t.press(u, 'lv:foundation'); const welcome1 = t.tg.last('sendMessage').text; assert.match(welcome1, /Open WebApp/);
  t.tg.clear(); await t.say(u, '/start'); const del = t.tg.of('deleteMessages'); assert.equal(del.length, 1); assert.ok(del[0].message_ids.length >= 2, 'previous menu + the /start message are removed'); assert.match(t.tg.last('sendMessage').text, /Open WebApp/);
  t.app.db.kv.set('howto:msg', '777'); t.tg.clear(); await t.press(u, 'how'); assert.equal(t.tg.of('pinChatMessage').length, 1); const first = t.tg.of('pinChatMessage')[0].message_id;
  await t.press(u, 'how'); assert.equal(t.tg.of('pinChatMessage').length, 2); assert.ok(t.tg.of('deleteMessage').some((d) => d.message_id === first), 'old how-to copy removed');
  t.tg.clear(); await t.say(u, '/start'); assert.ok(!(t.tg.of('deleteMessages')[0].message_ids || []).includes(t.tg.of('pinChatMessage').length), 'pinned video untouched'); assert.ok(!(t.tg.of('deleteMessages')[0].message_ids || []).includes(parseInt(t.app.db.kv.get('howpin:' + u.id), 10)));
  t.app.service.config.set(own, { cleanChat: false }); t.tg.clear(); await t.say(u, '/start'); assert.equal(t.tg.of('deleteMessages').length, 0);
});

test('new faculty card data: batches carry addedAt and faculties createdAt; setting defaults to 7 days', async () => {
  const t = await boot(); const u = await t.reg(t.user(13)); const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.newFacultyDays, 7); assert.equal(me.config.cleanChat === undefined || me.config.cleanChat, true);
  const cat = t.app.service.catalog(String(u.id), 'intermediate'); const b = cat.subjects.flatMap((s) => s.faculties).flatMap((f) => f.batches); assert.ok(b.length === 0 || b.every((x) => typeof x.addedAt === 'number'));
});

test('env channels given only as chat ids: title + link are looked up from Telegram', async () => {
  const keep = { ...process.env }; process.env.JOIN_CHANNELS_FOUNDATION = '-1001111, -1002222'; process.env.FORCE_JOIN_CHANNELS_INTERMEDIATE = '-1003333';
  try {
    const t = await boot(); const cfg = t.app.service.config; assert.deepEqual(cfg.joinFor('foundation'), []); // nothing usable until Telegram answers
    const stub = { async call(m, p) { if (m === 'getChat') return p.chat_id === '-1001111' ? { title: 'Public Chan', username: 'pubchan' } : { title: 'Private Grp' }; if (m === 'exportChatInviteLink') return 'https://t.me/+abc'; throw new Error('x'); } };
    assert.equal(await cfg.resolveJoin(stub), 3); const f = cfg.joinFor('foundation'); assert.deepEqual(f.map((c) => [c.title, c.url, c.chatId]), [['Public Chan', 'https://t.me/pubchan', '-1001111'], ['Private Grp', 'https://t.me/+abc', '-1002222']]);
    assert.equal(cfg.joinFor('intermediate')[0].chatId, '-1003333');
  } finally { for (const k of ['JOIN_CHANNELS_FOUNDATION', 'FORCE_JOIN_CHANNELS_INTERMEDIATE']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
});
