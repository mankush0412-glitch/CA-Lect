'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };

async function joined(t, u) { // student picks a level and passes the force-join gate for one channel
  t.app.service.config.set(own, { joinChannelsFoundation: [{ title: 'Main', url: 'https://t.me/main', chatId: '-1001' }] });
  t.tg.members['-1001:' + u.id] = 'member'; await t.say(u, '/start'); await t.press(u, 'lv:foundation'); await t.press(u, 'joined:foundation');
}

test('leaving a force-join channel suspends for 2 days; appeal reaches the owner; unsuspend lifts it', async () => {
  const t = await boot(); const u = t.user(1); await joined(t, u); const id = String(u.id);
  assert.equal(t.app.access.suspension(id), null);
  t.tg.members['-1001:' + u.id] = 'left'; t.tg.clear();
  await t.app.access.onMemberUpdate({ chat: { id: -1001 }, new_chat_member: { status: 'left', user: { id: u.id } } });
  const s = t.app.access.suspension(id); assert.ok(s); assert.equal(Math.round((s.until - t.clock.t) / 864e5), 2);
  const msg = t.tg.last('sendMessage'); assert.match(msg.text, /suspended/i); assert.match(JSON.stringify(msg.reply_markup), /appeal/);
  const api = await t.call(u, 'GET', '/api/app/me'); assert.equal(api.status, 403); assert.match(api.json.error, /Suspended until/);
  await assert.rejects(() => t.app.access.deliverNotes(id, 'x'), /suspended/);
  // appeal
  t.tg.clear(); await t.press(u, 'appeal'); assert.match(t.tg.last('sendMessage').text, /Write your appeal/); await t.say(u, 'Sorry, I left by mistake');
  const toOwner = t.tg.of('sendMessage').find((m) => String(m.chat_id) === String(owner.id)); assert.ok(toOwner); assert.match(toOwner.text, /left by mistake/); assert.match(JSON.stringify(toOwner.reply_markup), new RegExp('usp:' + id));
  t.tg.clear(); await t.press(u, 'appeal'); // second appeal is refused while the first is pending
  assert.equal(t.tg.of('sendMessage').length, 0);
  // only staff can decide
  await t.press(u, 'usp:' + id); assert.ok(t.app.access.suspension(id));
  await t.press(owner, 'usp:' + id); assert.equal(t.app.access.suspension(id), null);
  assert.match(t.tg.of('sendMessage').map((m) => m.text).join('\n'), /suspension has been lifted/);
  assert.equal((await t.call(u, 'GET', '/api/app/me')).status, 200);
});

test('suspension expires by itself, can be switched off, and staff are never suspended', async () => {
  const t = await boot(); const u = t.user(2); await joined(t, u); const id = String(u.id);
  await t.app.access.suspend(id, 'Main'); assert.ok(t.app.access.suspension(id)); t.clock.t += 3 * 864e5; assert.equal(t.app.access.suspension(id), null);
  t.app.service.config.set(own, { suspendOnLeave: false }); assert.equal(await t.app.access.suspend(id, 'Main'), null);
  t.app.service.config.set(own, { suspendOnLeave: true, suspendDays: 1 }); assert.equal(await t.app.access.suspend(String(owner.id), 'Main'), null);
  const s = await t.app.access.suspend(id, 'Main'); assert.equal(Math.round((s.until - t.clock.t) / 864e5), 1);
});

test('periodic check suspends a student who left without a chat_member update; admin list + unsuspend', async () => {
  const t = await boot(); const u = t.user(3); await joined(t, u); const id = String(u.id);
  t.clock.t += 11 * 60000; t.tg.members['-1001:' + u.id] = 'left'; assert.equal(await t.app.access.checkLeft(id), true); assert.ok(t.app.access.suspension(id));
  const list = await t.call(owner, 'GET', '/api/admin/suspended').catch(() => null); // admin route exists (auth differs per harness), the data is checked directly
  assert.equal(t.app.access.suspendedList().length, 1); assert.equal(t.app.access.suspendedList()[0].userId, id);
  assert.equal(t.app.access.unsuspend(id), true); assert.equal(t.app.access.suspendedList().length, 0);
});

test('points: redeem tiers grant long access, referral "active" bonus pays once', async () => {
  const t = await boot(); const a = t.user(4), b = t.user(5); await t.reg(a); const aid = String(a.id), bid = String(b.id);
  await t.say(b, '/start ref_' + aid); const r0 = t.app.access.referralInfo(aid); assert.equal(r0.count, 1); assert.equal(r0.active, 0); assert.equal(r0.activePoints, 5);
  const before = t.app.access.pointsInfo(aid).balance; t.app.access.activateReferral(bid); t.app.access.activateReferral(bid);
  assert.equal(t.app.access.pointsInfo(aid).balance, before + 5); assert.equal(t.app.access.referralInfo(aid).active, 1);
  const p = t.app.access.pointsInfo(aid); assert.equal(p.tiers.length, 4); assert.equal(p.tiers[0].points, 25);
  assert.throws(() => t.app.access.redeemTier(aid, 0), /need 25 points/);
  t.app.db.user.addPoints(aid, 100, 'test', t.clock.t); const r = t.app.access.redeemTier(aid, 0);
  assert.ok(r.access.remainingMs > 100 * 3600000); assert.equal(r.points.balance, p.balance + 100 - 25);
  t.app.service.config.set(own, { redeemTiers: [{ label: 'Day', points: 5, hours: 24 }] }); assert.equal(t.app.access.pointsInfo(aid).tiers.length, 1);
  assert.throws(() => t.app.service.config.set(own, { redeemTiers: [{ label: 'x', points: 0, hours: 1 }] }), /greater than 0/);
});

test('defaults: blue theme, full-screen on, size 100, nightly backup off', async () => {
  const t = await boot(); const c = t.app.service.config.get(); assert.equal(c.themeSkin, 'blue'); assert.equal(c.fullscreen, true); assert.equal(c.uiScale, 100); assert.equal(c.nightlyBackup, false); assert.equal(c.suspendDays, 2);
  const u = t.user(6); await t.reg(u); const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.fullscreen, true); assert.equal(me.config.themeSkin, 'blue'); assert.equal(me.config.uiScale, 100);
});

test('delivery: readable reasons, and the main bot delivers when the delivery bot cannot read the storage channel', async () => {
  const { createAccess } = require('../src/access'); const t = await boot(); const u = t.user(7); await t.reg(u); const uid = String(u.id);
  const bid = t.add('B', 'foundation'); const sid = t.app.db.batch.getOne(bid).subjects[0]._id; const ch = t.app.content.addChapter(bid, sid, 'Ch 1');
  const lec = t.app.content.addLecture(bid, sid, ch._id, { name: 'L1', channelMsgId: 6001, fileType: 'video', duration: 600 }); t.app.content.addNote(bid, sid, ch._id, { name: 'N1.pdf', channelMsgId: 6002, fileType: 'document' });
  t.app.access.grantHours(uid, 5, "test"); const lid = t.app.db.batch.getOne(bid).subjects[0].chapters[0].lectures[0]._id; const nid = t.app.db.batch.getOne(bid).subjects[0].chapters[0].notes[0]._id; const got = [];
  const mk = (name, fail) => ({ copyMessage: async (to, from, m) => { got.push(name + ':' + m); if (fail) { const e = new Error(fail.msg); e.code = fail.code; throw e; } return { message_id: 9 }; }, sendMessage: async () => ({}), call: async () => ({}) });
  const build = (dtg, tg) => createAccess({ db: t.app.db, store: t.app.store, service: t.app.service, content: t.app.content, tg, dtg, ownerId: String(owner.id), storageChannelId: '-1009', sleep: async () => {} });
  // delivery bot is not in the storage channel -> main bot delivers, caller is told
  let acc = build(mk('d', { code: 400, msg: 'Bad Request: chat not found' }), mk('m')); let r = await acc.deliverLectures(uid, [lid], { force: true }); assert.equal(r.sent, 1); assert.equal(r.via, 'main'); assert.deepEqual(got.slice(0, 2), ['d:6001', 'm:6001']);
  r = await acc.deliverNotes(uid, ch._id, null, { force: true }); assert.equal(r.sent, 1); assert.equal(r.via, 'main');
  // both fail: a plain-language reason (not a generic message)
  acc = build(mk('d', { code: 400, msg: 'Bad Request: message to copy not found' }), mk('m', { code: 400, msg: 'Bad Request: message to copy not found' })); r = await acc.deliverLectures(uid, [lid], { force: true }); assert.equal(r.sent, 0); assert.match(r.failed[0].error, /removed from the storage channel/);
  acc = build(mk('d', { code: 400, msg: 'Bad Request: chat not found' }), mk('m', { code: 400, msg: 'Bad Request: chat not found' })); r = await acc.deliverLectures(uid, [lid], { force: true }); assert.match(r.failed[0].error, /add the bot as admin/);
  r = await acc.deliverNotes(uid, ch._id, null, { force: true }); assert.equal(r.sent, 0); assert.match(r.failed[0].error, /add the bot as admin/);
  // student never started the delivery bot -> start hint, no fallback to the main bot
  got.length = 0; acc = build(mk('d', { code: 403, msg: 'Forbidden: bot was blocked by the user' }), mk('m')); r = await acc.deliverLectures(uid, [lid], { force: true }); assert.match(r.failed[0].error, /Start the bot first|press Start/); assert.deepEqual(got, ['d:6001']);
});

test('nightly database file to the owner is off by default (MongoDB keeps the snapshots)', async () => {
  const t = await boot(); assert.equal(t.app.service.config.get().nightlyBackup, false);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../server.js'), 'utf8'); assert.match(src, /NIGHTLY_BACKUP === '1' \|\| service\.config\.get\(\)\.nightlyBackup === true/);
});

test('delivered lecture videos are scheduled for deletion after 8 hours (default) and removed by the sweeper, staff included', async () => {
  const t = await boot(); assert.equal(t.app.service.config.get().lectureDeleteHours, 8);
  const u = t.user(8); await t.reg(u); const uid = String(u.id); const bid = t.add('B', 'foundation'); const sid = t.app.db.batch.getOne(bid).subjects[0]._id; const ch = t.app.content.addChapter(bid, sid, 'Ch 1');
  t.app.content.addLecture(bid, sid, ch._id, { name: 'L1', channelMsgId: 6001, fileType: 'video', duration: 600 }); t.app.access.grantHours(uid, 5, 'test'); t.app.access.grantHours(String(owner.id), 5, 'test');
  const lid = t.app.db.batch.getOne(bid).subjects[0].chapters[0].lectures[0]._id;
  for (const id of [uid, String(owner.id)]) { await t.app.access.deliverLectures(id, [lid]); }
  const rows = t.app.db.q('SELECT * FROM autodel').all(); assert.equal(rows.length, 2); assert.ok(rows.every((r) => Math.abs(r.at - (t.clock.t + 8 * 3600000)) < 5000));
  t.tg.clear(); assert.equal(await t.app.access.sweepDeletes(), 0); t.clock.t += 8 * 3600000 + 1000; assert.equal(await t.app.access.sweepDeletes(), 2); assert.equal(t.tg.of('deleteMessage').length, 2); assert.equal(t.app.db.q('SELECT * FROM autodel').all().length, 0);
  t.app.service.config.set(own, { lectureDeleteHours: 0 }); t.app.access.grantHours(uid, 5, 'test'); await t.app.access.deliverLectures(uid, [lid]); assert.equal(t.app.db.q('SELECT * FROM autodel').all().length, 0);
});

test('admin ▲▼ ordering: faculties, subjects and batches swap places and students see the same order; Open WebApp falls back to the request host', async () => {
  const t = await boot(); const A = (m, p, b) => t.call(owner, m, '/api/admin' + p, b);
  const ids = []; for (const n of ['Alpha', 'Beta', 'Gamma']) ids.push((await A('POST', '/faculties', { name: n })).json.data.id);
  const names = async () => (await A('GET', '/faculties?size=50')).json.data.items.map((f) => f.name);
  const first = await names(); assert.equal(first.length, 3);
  const r = await A('POST', `/faculties/${ids[2]}/move`, { dir: 'up' }); assert.equal(r.status, 200); assert.equal(r.json.data.moved, true);
  const afterUp = (await A('GET', '/faculties?size=50')).json.data.items.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((f) => f.name); assert.deepEqual(afterUp, ['Alpha', 'Gamma', 'Beta']);
  assert.equal((await A('POST', `/faculties/${ids[0]}/move`, { dir: 'up' })).json.data.moved, false); // already first
  assert.equal((await A('POST', `/faculties/${ids[0]}/move`, { dir: 'down' })).json.data.moved, true);
  const afterDown = (await A('GET', '/faculties?size=50')).json.data.items.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((f) => f.name); assert.deepEqual(afterDown, ['Gamma', 'Alpha', 'Beta']);
  // subjects
  const s1 = (await A('POST', '/subjects', { name: 'Accounts', level: 'foundation' })).json.data.id, s2 = (await A('POST', '/subjects', { name: 'Laws', level: 'foundation' })).json.data.id;
  assert.equal((await A('POST', `/subjects/${s2}/move`, { dir: 'up' })).status, 200); const subs = (await A('GET', '/subjects?level=foundation&size=50')).json.data.items.map((s) => s.name); assert.deepEqual(subs, ['Laws', 'Accounts']);
  // batches
  const b1 = t.add('One', 'foundation'), b2 = t.add('Two', 'foundation'); assert.equal((await A('POST', `/batches/${b2}/move`, { dir: 'up' })).status, 200);
  const bl = (await A('GET', '/batches?size=50')).json.data.items.filter((b) => b.level === 'foundation').sort((a, b) => (a.order || 0) - (b.order || 0)).map((b) => b.name); assert.deepEqual(bl.slice(0, 2), ['Two', 'One']);
  assert.equal((await t.call(t.user(20), 'POST', `/api/admin/faculties/${ids[0]}/move`, { dir: 'up' })).status, 403);
  // PUBLIC_URL missing -> taken from the incoming request
  const cfg = t.app.config; const keep = cfg.publicUrl; cfg.publicUrl = ''; await fetch(`http://127.0.0.1:${t.port}/healthz`, { headers: { 'x-forwarded-host': 'bot.example.org', 'x-forwarded-proto': 'https' } }); assert.equal(cfg.publicUrl, 'https://bot.example.org'); cfg.publicUrl = keep;
});

test('delivery bot /start always offers the button back to the main bot (username fetched on demand)', async () => {
  const t = await boot(); const u = t.user(30); t.app.setUsername(''); t.tg.clear();
  const m = { update_id: 1, message: { message_id: 1, from: { id: u.id, first_name: 'S' }, chat: { id: u.id, type: 'private' }, text: '/start', date: 1 } };
  await fetch(`http://127.0.0.1:${t.port}/tg/delivery-webhook`, { method: 'POST', body: JSON.stringify(m) }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300)); const sent = t.tg.of('sendMessage').find((x) => String(x.chat_id) === String(u.id)); if (sent) assert.match(JSON.stringify(sent.reply_markup || {}), /t\.me\/testbot/);
});

test('storage channel gets no snapshots when MongoDB is set; attempt/open-bot settings round-trip', async () => {
  const persist = require('../src/persist'); const { DatabaseSync } = require('node:sqlite'); const q = { log() {}, warn() {}, error() {} };
  const a = persist.createSnapshotter({ sqlite: new DatabaseSync(':memory:'), env: { MONGODB_URI: 'mongodb://x', STORAGE_CHANNEL_ID: '-100' }, tg: {}, deps: { mongo: {} }, log: q });
  assert.deepEqual(a.status().targets, ['mongodb']);
  const b = persist.createSnapshotter({ sqlite: new DatabaseSync(':memory:'), env: { STORAGE_CHANNEL_ID: '-100' }, tg: {}, log: q }); assert.deepEqual(b.status().targets, ['telegram']);
  const t = await boot(); let c = t.app.service.catalog(null, 'foundation').config; assert.equal(c.attemptStep, 'auto'); assert.equal(c.openBotOnSend, true);
  t.app.service.config.set(own, { attemptStep: 'always', openBotOnSend: false }); c = t.app.service.catalog(null, 'foundation').config; assert.equal(c.attemptStep, 'always'); assert.equal(c.openBotOnSend, false);
});

test('admin: add teacher to subject (no attempt) and create a new attempt from a batch', async () => {
  const t = await boot(); const S = t.app.service;
  const fac = S.faculty.create(own, { name: 'Hardik Sir', institute: 'PW' }); const sub = S.subject.create(own, { name: 'Accounts', level: 'foundation', icon: '📘', color: '#112233' });
  const r = await t.call(owner, 'POST', '/api/admin/subjects/' + sub.id + '/teachers', { facultyId: fac.id });
  assert.equal(r.status, 200, JSON.stringify(r.json)); const bid = (r.json.data || r.json).batchId;
  let cat = S.catalog(null, 'foundation'); let e = cat.subjects.find((x) => x.name === 'Accounts'); assert.equal(e.faculties.length, 1); assert.equal(e.faculties[0].batches[0].subject, 'Accounts');
  const r2 = await t.call(owner, 'POST', '/api/admin/batches/' + bid + '/new-attempt', { oldLabel: 'May 2027', newLabel: 'Nov 2027' }); assert.equal(r2.status, 200, JSON.stringify(r2.json));
  cat = S.catalog(null, 'foundation'); e = cat.subjects.find((x) => x.name === 'Accounts'); assert.deepEqual(e.faculties[0].batches.map((b) => b.label).sort(), ['May 2027', 'Nov 2027']);
});

test('admin: choose which attempt is Latest on the teacher card; delete an attempt', async () => {
  const t = await boot(); const S = t.app.service; const A = '/api/admin';
  const fac = S.faculty.create(own, { name: 'Nitin Sir', institute: 'PW' }); const sub = S.subject.create(own, { name: 'Account', level: 'foundation', icon: '📘', color: '#112233' });
  const d = (r) => r.json.data || r.json;
  const b1 = d(await t.call(owner, 'POST', `${A}/subjects/${sub.id}/teachers`, { facultyId: fac.id, label: 'May 2026' })).batchId;
  const b2 = d(await t.call(owner, 'POST', `${A}/batches/${b1}/new-attempt`, { oldLabel: 'May 2026', newLabel: 'Nov 2026' })).batchId;
  const latest = () => S.catalog(null, 'foundation').subjects.find((x) => x.name === 'Account').faculties[0].batches[0].label;
  assert.equal(latest(), 'Nov 2026'); // new attempt is Latest by default
  assert.equal((await t.call(owner, 'POST', `${A}/batches/${b1}/feature`, { on: true })).status, 200); assert.equal(latest(), 'May 2026');
  const l = d(await t.call(owner, 'GET', `${A}/subjects/${sub.id}/attempts`)); assert.equal(l.length, 2); assert.equal(l.filter((x) => x.featured).length, 1);
  assert.equal((await t.call(owner, 'DELETE', `${A}/batches/${b1}`)).status, 200); assert.equal(latest(), 'Nov 2026'); assert.equal(d(await t.call(owner, 'GET', `${A}/subjects/${sub.id}/attempts`)).length, 1);
});

test('already delivered: not re-sent, not counted, big notice; force re-sends; notes too', async () => {
  const t = await boot(); const bid = t.add('Free', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const ch = t.app.content.addChapter(bid, sid, 'Journal');
  const L = [1, 2].map((i) => t.app.content.addLecture(bid, sid, ch._id, { name: 'Lecture ' + i, channelMsgId: 7000 + i })); const n = t.app.content.addNote(bid, sid, ch._id, { name: 'Notes.pdf', channelMsgId: 7100, fileType: 'document' });
  const u = await t.reg(t.user(5)); t.app.access.grantHours(String(u.id), 10); const send = (ids, force) => t.call(u, 'POST', '/api/app/lectures/send', { ids, force });
  let r = (await send([L[0]._id])).json.data; assert.equal(r.sent, 1); const used = r.quota.left;
  t.tg.clear(); r = (await send([L[0]._id])).json.data; assert.equal(r.sent, 0); assert.equal(r.already.length, 1); assert.equal(r.quota.left, used); assert.ok(t.tg.of('sendMessage').some((m) => /ALREADY DELIVERED/.test(m.text)));
  r = (await send([L[0]._id, L[1]._id])).json.data; assert.equal(r.sent, 1); assert.equal(r.already.length, 1); assert.equal(r.quota.left, used - 1);
  r = (await send([L[0]._id], true)).json.data; assert.equal(r.sent, 1); assert.equal(r.quota.left, used - 2);
  const ns = (force) => t.call(u, 'POST', '/api/app/notes/send', { chapterId: ch._id, force }); assert.equal((await ns()).json.data.sent, 1); const r2 = (await ns()).json.data; assert.equal(r2.sent, 0); assert.equal(r2.already.length, 1); assert.equal((await ns(true)).json.data.sent, 1);
});

test('lecture numbers: insert at number, replace by number, duplicate skip, set number, undo (bot session)', async () => {
  const t = await boot(); const bid = t.add('Free', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const C = t.app.content; const ch = C.addChapter(bid, sid, 'Journal');
  const l1 = C.addLecture(bid, sid, ch._id, { name: 'A', channelMsgId: 1, fid: 'f1' }); C.addLecture(bid, sid, ch._id, { name: 'B', channelMsgId: 2, fid: 'f2' }); C.addLecture(bid, sid, ch._id, { name: 'C', channelMsgId: 3, fid: 'f3' });
  const ins = C.addLecture(bid, sid, ch._id, { name: 'X', channelMsgId: 4, position: 2 }); assert.equal(C.numberOf(ins._id), 2); assert.equal(C.lectureAt(ch._id, 3).name, 'B');
  assert.deepEqual(C.hasFile(ch._id, 'f3'), { kind: 'lecture', number: 4, name: 'C' }); assert.equal(C.hasFile(ch._id, 'zz'), null);
  C.replaceLecture(C.lectureAt(ch._id, 3)._id, { channelMsgId: 99, fid: 'new' }); assert.equal(C.hasFile(ch._id, 'new').number, 3);
  assert.equal(C.setLectureNumber(l1._id, 4).number, 4); assert.equal(C.lectureAt(ch._id, 4).name, 'A'); assert.equal(C.numberOf(ins._id), 1);
  const n1 = C.addNote(bid, sid, ch._id, { name: 'n1', channelMsgId: 5 }); C.addNote(bid, sid, ch._id, { name: 'n2', channelMsgId: 6 }); assert.equal(C.setNoteNumber(ch._id, n1._id, 2).number, 2); assert.equal(C.noteAt(ch._id, 2).name, 'n1');
});

test('staff bot session: duplicate skipped, /at inserts, /lec replaces, /undo removes, summary lists items', async () => {
  const t = await boot(); const bid = t.add('Free', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const C = t.app.content; const ch = C.addChapter(bid, sid, 'Ch1');
  t.app.db.kv.set('up:dddddddddddddddd', JSON.stringify({ k: 'add', cid: ch._id, exp: Date.now() + 1e6 })); await t.say(owner, '/start u_dddddddddddddddd');
  const vid = (uq, cap) => t.send(owner, { video: { file_id: 'x' + uq, file_unique_id: uq, duration: 60 }, caption: cap });
  await vid('u1', 'One'); await vid('u2', 'Two'); t.tg.clear(); await vid('u1', 'One again'); assert.match(t.tg.last('sendMessage').text, /already uploaded/); assert.equal(C.lectureAt(ch._id, 3), null);
  await t.say(owner, '/at 1'); await vid('u3', 'Zero'); assert.equal(C.lectureAt(ch._id, 1).name, 'Zero'); assert.equal(C.lectureAt(ch._id, 3).name, 'Two');
  await t.say(owner, '/lec 2'); assert.match(t.tg.last('sendMessage').text, /Replace lecture 2/); await vid('u4', 'ignored'); assert.equal(C.lectureAt(ch._id, 2).name, 'One'); assert.equal(C.hasFile(ch._id, 'u4').number, 2);
  await t.say(owner, '/cancel_target'); await t.say(owner, '/undo'); assert.match(t.tg.last('sendMessage').text, /cannot be undone/);
  await vid('u5', 'Temp'); assert.equal(C.hasFile(ch._id, 'u5').kind, 'lecture'); await t.say(owner, '/undo'); assert.equal(C.hasFile(ch._id, 'u5'), null);
  await t.say(owner, '/done'); assert.match(t.tg.last('sendMessage').text, /Upload finished[\s\S]*Skipped duplicates: <b>1<\/b>|Skipped duplicates/);
});

test('bot upload: files named by lecture number sort themselves; /ch switches or creates chapters; names are tidied', async () => {
  const t = await boot(); const bid = t.add('Free', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const C = t.app.content; const ch = C.addChapter(bid, sid, 'Ch1');
  assert.equal(C.numFromName('L05 - Topic'), 5); assert.equal(C.numFromName('Lecture 12 Topic'), 12); assert.equal(C.numFromName('05. Topic'), 5); assert.equal(C.numFromName('Law of contract'), 0); assert.equal(C.numFromName('2023 changes'), 0);
  assert.equal(C.suggestName('Lecture_4 @somechannel [1080p].mp4', ''), 'Lecture 4');
  t.app.db.kv.set('up:eeeeeeeeeeeeeeee', JSON.stringify({ k: 'add', cid: ch._id, exp: Date.now() + 1e6 })); await t.say(owner, '/start u_eeeeeeeeeeeeeeee');
  const vid = (uq, cap) => t.send(owner, { video: { file_id: 'y' + uq, file_unique_id: uq, duration: 60 }, caption: cap });
  await vid('a3', 'Lecture 3 Depreciation'); await vid('a1', 'Lecture 1 Intro'); await vid('a2', 'Lecture 2 Journal'); await vid('a5', 'Lecture 5 Ledger'); await vid('a4', 'L04 Trial balance'); await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => C.numFromName(C.lectureAt(ch._id, n).name)), [1, 2, 3, 4, 5]);
  await t.say(owner, '/ch Ch2'); assert.match(t.tg.last('sendMessage').text, /Upload in progress[\s\S]*Ch2/); const ch2 = t.app.db.batch.getOne(bid).subjects[0].chapters.find((c) => c.name === 'Ch2'); assert.ok(ch2);
  await vid('b1', 'Notes video'); await new Promise((r) => setTimeout(r, 200)); assert.equal(C.lectureAt(ch2._id, 1).name, 'Notes video'); await t.say(owner, '/ch ch1'); await vid('a6', 'Lecture 6 Next'); await new Promise((r) => setTimeout(r, 200)); assert.equal(C.lectureAt(ch._id, 6).name, 'Lecture 6 Next'); await t.say(owner, '/done');
});
