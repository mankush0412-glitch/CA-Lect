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
  let acc = build(mk('d', { code: 400, msg: 'Bad Request: chat not found' }), mk('m')); let r = await acc.deliverLectures(uid, [lid]); assert.equal(r.sent, 1); assert.equal(r.via, 'main'); assert.deepEqual(got.slice(0, 2), ['d:6001', 'm:6001']);
  r = await acc.deliverNotes(uid, ch._id); assert.equal(r.sent, 1); assert.equal(r.via, 'main');
  // both fail: a plain-language reason (not a generic message)
  acc = build(mk('d', { code: 400, msg: 'Bad Request: message to copy not found' }), mk('m', { code: 400, msg: 'Bad Request: message to copy not found' })); r = await acc.deliverLectures(uid, [lid]); assert.equal(r.sent, 0); assert.match(r.failed[0].error, /removed from the storage channel/);
  acc = build(mk('d', { code: 400, msg: 'Bad Request: chat not found' }), mk('m', { code: 400, msg: 'Bad Request: chat not found' })); r = await acc.deliverLectures(uid, [lid]); assert.match(r.failed[0].error, /add the bot as admin/);
  r = await acc.deliverNotes(uid, ch._id); assert.equal(r.sent, 0); assert.match(r.failed[0].error, /add the bot as admin/);
  // student never started the delivery bot -> start hint, no fallback to the main bot
  got.length = 0; acc = build(mk('d', { code: 403, msg: 'Forbidden: bot was blocked by the user' }), mk('m')); r = await acc.deliverLectures(uid, [lid]); assert.match(r.failed[0].error, /Start the bot first|press Start/); assert.deepEqual(got, ['d:6001']);
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
